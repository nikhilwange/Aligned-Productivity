import type { SupabaseClient } from '@supabase/supabase-js';
import { TIER_MONTHLY_MINUTES, resolveTierFromSubscription, type ServerTier } from './tiers.js';

export interface UsageGateResult {
  allowed: boolean;
  tier: ServerTier;
  usedMinutes: number;
  limitMinutes: number;
}

// Server-side usage gate. Given a Supabase client scoped to the user's JWT,
// resolves their tier and this month's COMPLETED billable audio-minutes (via
// the monthly_audio_usage() RPC, which excludes in-flight 'processing'
// sessions) and decides whether a NEW session may start.
//
// FAIL OPEN: any error in the metering lookup lets the request through. Never
// let billing break the core transcription pipeline.
export async function checkUsageAllowed(
  userClient: SupabaseClient,
  userId: string,
): Promise<UsageGateResult> {
  try {
    const { data: sub } = await userClient
      .from('subscriptions')
      .select('plan_tier, status, current_period_end')
      .eq('user_id', userId)
      .maybeSingle();

    const tier = resolveTierFromSubscription(sub ?? null);
    const limitMinutes = TIER_MONTHLY_MINUTES[tier];

    const { data: used, error } = await userClient.rpc('monthly_audio_usage');
    if (error) {
      console.warn('[usage-gate] usage RPC failed — failing open:', error.message);
      return { allowed: true, tier, usedMinutes: 0, limitMinutes };
    }

    const usedMinutes = Number(used ?? 0);
    return { allowed: usedMinutes < limitMinutes, tier, usedMinutes, limitMinutes };
  } catch (e: any) {
    console.warn('[usage-gate] unexpected error — failing open:', e?.message ?? e);
    return { allowed: true, tier: 'free', usedMinutes: 0, limitMinutes: TIER_MONTHLY_MINUTES.free };
  }
}
