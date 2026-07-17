// Service-role Supabase client for Vercel functions. Bypasses RLS so the
// Razorpay endpoints can read/write the subscriptions table on behalf of
// the authenticated user (after our own JWT check) and the webhook can
// update tier without a user session at all.

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _admin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Server misconfiguration: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }
  _admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _admin;
}
