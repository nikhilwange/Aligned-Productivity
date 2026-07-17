import type { VercelRequest, VercelResponse } from '@vercel/node';
import { decodeAuthHeader } from '../_lib/jwt';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin';
import { createCustomer, createSubscription } from '../_lib/razorpay';

type Cycle = 'monthly' | 'annual';

function planIdFor(cycle: Cycle): string | undefined {
  return cycle === 'monthly'
    ? process.env.RAZORPAY_PLAN_ID_MONTHLY
    : process.env.RAZORPAY_PLAN_ID_ANNUAL;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { sub: userId, email } = decodeAuthHeader(req.headers.authorization);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const cycle = req.body?.cycle as Cycle | undefined;
  if (cycle !== 'monthly' && cycle !== 'annual') {
    return res.status(400).json({ error: 'cycle must be "monthly" or "annual"' });
  }

  const planId = planIdFor(cycle);
  const keyId = process.env.RAZORPAY_KEY_ID;
  if (!planId || !keyId) {
    return res.status(500).json({ error: 'Server misconfiguration: Razorpay plan IDs / key not set' });
  }

  const admin = getSupabaseAdmin();

  // Read the current subscription row (backfilled to 'free' for everyone on
  // schema rollout) so we can reuse an existing Razorpay customer instead of
  // making a new one for repeat subscribers.
  const { data: existingSub, error: subErr } = await admin
    .from('subscriptions')
    .select('razorpay_customer_id, razorpay_subscription_id, status')
    .eq('user_id', userId)
    .maybeSingle();
  if (subErr) {
    console.error('[create-subscription] sub lookup failed:', subErr);
    return res.status(500).json({ error: 'Could not read subscription state' });
  }

  // Refuse if the user already has a live subscription. Upgrades / downgrades
  // are out of scope for v1 — user must cancel and re-subscribe.
  if (
    existingSub?.razorpay_subscription_id &&
    existingSub.status &&
    ['created', 'authenticated', 'active', 'pending'].includes(existingSub.status)
  ) {
    return res.status(409).json({
      error: 'A subscription is already in progress for this account. Cancel it before starting a new one.',
      existing_subscription_id: existingSub.razorpay_subscription_id,
    });
  }

  // Get or create the Razorpay customer.
  let customerId = existingSub?.razorpay_customer_id ?? null;
  if (!customerId) {
    if (!email) {
      return res.status(400).json({ error: 'No email on JWT — cannot create Razorpay customer' });
    }
    try {
      const customer = await createCustomer({ email });
      customerId = customer.id;
    } catch (err: any) {
      console.error('[create-subscription] customer create failed:', err);
      return res.status(502).json({ error: `Razorpay customer create failed: ${err?.message ?? 'unknown'}` });
    }
  }

  // Create the subscription.
  let subscription;
  try {
    subscription = await createSubscription({
      plan_id: planId,
      customer_id: customerId,
      notes: { user_id: userId, app: 'aligned' },
    });
  } catch (err: any) {
    console.error('[create-subscription] subscription create failed:', err);
    return res.status(502).json({ error: `Razorpay subscription create failed: ${err?.message ?? 'unknown'}` });
  }

  // Persist what we know now. tier stays 'free' until subscription.activated
  // arrives via webhook (i.e. payment actually succeeded). We only mark the
  // intent here.
  const { error: upErr } = await admin
    .from('subscriptions')
    .update({
      plan_cycle: cycle,
      razorpay_customer_id: customerId,
      razorpay_subscription_id: subscription.id,
      status: subscription.status,
    })
    .eq('user_id', userId);
  if (upErr) {
    console.error('[create-subscription] DB update failed:', upErr);
    // Don't surface this to the user as fatal — Razorpay has the subscription
    // and the webhook will reconcile when payment lands.
  }

  return res.status(200).json({
    subscription_id: subscription.id,
    key_id: keyId,
    customer_id: customerId,
    customer_email: email,
    short_url: subscription.short_url ?? null,
  });
}
