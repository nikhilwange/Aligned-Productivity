// Server-side mirror of config/tiers.ts. The Vercel API layer can't import the
// Vite client config (import.meta.env), so the tier numbers and plan-ID→tier
// mapping are duplicated here.
//
// ⚠️ SOURCE OF TRUTH IS config/tiers.ts. If a monthly-minutes budget changes,
// update it here, in config/tiers.ts, and in the gemini-transcribe-audio Edge
// Function (which can't import either).

export type ServerTier = 'free' | 'pro' | 'max';

export const TIER_MONTHLY_MINUTES: Record<ServerTier, number> = {
  free: 300,
  pro: 1200,
  max: 3600,
};

// Razorpay plan IDs come from (non-VITE) server env. Monthly + Annual Pro map
// to the same `pro` tier; Max is its own. Unknown/empty → free.
export function tierFromPlanId(planId: string | null | undefined): ServerTier {
  if (!planId) return 'free';
  if (planId === process.env.RAZORPAY_PLAN_ID_MAX) return 'max';
  if (
    planId === process.env.RAZORPAY_PLAN_ID_MONTHLY ||
    planId === process.env.RAZORPAY_PLAN_ID_ANNUAL
  ) {
    return 'pro';
  }
  return 'free';
}

// Which checkout plan the client asked for → { planId, cycle }.
export type CheckoutPlan = 'monthly' | 'annual' | 'max';

export function planConfigFor(
  plan: CheckoutPlan,
): { planId: string | undefined; cycle: 'monthly' | 'annual'; envKey: string } {
  switch (plan) {
    case 'annual':
      return { planId: process.env.RAZORPAY_PLAN_ID_ANNUAL, cycle: 'annual', envKey: 'RAZORPAY_PLAN_ID_ANNUAL' };
    case 'max':
      // Max is billed monthly.
      return { planId: process.env.RAZORPAY_PLAN_ID_MAX, cycle: 'monthly', envKey: 'RAZORPAY_PLAN_ID_MAX' };
    case 'monthly':
    default:
      return { planId: process.env.RAZORPAY_PLAN_ID_MONTHLY, cycle: 'monthly', envKey: 'RAZORPAY_PLAN_ID_MONTHLY' };
  }
}

// Resolve the tier a stored subscription row grants right now. Keeps paid
// access through payment trouble (halted/pending) and until period-end after
// a cancellation — mirrors config/tiers.ts hasLiveAccess().
export function resolveTierFromSubscription(sub: {
  plan_tier?: string | null;
  status?: string | null;
  current_period_end?: string | null;
} | null): ServerTier {
  if (!sub || !sub.plan_tier || sub.plan_tier === 'free') return 'free';
  const s = sub.status;
  const live =
    s === 'active' ||
    s === 'halted' ||
    s === 'pending' ||
    (s === 'cancelled' &&
      sub.current_period_end != null &&
      Date.parse(sub.current_period_end) > Date.now());
  if (!live) return 'free';
  return (sub.plan_tier === 'max' ? 'max' : 'pro');
}
