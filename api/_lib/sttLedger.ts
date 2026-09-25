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

export type SttRejectReason =
  | 'session_ceiling'
  | 'monthly_limit'
  | 'stt_disabled'
  | 'missing_recovery_id'
  | 'inline_too_long'
  | 'inline_not_wav';

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

// ─── WebM duration scanner ──────────────────────────────────────────────────
// Only for inline requests from OLD clients, which sent the raw MediaRecorder
// WebM. MediaRecorder writes no Duration element, so the length is read from
// the timestamps: the last (Simple)Block's cluster time + relative time.
// Walks the EBML structure, treating Segment / Cluster / BlockGroup as
// transparent containers (their size is often "unknown" in a live
// recording). Returns null if it can't make sense of the bytes. NEVER throws.

const EBML_SEGMENT = 0x18538067;
const EBML_CLUSTER = 0x1f43b675;
const EBML_BLOCK_GROUP = 0xa0;
const EBML_TIMECODE_SCALE = 0x2ad7b1;
const EBML_INFO = 0x1549a966;
const EBML_CLUSTER_TIMECODE = 0xe7;
const EBML_SIMPLE_BLOCK = 0xa3;
const EBML_BLOCK = 0xa1;

/** EBML variable-length integer at `pos`. `raw` keeps the length marker (element IDs). */
function readVint(buf: Buffer, pos: number, raw: boolean): { value: number; length: number; unknown: boolean } | null {
  if (pos >= buf.length) return null;
  const first = buf[pos];
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && !(first & mask)) { length++; mask >>= 1; }
  if (length > 8 || pos + length > buf.length) return null;
  let value = raw ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < length; i++) {
    value = value * 256 + buf[pos + i];
    if (buf[pos + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !raw && allOnes };
}

function readUint(buf: Buffer, pos: number, size: number): number {
  let v = 0;
  for (let i = 0; i < size && i < 8; i++) v = v * 256 + buf[pos + i];
  return v;
}

export function webmSeconds(buf: Buffer): number | null {
  try {
    if (buf.length < 4 || buf.readUInt32BE(0) !== 0x1a45dfa3) return null;
    let timecodeScaleNs = 1_000_000;
    let clusterTime = 0;
    let maxTicks = -1;
    let pos = 0;
    let guard = 0;
    while (pos < buf.length && guard++ < 1_000_000) {
      const id = readVint(buf, pos, true);
      if (!id) break;
      const size = readVint(buf, pos + id.length, false);
      if (!size) break;
      const dataStart = pos + id.length + size.length;
      const transparent =
        id.value === EBML_SEGMENT || id.value === EBML_CLUSTER ||
        id.value === EBML_BLOCK_GROUP || id.value === EBML_INFO;
      if (transparent) { pos = dataStart; continue; } // descend into children
      if (size.unknown) break; // unknown size on a leaf: can't continue safely
      const dataEnd = dataStart + size.value;
      if (dataEnd > buf.length) break; // truncated tail
      if (id.value === EBML_TIMECODE_SCALE) {
        timecodeScaleNs = readUint(buf, dataStart, size.value) || timecodeScaleNs;
      } else if (id.value === EBML_CLUSTER_TIMECODE) {
        clusterTime = readUint(buf, dataStart, size.value);
      } else if (id.value === EBML_SIMPLE_BLOCK || id.value === EBML_BLOCK) {
        const track = readVint(buf, dataStart, false);
        if (track && dataStart + track.length + 2 <= dataEnd) {
          const rel = buf.readInt16BE(dataStart + track.length);
          maxTicks = Math.max(maxTicks, clusterTime + rel);
        }
      }
      pos = dataEnd;
    }
    if (maxTicks < 0) return null;
    // + one Opus frame (20 ms) for the last block's own length.
    return (maxTicks * timecodeScaleNs) / 1e9 + 0.02;
  } catch {
    return null;
  }
}

/** Seconds of audio to account for this request (server-computed). */
export function audioSecondsFor(buf: Buffer): number {
  const secs = wavSeconds(buf) ?? webmSeconds(buf) ?? nonWavGuardSeconds(buf.length);
  return Math.round(secs * 100) / 100; // numeric(10,2)
}

/** Sarvam's REST limit for one request. */
export const INLINE_LIMIT_SECONDS = 30;

/**
 * Should this INLINE request be refused before it reaches Sarvam?
 *   WAV     → exact length from the header; over 30 s is refused.
 *   non-WAV → a current client (X-Aligned-Client) only ever sends decoded WAV
 *             inline, so anything else is refused outright. An old client
 *             is measured with the WebM scanner, falling back to bytes ÷ 4000.
 * Never throws.
 */
export function inlineRejection(
  buf: Buffer,
  isCurrentClient: boolean,
): { reason: 'inline_too_long' | 'inline_not_wav'; seconds: number | null; how: string } | null {
  try {
    const wav = wavSeconds(buf);
    if (wav !== null) {
      return wav > INLINE_LIMIT_SECONDS ? { reason: 'inline_too_long', seconds: wav, how: 'wav header' } : null;
    }
    if (isCurrentClient) return { reason: 'inline_not_wav', seconds: null, how: 'current client sent non-WAV inline' };
    const webm = webmSeconds(buf);
    const seconds = webm ?? buf.length / 4000;
    const how = webm !== null ? 'webm timestamps' : 'bytes / 4000';
    return seconds > INLINE_LIMIT_SECONDS ? { reason: 'inline_too_long', seconds, how } : null;
  } catch {
    return null;
  }
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
