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
import { callPortkey, extractUserIdFromAuthHeader } from '../_shared/portkey.ts';

// Keepalive cadence for the streaming path. Comfortably under the gateway's
// 150s idle timeout — small enough that a stalled connection is still spotted
// quickly, large enough that a ~140s analysis emits only ~14 lines.
const KEEPALIVE_MS = 10_000;

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

  // Decode-only (no signature verification — Supabase already did that).
  // We pass the resulting user_id to Portkey as metadata so per-user AI
  // consumption shows up in the Portkey logs/analytics dashboard.
  const userId = extractUserIdFromAuthHeader(authHeader);

  let transcript: unknown;
  let recordingDate: unknown;
  let body_pass: unknown;
  let body_actionPoints: unknown;
  try {
    const body = await req.json();
    transcript = body?.transcript;
    recordingDate = body?.recordingDate;
    body_pass = body?.pass;
    body_actionPoints = body?.actionPoints;
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
  // PASS SELECTION
  //
  // The analysis can run as ONE call producing everything, or as TWO calls:
  //   pass 'actions' → meetingType, detectedLanguages, actionPoints
  //   pass 'notes'   → notes, built from the actionPoints pass 'actions' found
  //
  // Why split: each edge function invocation gets its own wall-clock budget,
  // and this project is being terminated at 150s (reason: WallClockTime, even
  // though the org is on Pro, where 400s is documented). A single combined
  // call measured 132.8-142.6s for 2-3.5h of transcript — close enough to the
  // limit that it was intermittently killed and the result lost. Two calls of
  // ~50-90s each are comfortably clear of it. Total wall time is roughly
  // unchanged, because latency tracks how much the model WRITES and the two
  // passes write the same content between them.
  //
  // The passes run SEQUENTIALLY, with 'notes' receiving the action points from
  // 'actions'. This is deliberate: generating them independently would let the
  // ✅ Action Items section of the notes drift from the actionPoints array,
  // and downstream (action-item promotion, grouping by owner) relies on those
  // being the same set.
  //
  // No `pass` field → the original combined prompt, unchanged, so an older
  // deployed client keeps working exactly as before.
  // ──────────────────────────────────────────────────────────────────────
  const pass = typeof (body_pass) === 'string' ? body_pass : null;
  const providedActions = Array.isArray(body_actionPoints)
    ? body_actionPoints.filter((a): a is string => typeof a === 'string')
    : [];

  // ──────────────────────────────────────────────────────────────────────
  // ANALYSIS PROMPT — copied verbatim from api/gemini/analyze.ts.
  // Do NOT paraphrase or "improve" this. The frontend's section parser
  // (components/ResultsView.tsx) keys off these exact emoji headers and the
  // JSON shape; downstream consumers (action-item promotion, grouping by
  // owner) depend on the exact "actionPoints" rules below.
  //
  // The rule blocks are shared constants so the combined prompt and the two
  // split passes cannot drift apart in wording.
  // ──────────────────────────────────────────────────────────────────────
  const ACTION_POINT_RULES = `RULES FOR actionPoints (CRITICAL — be exhaustive and balanced):
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
- Empty array [] only if the transcript truly contains zero actions/commitments.`;

  // The session's display name. Only the passes that see the FULL transcript
  // ask for this — never the chunked 'actions' pass, whose chunks each see a
  // fragment and would name the meeting after its opening minutes.
  const TITLE_RULES = `RULES FOR title (the short name this session is filed under):
- 3-8 words naming the SPECIFIC subject of this meeting, the way a busy manager would file it.
- House style is "<specific subject> <activity>", optionally "with <key person>". Real examples:
    • "July PD Miss Review with Samir"
    • "PDSL Improvement Action Plan Review"
    • "Capacity Growth Day 2027-29 Ambernath Deck Review"
    • "Supplier Performance & Capacity Review with Procurement"
    • "Mahesh's Automation Project Review"
- Lead with the concrete subject — the project, plant, customer, metric, product, or decision actually discussed. Keep distinctive proper nouns and figures when they are what the meeting was about ("Trinergy PD Correction", "6100+ Target Plan", "NPDI Delays from Jhajjar").
- Add "with <Name>" only for a 1:1, or when one other person clearly drove the discussion. Never list more than one name.
- Do NOT include the date or time — the app appends those itself.
- Do NOT return a bare category ("Meeting", "Discussion", "Planning", "Review", "Other") — those carry no information. If the transcript has no identifiable subject, describe what actually happened instead ("Informal Team Catch-up", "Mic Test").
- Title Case. No quotes, no trailing punctuation, no emoji, no markdown.
- Write it in English even when the meeting was held in Hindi or Marathi.`;

  // `actionsSource` names where the ✅ Action Items section must draw from:
  // the same response's actionPoints array (combined pass) or the list handed
  // in by the preceding 'actions' call (split pass).
  const notesRules = (actionsSource: string) => `RULES FOR notes (the full markdown document to show users):
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

The set of actions here MUST be exactly the same set as ${actionsSource} — same count, same coverage — just regrouped and de-prefixed. Do not drop any.

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
[Any other relevant info]`;

  const IMPORTANT_TAIL = `IMPORTANT:
- Write ALL notes entirely in English — translate any Hindi, Marathi, or other non-English content
- Professional tone throughout
- Do NOT include the full transcript in the notes field`;

  const PREAMBLE = 'You are an expert meeting assistant. Analyze the transcript below and respond with a single valid JSON object — no markdown fences, no extra text outside the JSON.';

  // ─── Prompt assembly, one variant per pass ────────────────────────────
  let analysisPrompt: string;

  if (pass === 'actions') {
    // Pass 1 of 2. Output volume is what costs time here, and unbounded
    // "be exhaustive" extraction was producing roughly one action point per 35
    // seconds of meeting — 213 for a 3.5h transcript. That made this pass slow
    // (97.9s on the worst chunk) AND the downstream notes pass slow (123.5s,
    // since it has to render every one of them), for a list longer than anyone
    // reads. Capping it is the single lever that speeds up both halves.
    //
    // ~1 action per 400 words (≈1 per 3 minutes of speech), clamped so a short
    // meeting still gets a useful list and a long one stays bounded. The cap is
    // stated AFTER the rules above so it overrides their "err on the side of
    // including borderline items" pressure.
    const wordCount = transcript.split(/\s+/).length;
    const maxActions = Math.max(15, Math.min(35, Math.round(wordCount / 400)));

    analysisPrompt = `${PREAMBLE}

The JSON must match this exact shape:
{
  "meetingType": "<inferred type: standup | planning | brainstorm | review | 1on1 | all-hands | other>",
  "detectedLanguages": ["<language1>", "<language2>"],
  "actionPoints": ["<plain text action item>", "..."]
}

Do NOT include a "notes" field — it is produced by a separate call.

${ACTION_POINT_RULES}

BUDGET (overrides the "be exhaustive" guidance above where they conflict):
- Return AT MOST ${maxActions} action points.
- If there are more candidates than that, keep the ${maxActions} most concrete and consequential — prefer items with a named owner, a specific deliverable, or a date attached.
- Drop vague intentions, restatements of the same commitment, and anything that is really just discussion rather than a commitment.
- Fewer, sharper items are BETTER than a long list. Do not pad to reach the limit.

IMPORTANT:
- Write ALL action points entirely in English — translate any Hindi, Marathi, or other non-English content
- Professional tone throughout

TRANSCRIPT:
${transcript}`;
  } else if (pass === 'notes') {
    // Pass 2 of 2: the notes document, built around the action points pass 1
    // already extracted. Handing them in (rather than re-deriving them) is
    // what keeps the ✅ Action Items section and the actionPoints array in
    // agreement — the guarantee the single combined call used to provide.
    const actionsList = providedActions.length > 0
      ? providedActions.map((a) => `- ${a}`).join('\n')
      : '(none were identified)';

    analysisPrompt = `${PREAMBLE}

The JSON must match this exact shape:
{
  "title": "<short specific name for this session — see rules below>",
  "notes": "<full rich-markdown meeting notes document — see format below>"
}

ACTION POINTS (already extracted from this transcript — treat as authoritative):
${actionsList}

${TITLE_RULES}

${notesRules('the ACTION POINTS list given above')}

${IMPORTANT_TAIL}

TRANSCRIPT:
${transcript}`;
  } else {
    // Combined pass — the original single-call prompt, byte-for-byte.
    analysisPrompt = `${PREAMBLE}

The JSON must match this exact shape:
{
  "title": "<short specific name for this session — see rules below>",
  "meetingType": "<inferred type: standup | planning | brainstorm | review | 1on1 | all-hands | other>",
  "detectedLanguages": ["<language1>", "<language2>"],
  "actionPoints": ["<plain text action item>", "..."],
  "notes": "<full rich-markdown meeting notes document — see format below>"
}

${ACTION_POINT_RULES}

${TITLE_RULES}

${notesRules('the actionPoints array')}

${IMPORTANT_TAIL}

TRANSCRIPT:
${transcript}`;
  }

  const configId = Deno.env.get('PORTKEY_CONFIG_STRATEGIC') ?? '';

  // max_tokens kept at 65536 to match the original Gemini-direct behaviour.
  // Meetings here routinely run 1–2 hours, and the rich-markdown `notes`
  // document plus a complete `actionPoints` array can easily exceed 8k
  // tokens. Gemini 2.5 Flash accepts 65536 natively; the Portkey config
  // (PORTKEY_CONFIG_STRATEGIC) is responsible for clamping or routing
  // around any fallback provider that can't honour this ceiling.
  const runAnalysis = () => callPortkey(
    configId,
    [{ role: 'user', content: analysisPrompt }],
    {
      max_tokens: 65536,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    },
    { user_id: userId, app: 'aligned' },
  );

  // ──────────────────────────────────────────────────────────────────────
  // STREAMING (NDJSON) PATH — opt-in via `Accept: application/x-ndjson`.
  //
  // Why this exists: Supabase's gateway enforces a 150s *request idle
  // timeout* — a request that sends no bytes for 150s gets a 504, and that
  // limit applies on every plan (the larger 400s figure is the worker's
  // wall clock, which only helps once bytes are flowing). This analysis
  // call measured 132.8s for a 2-hour transcript and 142.1s for a 3.5-hour
  // one, so the old buffered response was clearing the timeout by ~8-17s.
  //
  // Emitting a keepalive line every 10s while awaiting Portkey resets that
  // idle clock, so the binding limit becomes the 400s wall clock instead.
  // The Portkey call is deliberately UNCHANGED — we are not streaming model
  // tokens, only proving liveness — so the JSON contract, the fallback
  // routing, and the response shape all stay exactly as they were.
  //
  // Latency does not improve; the cliff does. Analysis still takes ~140s.
  //
  // Opt-in keeps rollout safe in both directions: an older deployed client
  // sends no Accept header and gets the original buffered response, and a
  // newer client falls back to plain JSON if it reaches an older function.
  //
  // NOTE: once the stream opens, headers are already sent, so a failure
  // cannot be an HTTP 500 any more. It is delivered as a terminal
  // `{"type":"error"}` line and the client re-raises it with status 500 so
  // the existing retry policy behaves identically.
  // ──────────────────────────────────────────────────────────────────────
  const wantsStream = (req.headers.get('accept') ?? '').includes('application/x-ndjson');

  if (wantsStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const send = (obj: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
          } catch {
            // The client hung up. Stop writing — the keepalive interval would
            // otherwise throw on every tick with nothing to catch it.
            closed = true;
          }
        };

        // First byte goes out before Portkey is even called, so the idle
        // clock is reset from the very start rather than after the model.
        send({ type: 'start' });
        const keepalive = setInterval(() => send({ type: 'ping' }), KEEPALIVE_MS);

        try {
          const responseText = await runAnalysis();
          send({ type: 'result', responseText, isTruncated: false });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Analysis failed';
          console.log('[API /gemini-analyze] error (streamed):', message);
          send({ type: 'error', error: message });
        } finally {
          clearInterval(keepalive);
          closed = true;
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/x-ndjson',
        // Discourage any intermediary from buffering the body, which would
        // defeat the keepalive entirely.
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  // ─── Original buffered path (unchanged) ───────────────────────────────
  try {
    const responseText = await runAnalysis();

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
