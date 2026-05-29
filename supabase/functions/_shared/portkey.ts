// Portkey client — thin wrapper around Portkey's OpenAI-compatible
// /v1/chat/completions endpoint.
//
// Why Portkey (the whole point of this migration):
// Portkey sits in front of Gemini, OpenAI, and Krutrim and routes a single
// request through configurable fallbacks. The provider order and retry
// policy are defined in the Portkey dashboard "configs" (PORTKEY_CONFIG_*
// secrets), so this client just has to:
//   1) hit /v1/chat/completions with the right API key and config ID,
//   2) speak OpenAI's chat-completions shape (which Portkey adapts to each
//      underlying provider — including Gemini), and
//   3) surface clear errors when something blows up so callers can return
//      a sensible HTTP response to the frontend.
//
// Notes:
// - Pure fetch, no SDK — keeps the function bundle tiny and Deno-native.
// - The integration slugs configured in Portkey are:
//     aligned-gemini, OpenAI-for-aligned-app, aligned-krutrim
//   We never reference those slugs directly here; the active config decides
//   which one runs first and what falls back when.

const PORTKEY_ENDPOINT = 'https://api.portkey.ai/v1/chat/completions';

export type PortkeyMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type PortkeyOpts = {
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: 'json_object' };
};

/**
 * Extract the Supabase user id (`sub` claim) from an Authorization header,
 * without verifying the signature. Supabase's gateway already validated the
 * JWT before this function ran — we only need the payload to attach a
 * user_id to outbound Portkey calls for per-user usage tracking.
 *
 * Returns 'unknown' on any failure (missing header, malformed JWT,
 * missing claim) so the caller can always supply *some* user_id to
 * Portkey rather than dropping the field.
 */
export function extractUserIdFromAuthHeader(authHeader: string | null): string {
  try {
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!token) return 'unknown';
    const parts = token.split('.');
    if (parts.length < 2) return 'unknown';
    // JWT payload is base64url-encoded JSON. Convert URL alphabet → standard
    // base64 and pad to a multiple of 4 before atob.
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const json = JSON.parse(new TextDecoder().decode(bytes)) as { sub?: string };
    return typeof json.sub === 'string' && json.sub.length > 0 ? json.sub : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Call Portkey and return the assistant message text.
 *
 * @param configId  Portkey config ID (e.g. value of PORTKEY_CONFIG_STRATEGIC).
 *                  This is what selects the provider routing/fallback policy.
 * @param messages  OpenAI chat-completions messages array.
 * @param opts      max_tokens / temperature / response_format passthrough.
 * @param metadata  Optional flat record of tags Portkey will surface in its
 *                  Logs / Analytics dashboards. Used here for per-user
 *                  consumption tracking — callers pass { user_id, app }.
 * @returns         The plain string content of the first choice's message.
 */
export async function callPortkey(
  configId: string,
  messages: PortkeyMessage[],
  opts: PortkeyOpts = {},
  metadata?: Record<string, string>,
): Promise<string> {
  const apiKey = Deno.env.get('PORTKEY_API_KEY');
  if (!apiKey) {
    throw new Error('Server misconfiguration: PORTKEY_API_KEY not set');
  }
  if (!configId) {
    throw new Error('Server misconfiguration: missing Portkey config ID for this call');
  }

  // Build the body — only include keys the caller actually set so we don't
  // send `undefined` values that some providers reject.
  const body: Record<string, unknown> = { messages };
  if (typeof opts.max_tokens === 'number') body.max_tokens = opts.max_tokens;
  if (typeof opts.temperature === 'number') body.temperature = opts.temperature;
  if (opts.response_format) body.response_format = opts.response_format;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-portkey-api-key': apiKey,
    'x-portkey-config': configId,
  };
  if (metadata && Object.keys(metadata).length > 0) {
    // Portkey reads this header as a JSON-encoded flat map of tags. It shows
    // up on every log row in the Portkey dashboard, enabling per-user usage
    // and cost breakdowns without us building our own metering.
    headers['x-portkey-metadata'] = JSON.stringify(metadata);
  }

  const res = await fetch(PORTKEY_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // Try to surface Portkey's own error message — it usually contains the
    // upstream provider's failure reason, which is invaluable for debugging
    // routing/fallback issues in the dashboard.
    let detail = res.statusText;
    try {
      const errBody = await res.text();
      if (errBody) detail = errBody;
    } catch {
      // ignore — fall through with statusText
    }
    throw new Error(`Portkey request failed (${res.status}): ${detail}`);
  }

  const json = await res.json().catch(() => null) as
    | { choices?: Array<{ message?: { content?: string } }> }
    | null;

  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Portkey returned an empty assistant message');
  }

  return content;
}
