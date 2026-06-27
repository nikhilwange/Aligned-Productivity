/**
 * api/oauth-protected-resource.ts
 * -------------------------------
 * Publishes the OAuth "protected resource metadata" that tells Claude WHERE to
 * authenticate — i.e. that Supabase is the authorization server for this MCP
 * resource. A vercel.json rewrite maps the spec path
 * (/.well-known/oauth-protected-resource) onto this function.
 */

import {
  protectedResourceHandler,
  metadataCorsOptionsRequestHandler,
} from 'mcp-handler';

const handler = protectedResourceHandler({
  authServerUrls: [`${process.env.SUPABASE_URL}/auth/v1`],
});

export { handler as GET };
export const OPTIONS = metadataCorsOptionsRequestHandler();
