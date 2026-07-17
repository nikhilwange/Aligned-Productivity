// Thin Razorpay REST wrapper. Razorpay's npm SDK works fine, but the surface
// we actually use is small and a hand-rolled fetch is easier to reason about
// in error cases (we can pass the body straight back to the caller).
//
// Auth: HTTP Basic with key_id:key_secret. Documented at
// https://razorpay.com/docs/api/authentication/

const BASE = 'https://api.razorpay.com/v1';

function authHeader(): string {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !secret) {
    throw new Error('Server misconfiguration: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set.');
  }
  return 'Basic ' + Buffer.from(`${keyId}:${secret}`).toString('base64');
}

async function rzpFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Razorpay ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return (text ? JSON.parse(text) : ({} as unknown)) as T;
}

// ─── Customer ────────────────────────────────────────────────────────────
export interface RzpCustomer {
  id: string;
  email: string;
  name: string | null;
  contact: string | null;
}

export async function createCustomer(input: {
  email: string;
  name?: string | null;
  fail_existing?: '0' | '1';
}): Promise<RzpCustomer> {
  // fail_existing=0 returns the existing record if Razorpay already has a
  // customer with this email, instead of erroring. Matches our "one Razorpay
  // customer per app user" model.
  return rzpFetch<RzpCustomer>('/customers', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email,
      name: input.name ?? undefined,
      fail_existing: input.fail_existing ?? '0',
    }),
  });
}

// ─── Subscription ───────────────────────────────────────────────────────
export interface RzpSubscription {
  id: string;
  status: string;
  plan_id: string;
  customer_id: string;
  current_start: number | null;  // unix seconds
  current_end: number | null;
  short_url?: string | null;
  total_count?: number;
  paid_count?: number;
  notes?: Record<string, string>;
}

export async function createSubscription(input: {
  plan_id: string;
  customer_id?: string;
  total_count?: number;
  customer_notify?: 0 | 1;
  notes?: Record<string, string>;
}): Promise<RzpSubscription> {
  return rzpFetch<RzpSubscription>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      plan_id: input.plan_id,
      total_count: input.total_count ?? 1200, // ~100 yrs monthly, effectively open-ended
      customer_notify: input.customer_notify ?? 1,
      customer_id: input.customer_id,
      notes: input.notes,
    }),
  });
}

export async function cancelSubscription(
  subscriptionId: string,
  cancelAtCycleEnd = true,
): Promise<RzpSubscription> {
  return rzpFetch<RzpSubscription>(`/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0 }),
  });
}

export async function fetchSubscription(subscriptionId: string): Promise<RzpSubscription> {
  return rzpFetch<RzpSubscription>(`/subscriptions/${subscriptionId}`, { method: 'GET' });
}
