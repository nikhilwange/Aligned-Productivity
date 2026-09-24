// ─── Segment deletion policy — the single chokepoint ────────────────────────
//
// HARD RULE: a recording's Storage segments are deleted ONLY
//   (a) automatically, after its recordings row is 'completed' with no
//       unclear / failed parts, or
//   (b) by an explicit, user-confirmed Discard / Delete.
// Never for a row that is 'processing', 'interrupted' or 'error' — or any
// status other than 'completed' — and never automatically when the row
// status is unknown (no row found): that audio may be the only copy of a
// recording that still has to be processed or retried.
//
// Every segment deletion in the app goes through deleteRecordingSegments()
// (services/segmentRecorder.ts wires in the real Storage / IndexedDB calls),
// which refuses — deleting nothing, not even the local copy — unless the
// caller's declared reason satisfies the rule. Kept free of runtime imports
// so tests/segmentCleanup.test.ts can run it directly under Node.

import type { SegmentManifest } from './recordingRecovery';

export type RecordingRowStatus = string; // 'processing' | 'completed' | 'error' | 'interrupted' | …

export type SegmentDeletion =
  | {
      kind: 'user_confirmed';
      action: 'discard_recording' | 'delete_session' | 'discard_leftover';
    }
  | {
      kind: 'automatic';
      reason: 'completed_clean' | 'retranscribed_clean' | 'completed_leftover' | 'seven_day_cleanup';
      /** Status of the recordings row for this recoveryId; null/undefined = no row found. */
      rowStatus: RecordingRowStatus | null | undefined;
      /** Any unclear / failed segment still worth a re-transcription. */
      hasProblems: boolean;
    };

export function mayDeleteSegments(d: SegmentDeletion): { allowed: boolean; why: string } {
  if (d.kind === 'user_confirmed') return { allowed: true, why: `user confirmed (${d.action})` };
  if (d.rowStatus === null || d.rowStatus === undefined) {
    return { allowed: false, why: `no recordings row found (${d.reason}) — audio may be the only copy` };
  }
  if (d.rowStatus !== 'completed') {
    return { allowed: false, why: `row is '${d.rowStatus}' (${d.reason}) — audio needed for retry` };
  }
  if (d.hasProblems) {
    return { allowed: false, why: `row is completed but has unclear/failed parts (${d.reason}) — kept for re-transcription` };
  }
  return { allowed: true, why: `row completed with no unclear/failed parts (${d.reason})` };
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
    if (paths.length > 0) {
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
