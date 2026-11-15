// In-app Help & Support form → saves a support_requests row, then emails
// support@getitaligned.com with Reply-To set to the user.
//
// Order matters: the row is the record of truth. If saving fails the user is
// told (and shown the support email as a fallback); if only the email fails
// the user still sees success, the row keeps email_sent = false, and the
// error is logged.
//
// Email goes through the Titan mailbox's SMTP (SMTP_* env on Vercel — the
// same details Supabase Auth uses for its own emails). Server-only: never
// put these behind a VITE_ prefix.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { requireUser } from '../_lib/jwt.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { hasUnlimitedAccess, resolveTierFromSubscription } from '../_lib/tiers.js';

const SUPPORT_EMAIL = 'support@getitaligned.com';
const MAX_MESSAGE_CHARS = 2000;
const MAX_REQUESTS_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

// Mirrors SUPPORT_TOPICS in config/support.ts (client config can't be imported here).
const TOPIC_LABELS: Record<string, string> = {
  recording: 'Recording',
  transcription_notes: 'Transcription or notes',
  payment_plan: 'Payment or plan',
  account: 'Account',
  other: 'Something else',
};
const PLATFORMS = new Set(['web', 'desktop', 'ios', 'android']);

const clip = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

async function sendSupportEmail(row: {
  id: string; email: string; plan_tier: string; topic: string; message: string;
  platform: string | null; app_version: string | null; created_at: string;
}) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) throw new Error('SMTP_HOST / SMTP_USER / SMTP_PASS not set');
  const port = Number(process.env.SMTP_PORT || 465);

  const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  const topic = TOPIC_LABELS[row.topic] ?? row.topic;
  await transport.sendMail({
    from: `"Aligned Support Form" <${user}>`,
    to: SUPPORT_EMAIL,
    replyTo: row.email,
    subject: `[Support] ${topic} — ${row.email}`,
    text: [
      `From:      ${row.email}`,
      `Plan:      ${row.plan_tier}`,
      `Topic:     ${topic}`,
      `Platform:  ${row.platform ?? 'unknown'}${row.app_version ? ` (v${row.app_version})` : ''}`,
      `Sent:      ${new Date(row.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
      `Request:   ${row.id}`,
      '',
      row.message,
      '',
      '— Reply to this email to answer the user directly.',
    ].join('\n'),
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireUser(req.headers.authorization);
  if (!user) {
    return res.status(401).json({ error: 'Please sign in again and retry.' });
  }
  if (!user.email) {
    return res.status(400).json({ error: 'Your account has no email address to reply to.' });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const topic = typeof body.topic === 'string' && TOPIC_LABELS[body.topic] ? body.topic : null;
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!topic) return res.status(400).json({ error: 'Please choose a topic.' });
  if (!message) return res.status(400).json({ error: 'Please write a message.' });
  if (message.length > MAX_MESSAGE_CHARS) {
    return res.status(400).json({ error: `Please keep your message under ${MAX_MESSAGE_CHARS.toLocaleString('en-IN')} characters.` });
  }
  const platformRaw = clip(body.platform, 20);
  const platform = platformRaw && PLATFORMS.has(platformRaw) ? platformRaw : null;
  const appVersion = clip(body.appVersion, 40);

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (err: any) {
    console.error('[support] admin init failed:', err?.message);
    return res.status(500).json({ error: 'Could not save your request.' });
  }

  // Server-side limit: at most MAX_REQUESTS_PER_DAY in any 24 hours.
  const { count, error: countErr } = await admin
    .from('support_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', new Date(Date.now() - DAY_MS).toISOString());
  if (countErr) {
    console.error('[support] count failed:', countErr);
    return res.status(500).json({ error: 'Could not save your request.' });
  }
  if ((count ?? 0) >= MAX_REQUESTS_PER_DAY) {
    return res.status(429).json({
      error: `You've sent ${MAX_REQUESTS_PER_DAY} requests in the last 24 hours. We'll reply to those soon — or email ${SUPPORT_EMAIL} if it's urgent.`,
    });
  }

  const { data: sub } = await admin
    .from('subscriptions')
    .select('plan_tier, status, current_period_end')
    .eq('user_id', user.id)
    .maybeSingle();
  const planTier = hasUnlimitedAccess(user.email) ? 'admin' : resolveTierFromSubscription(sub ?? null);

  const { data: row, error: insertErr } = await admin
    .from('support_requests')
    .insert({
      user_id: user.id,
      email: user.email,
      plan_tier: planTier,
      topic,
      message,
      platform,
      app_version: appVersion,
    })
    .select('id, email, plan_tier, topic, message, platform, app_version, created_at')
    .single();
  if (insertErr || !row) {
    console.error('[support] insert failed:', insertErr);
    return res.status(500).json({ error: 'Could not save your request.' });
  }

  try {
    await sendSupportEmail(row);
    await admin.from('support_requests').update({ email_sent: true }).eq('id', row.id);
  } catch (err: any) {
    // Saved but not emailed — still a success for the user; the row shows email_sent = false.
    console.error(`[support] email failed for request ${row.id}:`, err?.message ?? err);
  }

  return res.status(200).json({ ok: true, email: user.email });
}
