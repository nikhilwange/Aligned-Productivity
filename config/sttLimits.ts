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
/**
 * Virtual mode, still mic-only after "Keep recording": ask again (the same
 * "sharing ended" prompt) after every this many minutes of captured audio.
 */
export const MIC_ONLY_REPROMPT_MIN = 15;

/**
 * Virtual mode: the meeting audio is measured ON ITS OWN (the mic's room
 * noise would mask it). A meeting tab left open after the call is digitally
 * silent, far below any room noise, hence a much lower threshold than
 * SILENCE_RMS_THRESHOLD. Live values are logged in dev ([Recorder] meeting
 * audio level …) for tuning.
 */
export const SHARE_SILENCE_RMS_THRESHOLD = 0.0005;
/** Silent meeting audio (captured-audio time) before "Did your meeting end?". Only ever asks. */
export const SHARE_SILENCE_PROMPT_MIN = 5;
/** No answer to "Did your meeting end?" within this → stop and SAVE. */
export const SHARE_SILENCE_PROMPT_TIMEOUT_MIN = 3;

/** How often the in-progress segment is saved to IndexedDB (bounds loss on tab close). */
export const CHECKPOINT_INTERVAL_SEC = 10;

/** Manifests older than this, or longer than the ceiling, are never auto-processed. */
export const LEFTOVER_MAX_AGE_HOURS = 24;

// ─── Silent-chunk skip (services/sarvamService.ts) ──────────────────────────
// A ≤25 s chunk whose RMS AND peak are both below these is not sent to Sarvam
// (it contributes "" to the transcript). Both must be low: RMS alone would
// skip a chunk with one short, quiet remark in an otherwise silent stretch.
// Dev builds log every chunk's RMS / peak ([Sarvam] chunk levels) for tuning.
export const SKIP_SILENT_CHUNKS = true;
export const SILENT_CHUNK_RMS = 0.002;
export const SILENT_CHUNK_PEAK = 0.02;

/** A segment's decoded length is trusted for the saved duration only within this of the audio-clock length. */
export const DECODED_DURATION_TOLERANCE = 0.05;
