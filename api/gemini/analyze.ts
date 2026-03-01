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

  const { transcript } = req.body;
  if (!transcript) {
    return res.status(400).json({ error: 'Missing transcript' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const analysisPrompt = `You are an expert meeting assistant that creates comprehensive, well-structured meeting notes.

Analyze this meeting transcript and provide detailed notes in the following format:

📋 Meeting Overview
Date: [Extract or use today's date]
Duration: [Estimate from transcript length/timestamps]
Attendees: [List all speakers mentioned]
Meeting Type: [Infer: standup, planning, brainstorm, review, etc.]

🎯 Key Takeaways
Provide 3-5 concise bullet points highlighting the most important outcomes.

📝 Summary
Write a comprehensive 2-3 paragraph narrative summary.

💬 Discussion Points
Organize by themes. For each theme, use these sub-headers on SEPARATE lines (not inline):
### [Theme Title]
**Context:** [description on its own line]
**Key Points:**
- bullet point 1
- bullet point 2
**Participants' Views:**
- **[Name]:** their view

✅ Action Items
List all tasks with checkboxes:
- [ ] [Clear, actionable task description]

🔲 Decisions Made
| Decision Title | What was decided | Why | Impact |

❓ Open Questions
Capture unresolved questions or items needing discussion.

📊 Data & Metrics Mentioned
| Metric | Value | Context |

📅 Important Dates & Deadlines
Extract all dates mentioned.

🔗 References & Resources
List documents, links, tools, or resources mentioned.

💡 Ideas & Suggestions
Capture brainstormed ideas or proposals.

🧱 Blockers & Risks
Identify obstacles, concerns, or risks discussed.

📍 Next Steps
Summarize what should happen next in priority order.

📌 Additional Notes
Any other relevant information.

FORMATTING INSTRUCTIONS:
- Use emoji headers (📋, 🎯, etc.) for each section — always followed by a space and the section title
- Use **bold** only for primary labels at the start of a line (e.g., **Date:** value, **Duration:** value, **Owner:** value)
- Every label MUST be followed by a colon and a space (e.g., **Attendees:** John, Sarah)
- CRITICAL: **Context:**, **Key Points:**, and **Participants' Views:** MUST each start on their OWN new line
- Use standard Markdown tables with header rows and separator rows (| --- |)
- Use - for bullet points and - [ ] for action item checkboxes
- Write ALL notes, summaries, and analysis ENTIRELY in English. Do NOT include any Hindi, Marathi, or other non-English words — translate everything to English.
- Use ### for sub-section headers within a section
- Do NOT use bold for emphasis within sentences — only for labels at the start of lines
- Professional tone throughout
- DO NOT include the full transcript in output - it is stored separately

TRANSCRIPT TO ANALYZE:
${transcript}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [{ text: analysisPrompt }],
      },
      generationConfig: {
        maxOutputTokens: 65536,
        temperature: 0.1,
      },
    });

    const responseText = response.text;
    if (!responseText) {
      return res.status(500).json({ error: 'Empty analysis response from Gemini' });
    }

    const isTruncated = response.candidates?.[0]?.finishReason === 'MAX_TOKENS';

    return res.status(200).json({ analysisText: responseText, isTruncated });
  } catch (error: any) {
    console.error('[API] Gemini analyze error:', error);
    return res.status(500).json({ error: error.message || 'Analysis failed' });
  }
}
