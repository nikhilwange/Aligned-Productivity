// STT ledger + cost guard for the Sarvam proxy.
//
// Every Sarvam request the proxy makes (or refuses) is written to
// public.stt_ledger with the service-role client, and before each call the
// proxy checks two server-side limits against that ledger:
//   - per-recording ceiling  (STT_SESSION_CEILING_MIN, all tiers)
//   - per-user monthly limit (TIER_MONTHLY_MINUTES, IST calendar month) —
//     every request for Free; only a recording's first request for Pro/Max
// Audio length is always computed here from the bytes — never trusted from the
// client. See supabase/sql/stt_ledger.sql for the table and functions.
//
// FAIL OPEN, like usageGate.ts: a guard lookup or ledger write that errors is
// logged and never blocks or fails a transcription.

import { getSupabaseAdmin } from './supabaseAdmin.js';
import {
  TIER_MONTHLY_MINUTES,
  resolveTierFromSubscription,
  hasUnlimitedAccess,
  type ServerTier,
} from './tiers.js';
import {
  sessionCeilingSeconds,
  nonWavGuardSeconds,
  HARD_MONTHLY_TIERS,
} from './sttLimits.js';

export type SttRejectReason = 'session_ceiling' | 'monthly_limit' | 'stt_disabled' | 'missing_recovery_id';

export interface LedgerRow {
  user_id: string;
  recovery_id: string | null;
  segment_index: number | null;
  audio_seconds: number | null;
  bytes: number | null;
  status: 'ok' | 'error' | 'rejected';
  http_status: number | null;
  reject_reason?: SttRejectReason | null;
  path: 'inline' | 'storage' | null;
}

/**
 * Split the client's `recoveryId` into the base id and segment index.
 * `rec-123:seg4` → { rec-123, 4 }; `rec-123` → { rec-123, null }; missing → nulls.
 */
export function parseRecoveryId(raw: unknown): { recoveryId: string | null; segmentIndex: number | null } {
  if (typeof raw !== 'string' || raw.trim() === '') return { recoveryId: null, segmentIndex: null };
  const m = /^(.*):seg(\d+)$/.exec(raw.trim());
  if (m && m[1]) return { recoveryId: m[1], segmentIndex: Number(m[2]) };
  return { recoveryId: raw.trim(), segmentIndex: null };
}

/**
 * Duration of a PCM WAV from its header: data bytes / (rate × channels × bytes
 * per sample). Walks the RIFF chunks rather than assuming a 44-byte header, so
 * mono and stereo chunks (and any extra chunks) are both handled. Returns null
 * when the buffer isn't a parseable WAV.
 */
export function wavSeconds(buf: Buffer): number | null {
  if (buf.length < 12) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;

  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataBytes: number | null = null;

  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= buf.length) {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      // Clamp to what was actually received (a truncated/streamed header can
      // claim more than the buffer holds).
      dataBytes = Math.min(size, buf.length - body);
      break;
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }

  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
  if (dataBytes === null || !(bytesPerSecond > 0)) return null;
  return dataBytes / bytesPerSecond;
}

/** Seconds of audio to account for this request (server-computed). */
export function audioSecondsFor(buf: Buffer): number {
  const wav = wavSeconds(buf);
  const secs = wav ?? nonWavGuardSeconds(buf.length);
  return Math.round(secs * 100) / 100; // numeric(10,2)
}

/** Current calendar year/month in Asia/Kolkata (UTC+5:30, no DST). */
export function istYearMonth(now = Date.now()): { year: number; month: number } {
  const ist = new Date(now + 330 * 60 * 1000);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1 };
}

export interface GuardRejection {
  reason: 'session_ceiling' | 'monthly_limit';
  tier: ServerTier;
  usedMinutes: number;
  limitMinutes: number;
}

/**
 * Would sending `audioSeconds` more exceed the recording ceiling or the user's
 * monthly limit? Returns the rejection, or null when the call may proceed.
 * Two concurrent chunks can both pass the check and overshoot slightly —
 * accepted by design, no locking.
 */
export async function checkSttGuards(opts: {
  userId: string;
  email: string | null | undefined;
  recoveryId: string | null;
  audioSeconds: number;
  /** Client's sessionStart flag — only used when recoveryId is missing. */
  sessionStart: boolean;
}): Promise<GuardRejection | null> {
  const { userId, email, recoveryId, audioSeconds, sessionStart } = opts;
  // The ceiling applies to everyone, unlimited-access accounts included; those
  // only skip the monthly limit.
  const checkCeiling = !!recoveryId;
  const checkMonthly = !hasUnlimitedAccess(email);
  if (!checkCeiling && !checkMonthly) return null;

  try {
    const admin = getSupabaseAdmin();
    const { year, month } = istYearMonth();

    // The recording's own usage is needed for the ceiling AND to tell whether
    // this is the recording's first transcription (see the monthly check).
    const [recoveryRes, monthRes, subRes] = await Promise.all([
      recoveryId
        ? admin.rpc('stt_seconds_for_recovery', { p_recovery_id: recoveryId })
        : Promise.resolve(null),
      checkMonthly
        ? admin.rpc('stt_seconds_for_user_month', { p_user_id: userId, p_year: year, p_month: month })
        : Promise.resolve(null),
      checkMonthly
        ? admin
            .from('subscriptions')
            .select('plan_tier, status, current_period_end')
            .eq('user_id', userId)
            .maybeSingle()
        : Promise.resolve(null),
    ]);

    // A failed subscription lookup must not demote a paying user to the free
    // limit — skip the monthly check instead (fail open).
    const subFailed = !!subRes?.error;
    if (subFailed) console.warn('[stt-guard] subscription lookup failed — skipping monthly check:', subRes!.error!.message);
    const tier: ServerTier = subRes && !subFailed ? resolveTierFromSubscription(subRes.data ?? null) : 'free';

    if (checkCeiling && recoveryRes) {
      if (recoveryRes.error) {
        console.warn('[stt-guard] recovery lookup failed — failing open:', recoveryRes.error.message);
      } else {
        const used = Number(recoveryRes.data ?? 0);
        const ceiling = sessionCeilingSeconds();
        if (used + audioSeconds > ceiling) {
          return {
            reason: 'session_ceiling',
            tier,
            usedMinutes: Math.round(used / 60),
            limitMinutes: Math.round(ceiling / 60),
          };
        }
      }
    }

    // Paid tiers are soft-capped (config/tiers.ts): a recording that has
    // already started is always allowed to finish, so the monthly limit only
    // blocks the START of a new recording for them. Free is hard-capped and is
    // checked on every request. A failed recovery lookup counts as "started"
    // (fail open).
    const recordingStarted = recoveryId
      ? !recoveryRes || !!recoveryRes.error || Number(recoveryRes.data ?? 0) > 0
      : !sessionStart;
    const monthlyApplies = HARD_MONTHLY_TIERS.includes(tier) || !recordingStarted;

    if (checkMonthly && monthlyApplies && monthRes && !subFailed) {
      if (monthRes.error) {
        console.warn('[stt-guard] monthly lookup failed — failing open:', monthRes.error.message);
      } else {
        const used = Number(monthRes.data ?? 0);
        const limitMinutes = TIER_MONTHLY_MINUTES[tier];
        if (used + audioSeconds > limitMinutes * 60) {
          return {
            reason: 'monthly_limit',
            tier,
            usedMinutes: Math.round(used / 60),
            limitMinutes,
          };
        }
      }
    }

    return null;
  } catch (e: any) {
    console.warn('[stt-guard] unexpected error — failing open:', e?.message ?? e);
    return null;
  }
}

/** Append one ledger row. Never throws — a ledger failure must not fail STT. */
export async function writeLedgerRow(row: LedgerRow): Promise<void> {
  try {
    const { error } = await getSupabaseAdmin()
      .from('stt_ledger')
      .insert({ ...row, reject_reason: row.reject_reason ?? null, provider: 'sarvam' });
    if (error) console.error('[stt-ledger] insert failed:', error.message);
  } catch (e: any) {
    console.error('[stt-ledger] insert threw:', e?.message ?? e);
  }
}
