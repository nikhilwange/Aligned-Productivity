import type { PlanTier } from '../types';

// Thrown when a transcription call is refused by the server-side usage gate
// (HTTP 402 { error: 'usage_limit', tier, usedMinutes, limitMinutes,
// reject_reason? }). The pipeline catches this and shows a friendly "monthly
// limit reached — upgrade" state instead of a generic red failure, and never
// retries on it.
//
// `rejectReason` tells the STT ledger guard's two limits apart:
//   'session_ceiling' — this recording hit the per-recording STT ceiling
//                       (STT_SESSION_CEILING_MIN). Not a billing problem: the
//                       recorder stops and the session is saved as-is.
//   'monthly_limit'   — the user's monthly STT budget is used up.
// Absent for the older sessionStart gate (treated as a monthly limit).
export type UsageRejectReason = 'session_ceiling' | 'monthly_limit';

export interface UsageLimitInfo {
  tier: PlanTier;
  usedMinutes: number;
  limitMinutes: number;
  rejectReason?: UsageRejectReason;
}

export class UsageLimitError extends Error {
  tier: PlanTier;
  usedMinutes: number;
  limitMinutes: number;
  rejectReason?: UsageRejectReason;
  constructor(info: Partial<UsageLimitInfo> = {}) {
    super('usage_limit');
    this.name = 'UsageLimitError';
    this.tier = (info.tier as PlanTier) ?? 'free';
    this.usedMinutes = info.usedMinutes ?? 0;
    this.limitMinutes = info.limitMinutes ?? 0;
    this.rejectReason = info.rejectReason;
  }
}

export function isUsageLimitError(e: unknown): e is UsageLimitError {
  return (
    e instanceof UsageLimitError ||
    (typeof e === 'object' && e !== null && (e as any).name === 'UsageLimitError')
  );
}

/** True when the server refused because this recording hit the STT ceiling. */
export function isSessionCeilingError(e: unknown): boolean {
  return isUsageLimitError(e) && (e as UsageLimitError).rejectReason === 'session_ceiling';
}

export function usageLimitFromBody(body: any): UsageLimitError {
  const reason = body?.reject_reason;
  return new UsageLimitError({
    tier: body?.tier,
    usedMinutes: body?.usedMinutes,
    limitMinutes: body?.limitMinutes,
    rejectReason: reason === 'session_ceiling' || reason === 'monthly_limit' ? reason : undefined,
  });
}
