// ─── Recording & speech-to-text guards — single source of truth ─────────────
//
// Protect against a client-side bug (a zombie recorder, a runaway auto-resume)
// generating unbounded Sarvam cost, and decide how a recording ends when the
// user isn't there to end it. Guiding rule: every automatic ending SAVES what
// was captured; only an explicit, confirmed Discard drops audio.
//
// ⚠️ The Vercel API layer cannot import client config, so STT_SESSION_CEILING_MIN
// is mirrored in api/_lib/sttLimits.ts. Change both together.

/** Hard ceiling of captured / transcribed audio per recording, all tiers. */
export const STT_SESSION_CEILING_MIN = 240;

/** Heads-up this many minutes before the ceiling. */
export const STT_CEILING_WARNING_MIN = 5;

/** A sleep shorter than this resumes the SAME recording; longer ends and saves it. */
export const SLEEP_RESUME_MAX_MIN = 60;

/**
 * Real sleep = the wall clock jumped by more than this between two ticks…
 * (a locked or backgrounded tab only throttles timers to ~1/min, so a jump
 * alone is not enough)…
 */
export const SLEEP_GAP_THRESHOLD_MIN = 3;
/** …while captured audio advanced by less than this. */
export const SLEEP_MAX_AUDIO_ADVANCE_SEC = 30;

/** Continuous silence (in captured-audio time) before "Still recording?". */
export const SILENCE_AUTOSTOP_MIN = 15;
/** No answer to "Still recording?" within this → stop and SAVE. */
export const SILENCE_PROMPT_TIMEOUT_MIN = 5;
/**
 * Peak RMS (0–1) over a ~0.5 s window below which the input counts as silent.
 * Deliberately low so a quiet room with a distant speaker is still "sound";
 * the live values are logged in dev ([Recorder] level …) for tuning.
 */
export const SILENCE_RMS_THRESHOLD = 0.004;

/** Virtual mode: screen sharing ended but the mic is live → "Continue with mic only?" timeout. */
export const SHARE_ENDED_PROMPT_TIMEOUT_MIN = 3;

/** How often the in-progress segment is saved to IndexedDB (bounds loss on tab close). */
export const CHECKPOINT_INTERVAL_SEC = 10;

/** Manifests older than this, or longer than the ceiling, are never auto-processed. */
export const LEFTOVER_MAX_AGE_HOURS = 24;
