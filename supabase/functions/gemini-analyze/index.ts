// gemini-analyze — Pass 2 of the Aligned pipeline.
//
// Takes a verbatim meeting transcript and asks the LLM to produce a single
// JSON object containing meetingType, detectedLanguages, actionPoints, and a
// rich-markdown `notes` document. The frontend (services/geminiService.ts ->
// parseJsonResponse) is tolerant of fenced JSON and partial parses, so all
// we have to do here is keep the prompt *exactly* as it was on Vercel and
// return `{ responseText, isTruncated: false }`.
//
// Why this route now goes through Portkey:
// On Vercel/Gemini-direct, transient Gemini 500/503 errors fail the whole
// request. Portkey lets us fall back to OpenAI (and then Krutrim) without
// changing client code — the routing/order lives in PORTKEY_CONFIG_STRATEGIC.
// We use the STRATEGIC config (not QUICK) because the analysis prompt is
// long, the output is long, and the JSON shape is non-trivial — we want
// the higher-capability model lineup.

import { corsHeaders } from '../_shared/cors.ts';
import { callPortkey } from '../_shared/portkey.ts';

Deno.serve(async (req) => {
  // Preflight — browsers send OPTIONS before the actual POST because of
  // our Authorization / apikey / Content-Type headers.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Supabase validates the JWT at the gateway; we just check presence so a
  // missing header fails fast with a clean message instead of getting to
  // Portkey.
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let transcript: unknown;
  let recordingDate: unknown;
  try {
    const body = await req.json();
    transcript = body?.transcript;
    recordingDate = body?.recordingDate;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (typeof transcript !== 'string' || transcript.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'Missing or invalid transcript' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Same date formatting as the original Vercel handler so the "Date:" line
  // in the rendered notes doesn't change format between deployments.
  const dateStr = new Date(
    typeof recordingDate === 'number' ? recordingDate : Date.now(),
  ).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  // ──────────────────────────────────────────────────────────────────────
  // ANALYSIS PROMPT — copied verbatim from api/gemini/analyze.ts.
  // Do NOT paraphrase or "improve" this. The frontend's section parser
  // (components/ResultsView.tsx) keys off these exact emoji headers and the
  // JSON shape; downstream consumers (action-item promotion, grouping by
  // owner) depend on the exact "actionPoints" rules below.
  // ──────────────────────────────────────────────────────────────────────
  const analysisPrompt = `You are an expert meeting assistant. Analyze the transcript below and respond with a single valid JSON object — no markdown fences, no extra text outside the JSON.

The JSON must match this exact shape:
{
  "meetingType": "<inferred type: standup | planning | brainstorm | review | 1on1 | all-hands | other>",
  "detectedLanguages": ["<language1>", "<language2>"],
  "actionPoints": ["<plain text action item>", "..."],
  "notes": "<full rich-markdown meeting notes document — see format below>"
}

RULES FOR actionPoints (CRITICAL — be exhaustive and balanced):
- Capture EVERY action, commitment, deliverable, follow-up, decision-to-execute, or task assigned in the transcript. Do not silently drop any. Err on the side of including borderline items — it is better to list a soft commitment than to miss a real one.
- Do NOT merge two distinct actions into one item. If two people committed to two things, write two items.
- Do NOT skip actions just because they sound informal ("let's also check…", "we should…", "can you also…"). If something was committed to, it counts.
- Each item must be SELF-CONTAINED and CONTEXT-RICH. Target ~15-30 words. Include:
    • the owner (named person, team, or "unassigned")
    • the verb + the specific deliverable
    • the relevant context (what data / which slide / which customer / what number / which deadline / why)
- Too concise is WRONG: "Samir to track BOM" lacks context. Write "Samir to start tracking BOM readiness for the production schedule and report status weekly to the planning review."
- Too verbose is WRONG: don't pad with filler ("It was discussed that…", "going forward we should…"). Get to the action.
- Plain strings only — no "- [ ]" checkbox prefix.
- Empty array [] only if the transcript truly contains zero actions/commitments.

RULES FOR notes (the full markdown document to show users):
Write a comprehensive meeting notes document in this exact format. The notes value must be a valid JSON string (escape newlines as \\n, quotes as \\"):

📋 Meeting Overview
**Date:** ${dateStr}
**Duration:** [Estimate from transcript]
**Attendees:** [All speakers]
**Meeting Type:** [Same as meetingType field above]

🎯 Key Takeaways
- [3-5 bullet points of most important outcomes]

📝 Summary
[2-3 paragraph narrative summary]

💬 Discussion Points
[Organized by theme. For each theme:]
### [Theme Title]
**Context:** [description]
**Key Points:**
- point 1
- point 2
**Participants' Views:**
- **[Name]:** their view

✅ Action Items
Group action items by the person responsible. For each owner:
- Write the owner's name as a bold line on its own: **Name**
- Below that name, list each of their action items as a checkbox bullet
- Do NOT repeat the owner's name inside the action text — write "Circulate the action tracker today", NOT "Shailesh to circulate the action tracker today"
- Keep the same balanced, context-rich phrasing as the actionPoints array, just with the assignee prefix stripped.

For any action item that does not have a clear assignee, list it as a plain checkbox bullet at the very top of this section, with no header above it. Do NOT invent an "Unassigned", "Team", "All", or "Everyone" group — items without an owner just appear as bare bullets.

The set of actions here MUST be exactly the same set as in the actionPoints array — same count, same coverage — just regrouped and de-prefixed. Do not drop any.

Example format:
✅ Action Items
- [ ] Schedule a follow-up review next week to close out remaining safety RCAs.

**Shailesh**
- [ ] Circulate the action tracker for the pending safety points to the wider team today and flag any still-open items.
- [ ] Plan a monthly safety meeting cadence, with an agenda template covering RCA status and near-miss reporting.

**Samir**
- [ ] Create a structured program to check material availability for production schedules beyond 8 weeks, covering critical RM and long-lead items.
- [ ] Discuss material assessment status for the 6-9 month window with Subhasis and Mali, and align on a single source of truth.
- [ ] Start tracking BOM readiness for upcoming launches and report status weekly to the planning review.

🔲 Decisions Made
| Decision Title | What was decided | Why | Impact |
| --- | --- | --- | --- |

❓ Open Questions
[Unresolved questions]

📊 Data & Metrics Mentioned
| Metric | Value | Context |
| --- | --- | --- |

📅 Important Dates & Deadlines
[All dates mentioned]

🔗 References & Resources
[Documents, links, tools mentioned]

💡 Ideas & Suggestions
[Brainstormed ideas]

🧱 Blockers & Risks
[Obstacles and risks]

📍 Next Steps
[Priority-ordered next steps]

📌 Additional Notes
[Any other relevant info]

IMPORTANT:
- Write ALL notes entirely in English — translate any Hindi, Marathi, or other non-English content
- Professional tone throughout
- Do NOT include the full transcript in the notes field

TRANSCRIPT:
${transcript}`;

  try {
    const configId = Deno.env.get('PORTKEY_CONFIG_STRATEGIC') ?? '';

    // max_tokens kept at 65536 to match the original Gemini-direct behaviour.
    // Meetings here routinely run 1–2 hours, and the rich-markdown `notes`
    // document plus a complete `actionPoints` array can easily exceed 8k
    // tokens. Gemini 2.5 Flash accepts 65536 natively; the Portkey config
    // (PORTKEY_CONFIG_STRATEGIC) is responsible for clamping or routing
    // around any fallback provider that can't honour this ceiling.
    const responseText = await callPortkey(
      configId,
      [{ role: 'user', content: analysisPrompt }],
      {
        max_tokens: 65536,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      },
    );

    // We no longer have access to provider-specific `finishReason`, so we
    // can't detect MAX_TOKENS truncation reliably across providers. The
    // frontend already treats `isTruncated` as optional, so always returning
    // false is safe — the user just won't see the "truncated" warning chip.
    return new Response(
      JSON.stringify({ responseText, isTruncated: false }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis failed';
    console.log('[API /gemini-analyze] error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
