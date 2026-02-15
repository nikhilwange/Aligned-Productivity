import { GoogleGenAI } from "@google/genai";
import { RecordingSession, StrategicAnalysis, ProcessGap, StrategicAction, IssuePattern } from "../types";
import { retryOperation } from "./geminiService";

/**
 * Aggregates all meeting analysis data for strategic processing
 */
const aggregateMeetingData = (recordings: RecordingSession[]): string => {
  const completedRecordings = recordings.filter(
    r => r.status === 'completed' && r.analysis && r.source !== 'dictation'
  );

  if (completedRecordings.length === 0) {
    throw new Error('No completed recordings available for analysis');
  }

  let aggregatedData = `# WORKSPACE INTELLIGENCE DATA\n\n`;
  aggregatedData += `Total Meetings Analyzed: ${completedRecordings.length}\n`;
  aggregatedData += `Date Range: ${new Date(Math.min(...completedRecordings.map(r => r.date))).toLocaleDateString()} - ${new Date(Math.max(...completedRecordings.map(r => r.date))).toLocaleDateString()}\n\n`;

  aggregatedData += `---\n\n`;

  completedRecordings.forEach((recording, index) => {
    aggregatedData += `## MEETING ${index + 1}: ${recording.title}\n`;
    aggregatedData += `Date: ${new Date(recording.date).toLocaleDateString()}\n`;
    aggregatedData += `Type: ${recording.analysis!.meetingType || 'Unknown'}\n`;
    aggregatedData += `Duration: ${Math.floor(recording.duration / 60)}m\n\n`;

    aggregatedData += `### Summary\n${recording.analysis!.summary}\n\n`;

    if (recording.analysis!.actionPoints && recording.analysis!.actionPoints.length > 0) {
      aggregatedData += `### Action Items\n`;
      recording.analysis!.actionPoints.forEach(action => {
        aggregatedData += `- ${action}\n`;
      });
      aggregatedData += `\n`;
    }

    aggregatedData += `---\n\n`;
  });

  return aggregatedData;
};

/**
 * Parse Gemini's strategic analysis response into structured data
 */
const parseStrategicResponse = (text: string, recordingsCount: number, dateRange: { start: number; end: number }): StrategicAnalysis => {
  // Extract summary
  const summaryMatch = text.match(/📊\s*Executive Summary\s*([\s\S]*?)(?=🔍|$)/i);
  const summary = summaryMatch ? summaryMatch[1].trim() : "";

  // Extract Process Gaps
  const gapsMatch = text.match(/🔍\s*Process Gaps\s*([\s\S]*?)(?=🎯|$)/i);
  const processGaps: ProcessGap[] = [];
  if (gapsMatch) {
    const gapBlocks = gapsMatch[1].split(/\n\n+/);
    gapBlocks.forEach(block => {
      const titleMatch = block.match(/Title:\s*(.+)/i);
      const descMatch = block.match(/Description:\s*(.+)/i);
      const freqMatch = block.match(/Frequency:\s*(\d+)/i);
      const impactMatch = block.match(/Impact:\s*(high|medium|low)/i);

      if (titleMatch) {
        processGaps.push({
          title: titleMatch[1].trim(),
          description: descMatch ? descMatch[1].trim() : "",
          frequency: freqMatch ? parseInt(freqMatch[1]) : 1,
          impact: (impactMatch ? impactMatch[1] : 'medium') as 'high' | 'medium' | 'low',
          relatedMeetings: []
        });
      }
    });
  }

  // Extract Strategic Actions
  const actionsMatch = text.match(/🎯\s*Strategic Actions\s*([\s\S]*?)(?=⚠️|💡|$)/i);
  const strategicActions: StrategicAction[] = [];
  if (actionsMatch) {
    const actionBlocks = actionsMatch[1].split(/\n\n+/);
    actionBlocks.forEach(block => {
      const titleMatch = block.match(/Title:\s*(.+)/i);
      const descMatch = block.match(/Description:\s*(.+)/i);
      const rationaleMatch = block.match(/Rationale:\s*(.+)/i);
      const priorityMatch = block.match(/Priority:\s*(urgent|high|medium|low)/i);

      if (titleMatch) {
        strategicActions.push({
          title: titleMatch[1].trim(),
          description: descMatch ? descMatch[1].trim() : "",
          rationale: rationaleMatch ? rationaleMatch[1].trim() : "",
          priority: (priorityMatch ? priorityMatch[1] : 'medium') as 'urgent' | 'high' | 'medium' | 'low',
          estimatedImpact: ""
        });
      }
    });
  }

  // Extract Issue Patterns
  const issuesMatch = text.match(/⚠️\s*Issue Patterns\s*([\s\S]*?)(?=💡|$)/i);
  const issuePatterns: IssuePattern[] = [];
  if (issuesMatch) {
    const issueBlocks = issuesMatch[1].split(/\n\n+/);
    issueBlocks.forEach(block => {
      const issueMatch = block.match(/Issue:\s*(.+)/i);
      const occMatch = block.match(/Occurrences:\s*(\d+)/i);
      const statusMatch = block.match(/Status:\s*(recurring|escalating|resolved)/i);

      if (issueMatch) {
        issuePatterns.push({
          issue: issueMatch[1].trim(),
          occurrences: occMatch ? parseInt(occMatch[1]) : 1,
          firstMentioned: dateRange.start,
          lastMentioned: dateRange.end,
          status: (statusMatch ? statusMatch[1] : 'recurring') as 'recurring' | 'escalating' | 'resolved',
          context: ""
        });
      }
    });
  }

  // Extract Key Themes
  const themesMatch = text.match(/💡\s*Key Themes\s*([\s\S]*?)(?=$)/i);
  const keyThemes: string[] = [];
  if (themesMatch) {
    const themeLines = themesMatch[1].split('\n').filter(line => line.trim().startsWith('-'));
    themeLines.forEach(line => {
      const theme = line.replace(/^-\s*/, '').trim();
      if (theme) keyThemes.push(theme);
    });
  }

  return {
    summary,
    processGaps,
    strategicActions,
    issuePatterns,
    keyThemes,
    analyzedMeetingsCount: recordingsCount,
    dateRange,
    generatedAt: Date.now()
  };
};

/**
 * Main function: Analyze all meetings for strategic insights
 */
export const generateStrategicAnalysis = async (recordings: RecordingSession[]): Promise<StrategicAnalysis> => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("API Key is missing.");

  const ai = new GoogleGenAI({ apiKey });

  // Aggregate all meeting data
  const aggregatedData = aggregateMeetingData(recordings);

  const completedRecordings = recordings.filter(
    r => r.status === 'completed' && r.analysis && r.source !== 'dictation'
  );

  const dates = completedRecordings.map(r => r.date);
  const dateRange = {
    start: Math.min(...dates),
    end: Math.max(...dates)
  };

  const isSingleMeeting = completedRecordings.length === 1;

  // Strategic analysis prompt (following existing emoji header pattern)
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
    console.log('[Strategic Analysis] Starting analysis of', completedRecordings.length, 'meetings');

    const response = await retryOperation(() =>
      ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [{ text: strategicPrompt }]
        },
        generationConfig: {
          maxOutputTokens: 65536,
          temperature: 0.1,
        }
      }),
      3,
      1000,
      'Strategic analysis generation'
    );

    const responseText = response.text;
    if (!responseText) throw new Error("Empty strategic analysis response from Gemini.");

    console.log('[Strategic Analysis] Analysis complete, parsing response');

    const analysis = parseStrategicResponse(responseText, completedRecordings.length, dateRange);

    console.log('[Strategic Analysis] Parsed successfully:', {
      processGaps: analysis.processGaps.length,
      strategicActions: analysis.strategicActions.length,
      issuePatterns: analysis.issuePatterns.length,
      keyThemes: analysis.keyThemes.length
    });

    return analysis;

  } catch (error) {
    console.error("[Strategic Analysis] Failed:", error);
    throw error;
  }
};
