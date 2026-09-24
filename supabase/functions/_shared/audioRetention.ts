// ─── Audio retention rules — the ONE shared definition ──────────────────────
//
// Used by BOTH the client cleanup policy (services/segmentCleanupPolicy.ts,
// and the "Audio will be deleted in N days" banner) and the server sweep
// (supabase/functions/audio-retention). Pure TypeScript, no imports, so the
// same file runs in the browser, in Deno and under `node --test`.
//
// The dashboard-deployable audio-retention/index.standalone.ts carries a
// verbatim copy of the block between the markers below; tests/
// segmentCleanup.test.mts fails if the two ever differ.
//
// BEGIN SHARED AUDIO RETENTION RULES
export const KEPT_AUDIO_RETENTION_DAYS = 30; // completed session with unclear/failed parts
export const ORPHAN_AUDIO_RETENTION_DAYS = 30; // segments with no recordings row, since the last upload
export const RETENTION_WARNING_DAYS = 7; // banner countdown starts this many days before deletion
export const LEGACY_ERROR_AUDIO_RETENTION_DAYS = 30; // single-file audioPath archive of an 'error' row

/** The placeholder a transcript contains where audio couldn't be transcribed. */
export const UNCLEAR_MARKER = '[…audio unclear…]';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionVerdict {
  action: 'keep' | 'delete';
  reason: string;
  /** When 'keep' is time-limited: the moment the audio becomes deletable. */
  deleteAtMs?: number;
}

/**
 * A segmented recording's Storage folder (recordings/<recoveryId>/).
 *   rowStatus          the recordings row's status; null = no row (orphan)
 *   hasUnclearParts    the row's transcript contains UNCLEAR_MARKER
 *   lastUploadMs       newest object time in the folder (the "kept since" anchor)
 * Rules:
 *   processing / interrupted / error / anything but completed → keep, always
 *   completed, no unclear parts                                → delete (retry not needed)
 *   completed with unclear parts                                → keep until lastUpload + 30 d
 *   orphan (no row)                                             → keep until lastUpload + 30 d
 */
export function segmentedAudioRetention(p: {
  rowStatus: string | null;
  hasUnclearParts: boolean;
  lastUploadMs: number;
  nowMs: number;
}): RetentionVerdict {
  if (p.rowStatus === null) {
    const deleteAtMs = p.lastUploadMs + ORPHAN_AUDIO_RETENTION_DAYS * DAY_MS;
    return p.nowMs >= deleteAtMs
      ? { action: 'delete', reason: `orphan: no recordings row, no uploads for ${ORPHAN_AUDIO_RETENTION_DAYS} days`, deleteAtMs }
      : { action: 'keep', reason: 'orphan: waiting for the retention window', deleteAtMs };
  }
  if (p.rowStatus !== 'completed') {
    return { action: 'keep', reason: `row is '${p.rowStatus}': audio needed for retry` };
  }
  if (!p.hasUnclearParts) {
    return { action: 'delete', reason: 'completed with no unclear/failed parts' };
  }
  const deleteAtMs = p.lastUploadMs + KEPT_AUDIO_RETENTION_DAYS * DAY_MS;
  return p.nowMs >= deleteAtMs
    ? { action: 'delete', reason: `completed with unclear parts: retry window of ${KEPT_AUDIO_RETENTION_DAYS} days ended`, deleteAtMs }
    : { action: 'keep', reason: 'completed with unclear parts: kept for re-transcription', deleteAtMs };
}

/**
 * A legacy single-file archive (recordings.audioPath).
 *   processing → keep; completed → delete (should have gone on success);
 *   error → keep until createdAt + 30 d; anything else → keep.
 */
export function legacyArchiveRetention(p: { rowStatus: string; createdMs: number; nowMs: number }): RetentionVerdict {
  if (p.rowStatus === 'completed') return { action: 'delete', reason: 'completed: archive should have been deleted on success' };
  if (p.rowStatus === 'error') {
    const deleteAtMs = p.createdMs + LEGACY_ERROR_AUDIO_RETENTION_DAYS * DAY_MS;
    return p.nowMs >= deleteAtMs
      ? { action: 'delete', reason: `error: retry window of ${LEGACY_ERROR_AUDIO_RETENTION_DAYS} days ended`, deleteAtMs }
      : { action: 'keep', reason: 'error: kept for retry', deleteAtMs };
  }
  return { action: 'keep', reason: `row is '${p.rowStatus}'` };
}

/** Whole days until deletion, when inside the warning window; otherwise null. */
export function retentionWarningDaysLeft(deleteAtMs: number | undefined, nowMs: number): number | null {
  if (deleteAtMs === undefined) return null;
  const msLeft = deleteAtMs - nowMs;
  if (msLeft > RETENTION_WARNING_DAYS * DAY_MS) return null;
  return Math.max(0, Math.ceil(msLeft / DAY_MS));
}
// END SHARED AUDIO RETENTION RULES
