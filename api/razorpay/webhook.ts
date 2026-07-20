import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import getRawBody from 'raw-body';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { tierFromPlanId } from '../_lib/tiers.js';

// Razorpay → us. No JWT. Auth = HMAC over the raw request body, keyed by
// the webhook secret configured in Razorpay's dashboard.
//
// Rules of engagement with Razorpay's webhook retry policy:
//   - 2xx response → done, no retry.
//   - 4xx → no retry (Razorpay treats it as terminal).
//   - 5xx / timeout → retried with exponential backoff for up to 24h.
// We return 200 for all signature-valid events even if our downstream DB
// write fails — the error is captured in subscription_events.error and an
// operator can replay from there. Retry-storms are worse than a missed row.

// Body parser must be off so we can read the raw bytes for HMAC.
export const config = {
  api: { bodyParser: false },
};

type SubscriptionStatus =
  | 'created'
  | 'authenticated'
  | 'active'
  | 'pending'
  | 'halted'
  | 'cancelled'
  | 'completed'
  | 'expired';

interface RzpEventEnvelope {
  entity: 'event';
  account_id: string;
  event: string;
  contains: string[];
  payload: {
    subscription?: { entity: RzpSubscriptionEntity };
    payment?: { entity: Record<string, unknown> };
  };
  created_at: number;
}

interface RzpSubscriptionEntity {
  id: string;
  status: SubscriptionStatus;
  customer_id: string | null;
  plan_id: string;
  current_start: number | null;
  current_end: number | null;
  ended_at: number | null;
  paused_at: number | null;
  cancelled_at: number | null;
  notes?: Record<string, string> | null;
}

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function tsToIso(ts: number | null | undefined): string | null {
  if (!ts) return null;
  return new Date(ts * 1000).toISOString();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET missing');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  let rawBody: Buffer;
  try {
    rawBody = await getRawBody(req, { limit: '1mb' });
  } catch (err: any) {
    return res.status(400).json({ error: `Could not read body: ${err?.message ?? 'unknown'}` });
  }
  const bodyStr = rawBody.toString('utf-8');

  const signature = (req.headers['x-razorpay-signature'] ?? '') as string;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (!signature || !timingSafeEqual(signature, expected)) {
    console.warn('[razorpay-webhook] signature mismatch');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // x-razorpay-event-id is provided per delivery; it's the dedupe key. Same
  // event re-delivered after our 5xx retains the same id.
  const eventId = (req.headers['x-razorpay-event-id'] ?? '') as string;
  if (!eventId) {
    // Synthesize from body hash so the UNIQUE constraint can still dedupe.
    // Razorpay normally provides the header, but defensive in case of test
    // tooling that doesn't.
    const fallbackId = 'sha256:' + crypto.createHash('sha256').update(rawBody).digest('hex').slice(0, 32);
    return processEvent(res, fallbackId, bodyStr);
  }
  return processEvent(res, eventId, bodyStr);
}

async function processEvent(res: VercelResponse, eventId: string, bodyStr: string) {
  let event: RzpEventEnvelope;
  try {
    event = JSON.parse(bodyStr) as RzpEventEnvelope;
  } catch {
    return res.status(400).json({ error: 'Body is not JSON' });
  }

  const admin = getSupabaseAdmin();

  // Record-then-dedupe pattern: try to insert; if it conflicts on
  // razorpay_event_id we've already processed it, just ack 200.
  const { error: insertErr } = await admin.from('subscription_events').insert({
    razorpay_event_id: eventId,
    event_type: event.event,
    raw_payload: event as unknown as Record<string, unknown>,
  });
  if (insertErr) {
    if (insertErr.code === '23505' /* unique_violation */) {
      return res.status(200).json({ ok: true, deduped: true });
    }
    console.error('[razorpay-webhook] event log insert failed:', insertErr);
    // Don't 5xx — Razorpay would retry-storm. The signature was valid;
    // operator should investigate via logs.
    return res.status(200).json({ ok: true, logged: false });
  }

  try {
    await applyEvent(admin, event);
    await admin
      .from('subscription_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('razorpay_event_id', eventId);
  } catch (err: any) {
    console.error(`[razorpay-webhook] applyEvent(${event.event}) failed:`, err);
    await admin
      .from('subscription_events')
      .update({
        processed_at: new Date().toISOString(),
        error: String(err?.message ?? err).slice(0, 4000),
      })
      .eq('razorpay_event_id', eventId);
    // Still 200 — see retry comment up top.
  }

  return res.status(200).json({ ok: true });
}

async function applyEvent(
  admin: ReturnType<typeof getSupabaseAdmin>,
  event: RzpEventEnvelope,
): Promise<void> {
  const sub = event.payload.subscription?.entity;
  if (!sub) {
    // payment.failed and friends don't include a subscription entity. Log
    // shape is captured in subscription_events.raw_payload; nothing to apply.
    return;
  }

  // Locate the local user. notes.user_id is set when we create the
  // subscription, but fall back to looking up by razorpay_subscription_id
  // for events received before that update lands.
  const userIdFromNotes = sub.notes?.user_id ?? null;
  let userId = userIdFromNotes;
  if (!userId) {
    const { data: row } = await admin
      .from('subscriptions')
      .select('user_id')
      .eq('razorpay_subscription_id', sub.id)
      .maybeSingle();
    userId = row?.user_id ?? null;
  }
  if (!userId) {
    console.warn(`[razorpay-webhook] no user for subscription ${sub.id} (event=${event.event})`);
    return;
  }

  const baseUpdate: Record<string, unknown> = {
    razorpay_subscription_id: sub.id,
    razorpay_customer_id: sub.customer_id,
    status: sub.status,
    current_period_start: tsToIso(sub.current_start),
    current_period_end: tsToIso(sub.current_end),
  };

  switch (event.event) {
    case 'subscription.activated':
    case 'subscription.charged':
    case 'subscription.resumed':
      // Map the Razorpay plan → our tier (pro OR max) rather than hardcoding
      // 'pro', so Max subscriptions activate at the right tier.
      baseUpdate.plan_tier = tierFromPlanId(sub.plan_id);
      // A fresh charge/activate implies the user is NOT cancelling — unless
      // a later subscription.cancelled overrides it.
      if (event.event !== 'subscription.charged') {
        baseUpdate.cancel_at_period_end = false;
      }
      break;

    case 'subscription.paused':
      // Pro access remains until period_end; status reflects pause.
      break;

    case 'subscription.cancelled':
      // Cancellation is scheduled at cycle end; stay 'pro' until then.
      baseUpdate.cancel_at_period_end = true;
      break;

    case 'subscription.completed':
    case 'subscription.expired':
      baseUpdate.plan_tier = 'free';
      baseUpdate.plan_cycle = null;
      baseUpdate.current_period_start = null;
      baseUpdate.current_period_end = null;
      baseUpdate.cancel_at_period_end = false;
      break;

    case 'subscription.halted':
      // Payment failed beyond retry threshold. Razorpay won't try again
      // until the user updates payment method. Keep 'pro' so we don't yank
      // access mid-billing-issue; status='halted' surfaces in the UI.
      break;

    default:
      // Unknown event with a subscription entity — still update status so
      // we keep the local mirror reasonably fresh.
      break;
  }

  const { error } = await admin
    .from('subscriptions')
    .update(baseUpdate)
    .eq('user_id', userId);
  if (error) throw new Error(`subscriptions update failed: ${error.message}`);
}
