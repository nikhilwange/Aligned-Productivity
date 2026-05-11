import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server misconfiguration: GEMINI_API_KEY not set' });
  }

  const { transcript, recordingDate } = req.body;
  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid transcript' });
  }

  const ai = new GoogleGenAI({ apiKey });

  const dateStr = new Date(recordingDate ?? Date.now()).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

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
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [{ text: analysisPrompt }] },
      config: {
        maxOutputTokens: 65536,
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });

    const responseText = response.text;
    if (!responseText) {
      return res.status(500).json({ error: 'Empty analysis response from Gemini' });
    }

    const isTruncated = response.candidates?.[0]?.finishReason === 'MAX_TOKENS';

    return res.status(200).json({ responseText, isTruncated });
  } catch (error: any) {
    console.error('[API] Gemini analyze error:', error);
    return res.status(500).json({ error: error.message || 'Analysis failed' });
  }
}
