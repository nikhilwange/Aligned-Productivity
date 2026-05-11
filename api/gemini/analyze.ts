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

RULES FOR actionPoints:
- Plain strings only — no "- [ ]" checkbox prefix
- Each item must be a clear, actionable task
- Empty array [] if no action items

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

For any action item that does not have a clear assignee, list it as a plain checkbox bullet at the very top of this section, with no header above it. Do NOT invent an "Unassigned", "Team", "All", or "Everyone" group — items without an owner just appear as bare bullets.

Use the same set of actions that you list in the actionPoints array, but here rephrased to remove the assignee prefix and grouped under the owner. Each item should be a single, clean action sentence.

Example format:
✅ Action Items
- [ ] Schedule a follow-up review next week

**Shailesh**
- [ ] Circulate the action tracker for pending safety points today
- [ ] Plan a monthly safety meeting

**Samir**
- [ ] Create a structured program to check material availability for schedules beyond 8 weeks
- [ ] Discuss material assessment status (6-9 month window) with Subhasis and Mali
- [ ] Start tracking BOM readiness

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
