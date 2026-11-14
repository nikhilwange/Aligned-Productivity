import type { SubscriptionState, PlanTier } from '../types';
import { TIERS, minutesToHoursLabel } from '../config/tiers';
import { PAID_TIERS, TIER_CARDS } from '../config/plans';

export type PaywallReason = 'usage_cap' | 'inactive_sub';

export interface PaywallDecision {
  allowed: boolean;
  reason?: PaywallReason;
  message?: string;
  // Which paid tiers to surface in the upgrade UI: every tier above the
  // current one. Free → all paid tiers; Pro → [max]; Max (top tier) → [].
  upgradeTiers?: PlanTier[];
}

/** Paid tiers above `tier`, cheapest first. */
export function upgradeTiersFor(tier: PlanTier): PlanTier[] {
  if (tier === 'free') return [...PAID_TIERS];
  const i = PAID_TIERS.indexOf(tier);
  return i < 0 ? [] : PAID_TIERS.slice(i + 1);
}

const hoursCount = (minutes: number) => String(Math.round((minutes / 60) * 10) / 10);
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/**
 * "Monthly limit reached" copy for Free / Lite / Plus (each names the next
 * plan up). Null for Pro / Max, whose copy is unchanged at each call site.
 */
export function usageCapMessage(tier: PlanTier): string | null {
  switch (tier) {
    case 'free':
      return `You've used your ${hoursCount(TIERS.free.monthlyMinutes)} free hours this month.`;
    case 'lite':
      return `You've used your ${hoursCount(TIERS.lite.monthlyMinutes)} hours this month. Plus gives you ${hoursCount(
        TIERS.plus.monthlyMinutes,
      )} hours for ${inr(TIER_CARDS.plus.monthlyPriceInr)}/month.`;
    case 'plus':
      return `You've used your ${hoursCount(TIERS.plus.monthlyMinutes)} hours this month. Pro gives you ${hoursCount(
        TIERS.pro.monthlyMinutes,
      )} hours for ${inr(TIER_CARDS.pro.monthlyPriceInr)}/month.`;
    default:
      return null;
  }
}

// Pure function — easier to test and reason about than a hook. Caller passes
// the SubscriptionState from useSubscription. The single chokepoint we gate on
// is "can the user start a NEW recording right now". The server enforces the
// in-recording limits (Free hard cap, Lite/Plus grace margin).
export function canStartNewRecording(state: SubscriptionState): PaywallDecision {
  if (state.loading) {
    // Don't block on first paint; fail open — better than blocking a legit
    // user behind a network blip.
    return { allowed: true };
  }

  const { tier } = state;
  // state.caps.minutes is the tier's monthly budget, or Infinity for
  // unlimited-access (admin allowlist) accounts — which are never blocked.
  const limit = state.caps.minutes;
  if (state.usage.minutes < limit) return { allowed: true };

  // Over budget for this tier — block starting a new session.
  const hoursLabel = minutesToHoursLabel(limit);
  const upgradeTiers = upgradeTiersFor(tier);

  const capMessage = usageCapMessage(tier);
  if (capMessage) {
    return { allowed: false, reason: 'usage_cap', message: capMessage, upgradeTiers };
  }

  if (tier === 'pro') {
    return {
      allowed: false,
      reason: 'usage_cap',
      message: `You've reached your ${hoursLabel} this month. Need more? Max gives you ${minutesToHoursLabel(
        TIERS.max.monthlyMinutes,
      )}/month.`,
      upgradeTiers,
    };
  }

  // Max (top tier) — fair-use ceiling reached, nothing higher to sell.
  return {
    allowed: false,
    reason: 'usage_cap',
    message: `You've reached your ${hoursLabel} this month. Usage resets on the 1st. Contact us if you consistently need more.`,
    upgradeTiers,
  };
}
