// gemini-strategic — workspace-level strategic analysis across one or more
// completed meetings.
//
// NOTE: This is the STANDALONE / dashboard-paste version of index.ts. It
// inlines the _shared/cors.ts and _shared/portkey.ts contents at the top so
// the entire function fits in a single file that can be pasted directly
// into the Supabase Edge Functions dashboard editor without missing-module
// errors. The non-standalone index.ts (with `import ... from '../_shared/...'`)
// is the canonical source — keep both in sync if either is edited.
//
// Unlike gemini-analyze, the output here is NOT JSON — it's a free-form
// document with emoji headers (📊 Executive Summary, 🔍 Process Gaps, ...).
// services/strategyService.ts → parseStrategicResponse() parses those
// sections by regex, so:
//   - the headers and the keyed labels (Title:, Description:, Frequency:,
//     Impact:, Priority:, Occurrences:, Status:) MUST stay exactly the same;
//   - we MUST NOT set response_format: { type: 'json_object' } here,
//     otherwise providers will wrap or reject the text.
//
// Both prompt branches (isSingleMeeting and the multi-meeting one) are
// copied verbatim from api/gemini/strategic.ts.

// ─── Inlined from _shared/cors.ts ─────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─── Inlined from _shared/portkey.ts ──────────────────────────────────────
const PORTKEY_ENDPOINT = 'https://api.portkey.ai/v1/chat/completions';

type PortkeyMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type PortkeyOpts = {
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: 'json_object' };
};

async function callPortkey(
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

// ─── Handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let aggregatedData: unknown;
  let isSingleMeeting: unknown;
  try {
    const body = await req.json();
    aggregatedData = body?.aggregatedData;
    isSingleMeeting = body?.isSingleMeeting;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (typeof aggregatedData !== 'string' || aggregatedData.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'Missing aggregatedData' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // STRATEGIC PROMPT — copied verbatim from api/gemini/strategic.ts,
  // BOTH branches. Do not paraphrase. parseStrategicResponse() depends on
  // the exact emoji headers + field labels below.
  // ──────────────────────────────────────────────────────────────────────
  const strategicPrompt = isSingleMeeting
    ? `You are an expert business strategist analyzing a single meeting/session for strategic insights.

Your task is to identify strategic insights, process gaps, and actionable recommendations from this session.

Analyze the following session data and provide strategic insights in this EXACT format:

📊 Executive Summary
[Provide a 3-4 sentence summary of the session, key takeaways, and critical points]

🔍 Process Gaps
[For each process gap or improvement area identified:]

Title: [Gap name]
Description: [What's missing or could be improved]
Frequency: 1
Impact: [high/medium/low]

🎯 Strategic Actions
[For each strategic action recommended from this session:]

Title: [Action name]
Description: [What should be done]
Rationale: [Why this matters strategically]
Priority: [urgent/high/medium/low]
Estimated Impact: [Expected business impact]

⚠️ Issue Patterns
[For each issue or concern identified:]

Issue: [Issue description]
Occurrences: 1
Status: [recurring/escalating/resolved]
Context: [Additional context]

💡 Key Themes
[List 3-5 major themes from this session as bullet points]

ANALYSIS GUIDELINES:
1. Focus on STRATEGIC insights, not tactical details
2. Identify areas that need attention or follow-up
3. Look for gaps between discussion points and action items
4. Highlight risks and opportunities mentioned
5. Provide actionable recommendations

SESSION DATA TO ANALYZE:
${aggregatedData}`
    : `You are an expert business strategist analyzing workspace intelligence across multiple meetings.

Your task is to identify high-level strategic insights, process gaps, and actionable recommendations based on ALL the meeting data provided below.

Analyze the following workspace data and provide strategic insights in this EXACT format:

📊 Executive Summary
[Provide a 3-4 sentence executive summary of the overall state of the workspace, key achievements, and critical concerns]

🔍 Process Gaps
[For each significant process gap identified across meetings:]

Title: [Gap name]
Description: [What's missing or broken in the process]
Frequency: [How many meetings mentioned this issue]
Impact: [high/medium/low]

🎯 Strategic Actions
[For each high-level strategic action recommended:]

Title: [Action name]
Description: [What should be done]
Rationale: [Why this matters strategically]
Priority: [urgent/high/medium/low]
Estimated Impact: [Expected business impact]

⚠️ Issue Patterns
[For each recurring unresolved issue pattern:]

Issue: [Issue description]
Occurrences: [Number of times mentioned]
Status: [recurring/escalating/resolved]
Context: [Additional context]

💡 Key Themes
[List 5-7 major themes that emerged across all meetings as bullet points]

IMPORTANT ANALYSIS GUIDELINES:
1. Look for PATTERNS across multiple meetings, not single-meeting issues
2. Focus on STRATEGIC insights, not tactical details
3. Identify SYSTEMIC problems that need organizational attention
4. Prioritize items that appeared in 2+ meetings
5. Consider temporal patterns (are issues getting worse?)
6. Look for gaps between what's discussed and what's actually done
7. Identify blockers that appear repeatedly

WORKSPACE DATA TO ANALYZE:
${aggregatedData}`;

  try {
    const configId = Deno.env.get('PORTKEY_CONFIG_STRATEGIC') ?? '';

    // No response_format here — strategist output is emoji-headed prose,
    // not JSON. Forcing json_object would break the section parser.
    //
    // max_tokens kept at 65536 to match the original Gemini-direct behaviour.
    // Multi-meeting strategic rollups can be very long; clamping at 8k
    // would silently truncate the Issue Patterns / Key Themes sections.
    const responseText = await callPortkey(
      configId,
      [{ role: 'user', content: strategicPrompt }],
      {
        max_tokens: 65536,
        temperature: 0.1,
      },
    );

    return new Response(
      JSON.stringify({ responseText }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Strategic analysis failed';
    console.log('[API /gemini-strategic] error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
