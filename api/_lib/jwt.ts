// Vercel-side auth helper for user-facing endpoints.
//
// SECURITY: tokens must be VERIFIED, never merely decoded. These functions are
// public endpoints — a decoded-only `sub` claim can be forged by anyone, which
// would let an attacker act as any user (e.g. cancel their subscription).
// Verification does NOT require the project's JWT secret: Supabase validates
// the token server-side via `auth.getUser(token)` using just the anon key —
// the same pattern api/sarvam/transcribe.ts uses.

import { createClient } from '@supabase/supabase-js';

export interface VerifiedUser {
  id: string;
  email: string | null;
}

/**
 * Verify the Bearer token against Supabase Auth and return the user, or null
 * if the header is missing/invalid/expired. Callers should respond 401 on null.
 */
export async function requireUser(authHeader: string | undefined | null): Promise<VerifiedUser | null> {
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    // Misconfiguration — treat as auth failure rather than crashing the route.
    console.error('[auth] SUPABASE_URL / SUPABASE_ANON_KEY not set');
    return null;
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    return { id: user.id, email: user.email ?? null };
  } catch (err) {
    console.error('[auth] token verification failed:', err);
    return null;
  }
}
