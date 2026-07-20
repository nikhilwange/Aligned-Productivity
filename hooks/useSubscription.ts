import { useCallback, useEffect, useState } from 'react';
import {
  fetchSubscription,
  fetchUsageThisMonth,
  subscribeToBillingChanges,
} from '../services/subscriptionService';
import { FREE_CAP_MEETINGS } from '../config/plans';
import { TIERS, effectiveTier, hasUnlimitedAccess } from '../config/tiers';
import type { Subscription, SubscriptionState, UsageMeter } from '../types';

// Single source of truth for "what tier is this user on and how much have they
// used this month?". Wires up Supabase Realtime so the webhook-driven tier flip
// (and the usage bump on each new recording) lands in the UI without a refresh.

const EMPTY_USAGE: UsageMeter = {
  userId: '',
  periodYear: 0,
  periodMonth: 0,
  meetingsCount: 0,
  minutesUsed: 0,
  updatedAt: 0,
};

const INITIAL: SubscriptionState = {
  subscription: null,
  tier: 'free',
  usage: { meetings: 0, minutes: 0 },
  caps: { meetings: FREE_CAP_MEETINGS, minutes: TIERS.free.monthlyMinutes },
  sessionCapMinutes: TIERS.free.sessionCapMinutes,
  isPro: false,
  isOverCap: false,
  capPercent: 0,
  loading: true,
};

function derive(sub: Subscription | null, usage: UsageMeter, unlimited: boolean): SubscriptionState {
  // Resolve the effective tier from the subscription. `effectiveTier` keeps
  // paid access through payment trouble (halted / pending) and until
  // period-end after a cancellation — matching the webhook's semantics.
  const tier = effectiveTier(
    sub
      ? { planTier: sub.planTier, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd }
      : null,
  );
  const tierConfig = TIERS[tier];
  const isPro = tier !== 'free'; // any paid tier (pro OR max)

  const minutes = usage.minutesUsed;
  const meetings = usage.meetingsCount;

  // Unlimited-access accounts (admin allowlist) have no monthly budget and no
  // per-session cap, and are never over cap — the paywall reads these fields.
  const monthlyMinutes = unlimited ? Number.POSITIVE_INFINITY : tierConfig.monthlyMinutes;

  // Every tier now has a monthly audio-minutes budget; Free enforces it as a
  // hard block, Pro/Max as a soft cap (gating lives in usePaywall). Meetings
  // are no longer part of gating — kept for legacy display only.
  const caps = { meetings: FREE_CAP_MEETINGS, minutes: monthlyMinutes };
  const capPercent = unlimited ? 0 : Math.min(1, minutes / tierConfig.monthlyMinutes);
  const isOverCap = unlimited ? false : minutes >= tierConfig.monthlyMinutes;

  return {
    subscription: sub,
    tier,
    usage: { meetings, minutes },
    caps,
    sessionCapMinutes: unlimited ? null : tierConfig.sessionCapMinutes,
    isPro,
    isOverCap,
    capPercent,
    loading: false,
  };
}

export function useSubscription(
  userId: string | null,
  email?: string | null,
): SubscriptionState & { refetch: () => void } {
  const [state, setState] = useState<SubscriptionState>(INITIAL);
  const unlimited = hasUnlimitedAccess(email);

  const refetch = useCallback(async () => {
    if (!userId) return;
    const [sub, usage] = await Promise.all([
      fetchSubscription(userId),
      fetchUsageThisMonth(userId),
    ]);
    setState(derive(sub, usage, unlimited));
  }, [userId, unlimited]);

  useEffect(() => {
    if (!userId) {
      setState({ ...INITIAL, loading: false });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));
    (async () => {
      const [sub, usage] = await Promise.all([
        fetchSubscription(userId),
        fetchUsageThisMonth(userId),
      ]);
      if (!cancelled) setState(derive(sub, usage, unlimited));
    })();
    const unsub = subscribeToBillingChanges(userId, () => {
      if (!cancelled) void refetch();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [userId, unlimited, refetch]);

  return { ...state, refetch };
}

// Convenience for areas that only need the EMPTY_USAGE constant.
export { EMPTY_USAGE };
