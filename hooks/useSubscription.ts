import { useCallback, useEffect, useState } from 'react';
import {
  fetchSubscription,
  fetchUsageThisMonth,
  subscribeToBillingChanges,
} from '../services/subscriptionService';
import { FREE_CAP_MEETINGS, FREE_CAP_MINUTES } from '../config/plans';
import type { Subscription, SubscriptionState, UsageMeter } from '../types';

// Single source of truth for "what plan does this user have and how much have
// they used this month?". Wires up Supabase Realtime so the webhook-driven
// tier flip lands in the UI without a refresh.

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
  usage: { meetings: 0, minutes: 0 },
  caps: { meetings: FREE_CAP_MEETINGS, minutes: FREE_CAP_MINUTES },
  isPro: false,
  isOverCap: false,
  capPercent: 0,
  loading: true,
};

function derive(sub: Subscription | null, usage: UsageMeter): SubscriptionState {
  const isPro = sub?.planTier === 'pro' && (sub.status === 'active' || sub.status === 'halted');
  const caps = isPro ? null : { meetings: FREE_CAP_MEETINGS, minutes: FREE_CAP_MINUTES };
  const meetings = usage.meetingsCount;
  const minutes = usage.minutesUsed;
  let capPercent = 0;
  let isOverCap = false;
  if (caps) {
    const pctMeetings = meetings / caps.meetings;
    const pctMinutes = minutes / caps.minutes;
    capPercent = Math.min(1, Math.max(pctMeetings, pctMinutes));
    isOverCap = pctMeetings >= 1 || pctMinutes >= 1;
  }
  return {
    subscription: sub,
    usage: { meetings, minutes },
    caps,
    isPro,
    isOverCap,
    capPercent,
    loading: false,
  };
}

export function useSubscription(userId: string | null): SubscriptionState & { refetch: () => void } {
  const [state, setState] = useState<SubscriptionState>(INITIAL);

  const refetch = useCallback(async () => {
    if (!userId) return;
    const [sub, usage] = await Promise.all([
      fetchSubscription(userId),
      fetchUsageThisMonth(userId),
    ]);
    setState(derive(sub, usage));
  }, [userId]);

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
      if (!cancelled) setState(derive(sub, usage));
    })();
    const unsub = subscribeToBillingChanges(userId, () => {
      if (!cancelled) void refetch();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [userId, refetch]);

  return { ...state, refetch };
}

// Convenience for areas that only need the EMPTY_USAGE constant.
export { EMPTY_USAGE };
