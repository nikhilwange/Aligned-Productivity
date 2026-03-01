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

  const { aggregatedData, isSingleMeeting } = req.body;
  if (!aggregatedData) {
    return res.status(400).json({ error: 'Missing aggregatedData' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

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

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [{ text: strategicPrompt }],
      },
      generationConfig: {
        maxOutputTokens: 65536,
        temperature: 0.1,
      },
    });

    const responseText = response.text;
    if (!responseText) {
      return res.status(500).json({ error: 'Empty strategic analysis response from Gemini' });
    }

    return res.status(200).json({ responseText });
  } catch (error: any) {
    console.error('[API] Gemini strategic error:', error);
    return res.status(500).json({ error: error.message || 'Strategic analysis failed' });
  }
}
