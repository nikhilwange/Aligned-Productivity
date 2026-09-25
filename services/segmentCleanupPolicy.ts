// ─── Segment deletion policy — the single client chokepoint ─────────────────
//
// HARD RULE: a recording's Storage segments are deleted ONLY
//   (a) automatically, when the SHARED retention rules say so
//       (supabase/functions/_shared/audioRetention.ts — the same rules the
//       server's daily audio-retention sweep applies), or
//   (b) by an explicit, user-confirmed Discard / Delete.
// The client never auto-deletes a row that is not 'completed' (processing is never
// deleted at all; error / interrupted only by the server sweep).
//
// On top of the shared rules the CLIENT is stricter in one way: it never
// deletes Storage for a recording with no row (an orphan). "No row" here is
// only as good as the row list this tab loaded; the server sweep, which reads
// the database directly, handles orphans after ORPHAN_AUDIO_RETENTION_DAYS.
//
// Every segment deletion goes through deleteRecordingSegments()
// (services/segmentRecorder.ts wires in the real Storage / IndexedDB calls),
// which refuses — deleting nothing — unless the declared reason satisfies the
// rules. Only type imports + the pure shared rules, so tests run it under Node.

import type { SegmentManifest } from './recordingRecovery';
import { segmentedAudioRetention } from '../supabase/functions/_shared/audioRetention.ts';

export type RecordingRowStatus = string; // 'processing' | 'completed' | 'error' | 'interrupted' | …

export type SegmentDeletion =
  | {
      kind: 'user_confirmed';
      action: 'discard_recording' | 'delete_session' | 'discard_leftover';
    }
  | {
      kind: 'automatic';
      reason: 'completed_clean' | 'retranscribed_clean' | 'completed_leftover' | 'retention_sweep';
      /** Status of the recordings row for this recoveryId; null/undefined = no row found. */
      rowStatus: RecordingRowStatus | null | undefined;
      /** Unclear / failed parts still worth a re-transcription. */
      hasProblems: boolean;
      /** Newest Storage object time for the recording (retention anchor); unknown = treated as now. */
      lastUploadMs?: number | null;
      nowMs?: number;
    }
  | {
      // The server sweep already deleted the Storage copy (retention ended):
      // drop this device's local copy too. Touches no Storage.
      kind: 'local_only';
      reason: 'storage_already_deleted';
    };

export function mayDeleteSegments(d: SegmentDeletion): { allowed: boolean; why: string } {
  if (d.kind === 'user_confirmed') return { allowed: true, why: `user confirmed (${d.action})` };
  if (d.kind === 'local_only') return { allowed: true, why: 'Storage copy already deleted by retention — local copy only' };
  if (d.rowStatus === null || d.rowStatus === undefined) {
    return { allowed: false, why: `no recordings row found (${d.reason}) — orphans are left to the server sweep` };
  }
  // The client only ever auto-deletes COMPLETED recordings. Rows in
  // 'processing' are never deleted; 'error' / 'interrupted' ones only by the
  // server sweep after their retention window.
  if (d.rowStatus !== 'completed') {
    return { allowed: false, why: `row is '${d.rowStatus}' (${d.reason}) — only the server sweep may delete it, after its retention window` };
  }
  const nowMs = d.nowMs ?? Date.now();
  const verdict = segmentedAudioRetention({
    rowStatus: d.rowStatus,
    hasUnclearParts: d.hasProblems,
    lastUploadMs: d.lastUploadMs ?? nowMs,
    nowMs,
  });
  return verdict.action === 'delete'
    ? { allowed: true, why: `${verdict.reason} (${d.reason})` }
    : { allowed: false, why: `${verdict.reason} (${d.reason})` };
}

/** Every Storage path a manifest references, including files a header repair replaced. */
export function manifestStoragePaths(m: SegmentManifest): string[] {
  const out: string[] = [];
  for (const s of m.segments) {
    if (s.storagePath) out.push(s.storagePath);
    for (const p of s.previousStoragePaths ?? []) out.push(p);
  }
  return [...new Set(out)];
}

export interface SegmentStoreDeps {
  deleteAudioPaths: (paths: string[]) => Promise<void>;
  clearManifest: (recoveryId: string) => Promise<void>;
  clearTranscripts: (recoveryId: string) => Promise<void>;
  clearChunkCache: (key: string) => unknown;
  warn?: (msg: string) => void;
}

/**
 * Delete a recording's segments (Storage + local copies) IF the policy allows.
 * Returns true when deleted, false when refused (nothing was touched).
 */
export async function deleteRecordingSegments(
  deps: SegmentStoreDeps,
  recoveryId: string,
  manifest: SegmentManifest | null,
  deletion: SegmentDeletion,
): Promise<boolean> {
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const decision = mayDeleteSegments(deletion);
  if (!decision.allowed) {
    warn(`[Cleanup] REFUSED to delete segments of ${recoveryId}: ${decision.why}`);
    return false;
  }
  if (manifest) {
    const paths = manifestStoragePaths(manifest);
    if (paths.length > 0 && deletion.kind !== 'local_only') {
      await deps.deleteAudioPaths(paths).catch((err: any) =>
        warn(`[Cleanup] Storage delete failed for ${recoveryId}: ${err?.message ?? err}`));
    }
    manifest.segments.forEach((s) => deps.clearChunkCache(`${recoveryId}:seg${s.index}`));
  }
  await deps.clearManifest(recoveryId);
  await deps.clearTranscripts(recoveryId);
  console.log(`[Cleanup] deleted segments of ${recoveryId}: ${decision.why}`);
  return true;
}
