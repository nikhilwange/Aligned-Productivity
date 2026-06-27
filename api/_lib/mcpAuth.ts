/**
 * api/_lib/mcpAuth.ts
 * -------------------
 * Two helpers for the MCP server:
 *   - verifyToken: validates the Supabase-issued OAuth access token (JWT) that
 *     Claude sends as a Bearer token. Used by withMcpAuth in api/[transport].ts.
 *   - userClient: a Supabase client scoped to the calling user, so your existing
 *     Row Level Security decides which rows each tool can read/write.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

const ISSUER = `${SUPABASE_URL}/auth/v1`;
// Requires ASYMMETRIC JWT signing keys (RS256/ES256) on your project — the
// legacy HS256 shared secret has no usable JWKS here.
const JWKS = createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
);

/**
 * Validate the bearer token. Returns AuthInfo on success, undefined on failure
 * (mcp-handler then emits a 401 with the WWW-Authenticate header for you).
 */
export async function verifyToken(
  _req: Request,
  bearer?: string
): Promise<AuthInfo | undefined> {
  if (!bearer) return undefined;
  try {
    const { payload } = await jwtVerify(bearer, JWKS, {
      issuer: ISSUER,
      // audience: 'authenticated', // turn on once you've confirmed the `aud`
      // claim on a real OAuth token (it may differ if you use an Access Token Hook)
    });
    const scopes =
      typeof payload.scope === 'string'
        ? payload.scope.split(' ').filter(Boolean)
        : [];
    return {
      token: bearer,
      clientId:
        (payload.client_id as string) ?? (payload.sub as string) ?? 'unknown',
      scopes,
      expiresAt: payload.exp,
      extra: { userId: payload.sub as string },
    };
  } catch {
    return undefined;
  }
}

/**
 * Supabase client that runs queries AS the authenticated user. Passing their
 * own JWT means PostgREST enforces your RLS policies automatically.
 */
export function userClient(userToken: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
