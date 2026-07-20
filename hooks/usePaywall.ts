import type { SubscriptionState, PlanTier } from '../types';
import { TIERS, minutesToHoursLabel } from '../config/tiers';

export type PaywallReason = 'usage_cap' | 'inactive_sub';

export interface PaywallDecision {
  allowed: boolean;
  reason?: PaywallReason;
  message?: string;
  // Which paid tiers to surface in the upgrade UI. Free → [pro, max];
  // Pro (soft cap) → [max]; Max (top tier) → [].
  upgradeTiers?: PlanTier[];
}

// Pure function — easier to test and reason about than a hook. Caller passes
// the SubscriptionState from useSubscription. The single chokepoint we gate on
// is "can the user start a NEW recording right now". A session already in
// flight is never interrupted (we only check at start), and the server gate
// computes usage from completed sessions so the current one always finishes.
export function canStartNewRecording(state: SubscriptionState): PaywallDecision {
  if (state.loading) {
    // Don't block on first paint; fail open — better than blocking a legit
    // user behind a network blip.
    return { allowed: true };
  }

  const { tier } = state;
  const limit = TIERS[tier].monthlyMinutes;
  if (state.usage.minutes < limit) return { allowed: true };

  // Over budget for this tier — block starting a new session.
  const hoursLabel = minutesToHoursLabel(limit);

  if (tier === 'free') {
    return {
      allowed: false,
      reason: 'usage_cap',
      message: `You've used your ${hoursLabel} of free recording this month.`,
      upgradeTiers: ['pro', 'max'],
    };
  }

  if (tier === 'pro') {
    return {
      allowed: false,
      reason: 'usage_cap',
      message: `You've reached your ${hoursLabel} this month. Need more? Max gives you ${minutesToHoursLabel(
        TIERS.max.monthlyMinutes,
      )}/month.`,
      upgradeTiers: ['max'],
    };
  }

  // Max (top tier) — fair-use ceiling reached, nothing higher to sell.
  return {
    allowed: false,
    reason: 'usage_cap',
    message: `You've reached your ${hoursLabel} this month. Usage resets on the 1st. Contact us if you consistently need more.`,
    upgradeTiers: [],
  };
}
