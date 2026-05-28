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
 * Call Portkey and return the assistant message text.
 *
 * @param configId  Portkey config ID (e.g. value of PORTKEY_CONFIG_STRATEGIC).
 *                  This is what selects the provider routing/fallback policy.
 * @param messages  OpenAI chat-completions messages array.
 * @param opts      max_tokens / temperature / response_format passthrough.
 * @returns         The plain string content of the first choice's message.
 */
export async function callPortkey(
  configId: string,
  messages: PortkeyMessage[],
  opts: PortkeyOpts = {},
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

  const res = await fetch(PORTKEY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-portkey-api-key': apiKey,
      'x-portkey-config': configId,
    },
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
