import type { PlanTier } from '../types';

// Thrown when a transcription call is refused by the server-side usage gate
// (HTTP 402 { error: 'usage_limit', tier, usedMinutes, limitMinutes }). The
// pipeline catches this and shows a friendly "monthly limit reached — upgrade"
// state instead of a generic red failure, and never retries on it.
export interface UsageLimitInfo {
  tier: PlanTier;
  usedMinutes: number;
  limitMinutes: number;
}

export class UsageLimitError extends Error {
  tier: PlanTier;
  usedMinutes: number;
  limitMinutes: number;
  constructor(info: Partial<UsageLimitInfo> = {}) {
    super('usage_limit');
    this.name = 'UsageLimitError';
    this.tier = (info.tier as PlanTier) ?? 'free';
    this.usedMinutes = info.usedMinutes ?? 0;
    this.limitMinutes = info.limitMinutes ?? 0;
  }
}

export function isUsageLimitError(e: unknown): e is UsageLimitError {
  return (
    e instanceof UsageLimitError ||
    (typeof e === 'object' && e !== null && (e as any).name === 'UsageLimitError')
  );
}

export function usageLimitFromBody(body: any): UsageLimitError {
  return new UsageLimitError({
    tier: body?.tier,
    usedMinutes: body?.usedMinutes,
    limitMinutes: body?.limitMinutes,
  });
}
