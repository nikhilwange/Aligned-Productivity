// Vercel-side JWT helpers.
//
// We don't verify the signature here — the Vercel functions are reached from
// our own frontend which is already authenticated against Supabase. If we
// wanted full verification we'd need the project's JWT secret; for the
// Razorpay flows that secret isn't worth shipping to Vercel just to re-check
// what Supabase already validated. Decode-only is enough to fish out the
// user_id (`sub`) and email claim so we can look the user up server-side.

export interface DecodedJwt {
  sub: string | null;
  email: string | null;
  role: string | null;
  raw: Record<string, unknown> | null;
}

const EMPTY: DecodedJwt = { sub: null, email: null, role: null, raw: null };

export function decodeAuthHeader(authHeader: string | undefined | null): DecodedJwt {
  try {
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!token) return EMPTY;
    const parts = token.split('.');
    if (parts.length < 2) return EMPTY;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8')) as Record<string, unknown>;
    return {
      sub: typeof json.sub === 'string' ? json.sub : null,
      email: typeof json.email === 'string' ? json.email : null,
      role: typeof json.role === 'string' ? json.role : null,
      raw: json,
    };
  } catch {
    return EMPTY;
  }
}
