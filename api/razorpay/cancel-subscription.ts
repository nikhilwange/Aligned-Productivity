import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../_lib/jwt';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin';
import { cancelSubscription } from '../_lib/razorpay';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verified against Supabase Auth — a forged/expired token gets a 401 here.
  const user = await requireUser(req.headers.authorization);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const userId = user.id;

  const admin = getSupabaseAdmin();

  const { data: sub, error: subErr } = await admin
    .from('subscriptions')
    .select('razorpay_subscription_id, status')
    .eq('user_id', userId)
    .maybeSingle();
  if (subErr) {
    console.error('[cancel-subscription] lookup failed:', subErr);
    return res.status(500).json({ error: 'Could not read subscription state' });
  }
  if (!sub?.razorpay_subscription_id) {
    return res.status(404).json({ error: 'No active subscription found' });
  }

  try {
    await cancelSubscription(sub.razorpay_subscription_id, /* cancelAtCycleEnd */ true);
  } catch (err: any) {
    console.error('[cancel-subscription] razorpay cancel failed:', err);
    return res.status(502).json({ error: `Razorpay cancel failed: ${err?.message ?? 'unknown'}` });
  }

  // Optimistic: mark cancel_at_period_end now so the UI reflects it. The
  // webhook's subscription.cancelled / subscription.completed event will
  // confirm/extend this. Tier stays 'pro' until period_end.
  const { error: upErr } = await admin
    .from('subscriptions')
    .update({ cancel_at_period_end: true })
    .eq('user_id', userId);
  if (upErr) {
    console.error('[cancel-subscription] DB flag set failed:', upErr);
  }

  return res.status(200).json({ ok: true });
}
