import { supabase } from './supabaseService';
import type { Subscription, UsageMeter } from '../types';

// Row shapes mirror the snake_case in Supabase. We convert to camelCase in
// the mappers below so the rest of the app stays in TS-idiomatic camelCase.

interface SubscriptionRow {
  user_id: string;
  plan_tier: 'free' | 'pro';
  plan_cycle: 'monthly' | 'annual' | null;
  razorpay_customer_id: string | null;
  razorpay_subscription_id: string | null;
  status: Subscription['status'];
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

interface UsageMeterRow {
  user_id: string;
  period_year: number;
  period_month: number;
  meetings_count: number;
  minutes_used: string | number; // numeric arrives as string from PostgREST
  updated_at: string;
}

function tsMs(s: string | null): number | null {
  if (!s) return null;
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : null;
}

function mapSubscription(row: SubscriptionRow): Subscription {
  return {
    userId: row.user_id,
    planTier: row.plan_tier,
    planCycle: row.plan_cycle,
    razorpayCustomerId: row.razorpay_customer_id,
    razorpaySubscriptionId: row.razorpay_subscription_id,
    status: row.status,
    currentPeriodStart: tsMs(row.current_period_start),
    currentPeriodEnd: tsMs(row.current_period_end),
    cancelAtPeriodEnd: row.cancel_at_period_end,
    createdAt: tsMs(row.created_at) ?? Date.now(),
    updatedAt: tsMs(row.updated_at) ?? Date.now(),
  };
}

function mapMeter(row: UsageMeterRow): UsageMeter {
  return {
    userId: row.user_id,
    periodYear: row.period_year,
    periodMonth: row.period_month,
    meetingsCount: row.meetings_count,
    minutesUsed: typeof row.minutes_used === 'string' ? Number(row.minutes_used) : row.minutes_used,
    updatedAt: tsMs(row.updated_at) ?? Date.now(),
  };
}

export const fetchSubscription = async (userId: string): Promise<Subscription | null> => {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('[Subscriptions] fetch failed:', error);
    return null;
  }
  return data ? mapSubscription(data as SubscriptionRow) : null;
};

export const fetchUsageThisMonth = async (userId: string): Promise<UsageMeter> => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const { data, error } = await supabase
    .from('usage_meters')
    .select('*')
    .eq('user_id', userId)
    .eq('period_year', year)
    .eq('period_month', month)
    .maybeSingle();
  if (error) {
    console.error('[Subscriptions] usage fetch failed:', error);
  }
  if (data) return mapMeter(data as UsageMeterRow);
  // Empty meter — user hasn't recorded anything this month yet.
  return {
    userId,
    periodYear: year,
    periodMonth: month,
    meetingsCount: 0,
    minutesUsed: 0,
    updatedAt: Date.now(),
  };
};

type Unsubscribe = () => void;

// Hooks the caller up to live updates on both tables. Webhook writes to
// subscriptions land here within ~1s; the usage_meters update fires every
// time the user starts a new recording (via the bump_usage_meter trigger).
export const subscribeToBillingChanges = (
  userId: string,
  onChange: () => void,
): Unsubscribe => {
  const channel = supabase
    .channel(`billing-${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'subscriptions', filter: `user_id=eq.${userId}` },
      () => onChange(),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'usage_meters', filter: `user_id=eq.${userId}` },
      () => onChange(),
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
};

// Server endpoints — thin wrappers so components don't construct fetches.
async function authedFetch(path: string, body?: unknown): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export interface CreateSubscriptionResponse {
  subscription_id: string;
  key_id: string;
  customer_id: string;
  customer_email: string | null;
  short_url: string | null;
}

export const createRazorpaySubscription = async (
  cycle: 'monthly' | 'annual',
): Promise<CreateSubscriptionResponse> => {
  const res = await authedFetch('/api/razorpay/create-subscription', { cycle });
  // Parse defensively: a 404/5xx (or a missing /api layer in local dev) can
  // return an empty or non-JSON body, which would otherwise surface as the
  // cryptic "Unexpected end of JSON input" instead of a useful message.
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    throw new Error(json?.error ?? `Checkout is unavailable right now (HTTP ${res.status}). Please try again shortly.`);
  }
  return json as CreateSubscriptionResponse;
};

export const cancelRazorpaySubscription = async (): Promise<void> => {
  const res = await authedFetch('/api/razorpay/cancel-subscription');
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
};
