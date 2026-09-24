// ─── Audio retention rules — the ONE shared definition ──────────────────────
//
// Used by BOTH the client cleanup policy (services/segmentCleanupPolicy.ts,
// and the "Audio will be deleted in N days" banners) and the server sweep
// (supabase/functions/audio-retention). Pure TypeScript, no imports, so the
// same file runs in the browser, in Deno and under `node --test`.
//
// The dashboard-deployable audio-retention/index.standalone.ts carries a
// verbatim copy of the block between the markers below; tests/
// segmentCleanup.test.mts fails if the two ever differ.
//
// BEGIN SHARED AUDIO RETENTION RULES
export const KEPT_AUDIO_RETENTION_DAYS = 30; // completed session with unclear/failed parts
export const FAILED_AUDIO_RETENTION_DAYS = 30; // session in 'error' / 'interrupted'
export const ORPHAN_AUDIO_RETENTION_DAYS = 30; // segments with no recordings row
export const RETENTION_WARNING_DAYS = 7; // banner countdown starts this many days before deletion
export const LEGACY_ERROR_AUDIO_RETENTION_DAYS = 30; // single-file audioPath archive of an 'error' row
export const STALE_CHUNK_HOURS = 24; // temporary <user>/chunks/* upload pieces

/**
 * The placeholder the transcript contains wherever audio couldn't be
 * transcribed — both 'unclear' chunks and wholly 'failed' segments write it.
 * The server sweep detects "has unclear parts" by this marker alone.
 */
export const UNCLEAR_MARKER = '[…audio unclear…]';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionVerdict {
  action: 'keep' | 'delete';
  reason: string;
  /** When 'keep' is time-limited: the moment the audio becomes deletable. */
  deleteAtMs?: number;
}

/** Days for a time-based rule — the dry-run override (if any) replaces them. */
const days = (normal: number, override?: number) =>
  override !== undefined && Number.isInteger(override) && override >= 0 ? override : normal;

function timed(label: string, anchorMs: number, retentionDays: number, nowMs: number): RetentionVerdict {
  const deleteAtMs = anchorMs + retentionDays * DAY_MS;
  return nowMs >= deleteAtMs
    ? { action: 'delete', reason: `${label}: no new uploads for ${retentionDays} days`, deleteAtMs }
    : { action: 'keep', reason: `${label}: within the ${retentionDays}-day retention window`, deleteAtMs };
}

/**
 * A segmented recording's Storage folder (recordings/<recoveryId>/).
 *   rowStatus          the recordings row's status; null = no row (orphan)
 *   hasUnclearParts    the row's transcript contains UNCLEAR_MARKER
 *   lastUploadMs       newest object time in the folder (the retention anchor)
 * Rules:
 *   processing                          → keep, always
 *   completed, no unclear parts         → delete (a retry isn't needed)
 *   completed with unclear parts        → delete 30 days after the last upload
 *   error / interrupted                 → delete 30 days after the last upload
 *   no row (orphan)                     → delete 30 days after the last upload
 *   any other status                    → keep
 * retentionDaysOverride (dry runs only) replaces the 30 days.
 */
export function segmentedAudioRetention(p: {
  rowStatus: string | null;
  hasUnclearParts: boolean;
  lastUploadMs: number;
  nowMs: number;
  retentionDaysOverride?: number;
}): RetentionVerdict {
  const o = p.retentionDaysOverride;
  if (p.rowStatus === null) {
    return timed('orphan (no recordings row)', p.lastUploadMs, days(ORPHAN_AUDIO_RETENTION_DAYS, o), p.nowMs);
  }
  if (p.rowStatus === 'processing') return { action: 'keep', reason: "row is 'processing'" };
  if (p.rowStatus === 'error' || p.rowStatus === 'interrupted') {
    return timed(`row is '${p.rowStatus}'`, p.lastUploadMs, days(FAILED_AUDIO_RETENTION_DAYS, o), p.nowMs);
  }
  if (p.rowStatus === 'completed') {
    if (!p.hasUnclearParts) return { action: 'delete', reason: 'completed with no unclear/failed parts' };
    return timed('completed with unclear parts', p.lastUploadMs, days(KEPT_AUDIO_RETENTION_DAYS, o), p.nowMs);
  }
  return { action: 'keep', reason: `row is '${p.rowStatus}'` };
}

/**
 * A legacy single-file archive (recordings.audioPath).
 *   processing → keep; completed → delete (should have gone on success);
 *   error → delete 30 days after the row was created; anything else → keep.
 */
export function legacyArchiveRetention(p: {
  rowStatus: string;
  createdMs: number;
  nowMs: number;
  retentionDaysOverride?: number;
}): RetentionVerdict {
  if (p.rowStatus === 'completed') return { action: 'delete', reason: 'completed: archive should have been deleted on success' };
  if (p.rowStatus === 'error') {
    return timed("legacy archive of an 'error' row", p.createdMs, days(LEGACY_ERROR_AUDIO_RETENTION_DAYS, p.retentionDaysOverride), p.nowMs);
  }
  return { action: 'keep', reason: `row is '${p.rowStatus}'` };
}

/** A temporary <user>/chunks/* upload piece: deleted once older than 24 h. */
export function staleChunkRetention(p: { uploadedMs: number; nowMs: number }): RetentionVerdict {
  const deleteAtMs = p.uploadedMs + STALE_CHUNK_HOURS * 60 * 60 * 1000;
  return p.nowMs >= deleteAtMs
    ? { action: 'delete', reason: 'stale_chunk', deleteAtMs }
    : { action: 'keep', reason: 'chunk still fresh', deleteAtMs };
}

/** Whole days until deletion, when inside the warning window; otherwise null. */
export function retentionWarningDaysLeft(deleteAtMs: number | undefined, nowMs: number): number | null {
  if (deleteAtMs === undefined) return null;
  const msLeft = deleteAtMs - nowMs;
  if (msLeft > RETENTION_WARNING_DAYS * DAY_MS) return null;
  return Math.max(0, Math.ceil(msLeft / DAY_MS));
}
// END SHARED AUDIO RETENTION RULES
