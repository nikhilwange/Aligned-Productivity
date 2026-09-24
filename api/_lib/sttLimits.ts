// Server-side mirror of config/sttLimits.ts (the API layer can't import client
// config). ⚠️ SOURCE OF TRUTH IS config/sttLimits.ts — change both together.

/** Hard ceiling of Sarvam audio per recording, all tiers — admin included. */
export const STT_SESSION_CEILING_MIN = 240;

// Grace period for clients that predate `recoveryId`. Until this instant a
// request without one is allowed (and ledgered with recovery_id = null); from
// it on, it is rejected with 426 "Please refresh the app", because such a
// request can't be counted against the per-recording ceiling.
export const REQUIRE_RECOVERY_ID_AFTER = Date.parse('2026-10-01T00:00:00+05:30');

// Test hook: set STT_SESSION_CEILING_MIN on Vercel to temporarily lower the
// ceiling (e.g. 2) without a code change. Ignored unless it's a positive number.
export function sessionCeilingSeconds(): number {
  const override = Number(process.env.STT_SESSION_CEILING_MIN);
  const minutes = Number.isFinite(override) && override > 0 ? override : STT_SESSION_CEILING_MIN;
  return minutes * 60;
}

// Tiers whose monthly limit is a HARD stop, enforced even mid-recording.
// Mirrors `enforcement: 'hard'` in config/tiers.ts — paid tiers are 'soft'
// (a recording in progress always finishes; only new recordings are blocked).
export const HARD_MONTHLY_TIERS: ReadonlyArray<'free' | 'pro' | 'max'> = ['free'];

// Guard value for audio that isn't a parseable WAV (inline webm/mp4 blobs).
// The client sends a whole blob inline when it is < 500 KB, which at the
// recorder's 32 kbps (4000 B/s) can hold ~2 minutes — so a flat 30 s would
// undercount. Take the larger of 30 s and the 32 kbps size estimate.
const NON_WAV_MIN_SECONDS = 30;
const NON_WAV_BYTES_PER_SECOND = 4000;
export function nonWavGuardSeconds(bytes: number): number {
  return Math.max(NON_WAV_MIN_SECONDS, bytes / NON_WAV_BYTES_PER_SECOND);
}
