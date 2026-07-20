// ─── Processing liveness heartbeat ──────────────────────────────────────────
//
// A running transcription/analysis pipeline can legitimately take 10–30+
// minutes for a long segmented recording. The old reconciliation in
// `loadData` stamped any session that had been `processing` for more than five
// minutes as "interrupted", which falsely flagged healthy long runs (and, since
// a retry keeps the original creation `date`, permanently re-flagged retried
// sessions on every reload).
//
// The fix is a liveness signal rather than an age check: while a pipeline is
// actively running in a tab, it writes a heartbeat to localStorage every ~20s
// and clears it on completion/error. Reconciliation only stamps a session as
// interrupted when its heartbeat is ABSENT or STALE (older than ~90s). A fresh
// heartbeat means some tab (or this tab, pre-reload) is genuinely working, so
// the session is left in `processing` untouched.
//
// localStorage-only — nothing here touches `types.ts` or the database.

const KEY_PREFIX = 'aligned-processing-heartbeat-';
const BEAT_INTERVAL_MS = 20 * 1000; // write cadence while a pipeline runs
export const HEARTBEAT_STALE_MS = 90 * 1000; // reconciliation freshness window

const heartbeatKey = (sessionId: string) => `${KEY_PREFIX}${sessionId}`;

// Active setInterval timers per session so we can stop them on completion.
const timers = new Map<string, ReturnType<typeof setInterval>>();

const writeBeat = (sessionId: string) => {
  try {
    localStorage.setItem(heartbeatKey(sessionId), String(Date.now()));
  } catch {
    /* private mode / quota — heartbeat is best-effort */
  }
};

/**
 * Begin emitting a heartbeat for a session's processing run. Writes immediately
 * and then every ~20s until `clearHeartbeat` is called. Idempotent: calling it
 * again for the same session resets the existing timer rather than stacking.
 */
export const startHeartbeat = (sessionId: string): void => {
  if (!sessionId) return;
  const existing = timers.get(sessionId);
  if (existing) clearInterval(existing);
  writeBeat(sessionId);
  const timer = setInterval(() => writeBeat(sessionId), BEAT_INTERVAL_MS);
  timers.set(sessionId, timer);
};

/** Stop the heartbeat timer and remove the localStorage key. */
export const clearHeartbeat = (sessionId: string): void => {
  if (!sessionId) return;
  const timer = timers.get(sessionId);
  if (timer) {
    clearInterval(timer);
    timers.delete(sessionId);
  }
  try {
    localStorage.removeItem(heartbeatKey(sessionId));
  } catch {
    /* ignore */
  }
};

/** Read the last heartbeat timestamp for a session, or null if absent/unreadable. */
export const getHeartbeat = (sessionId: string): number | null => {
  try {
    const raw = localStorage.getItem(heartbeatKey(sessionId));
    if (!raw) return null;
    const ts = parseInt(raw, 10);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
};

/**
 * True when a session has a heartbeat written within the last ~90s — i.e. a
 * pipeline is (or was, moments ago) genuinely working on it. Reconciliation and
 * auto-resume both use this to avoid touching a live session.
 */
export const isHeartbeatFresh = (
  sessionId: string,
  now: number = Date.now(),
  maxAgeMs: number = HEARTBEAT_STALE_MS,
): boolean => {
  const ts = getHeartbeat(sessionId);
  return ts !== null && now - ts < maxAgeMs;
};
