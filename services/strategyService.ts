import { RecordingSession, StrategicAnalysis, ProcessGap, StrategicAction, IssuePattern } from "../types";
import { retryOperation } from "./geminiService";
import { supabase } from "./supabaseService";

const getAuthToken = async (): Promise<string> => {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not authenticated. Please log in.");
  return token;
};

/**
 * Aggregates all meeting analysis data for strategic processing.
 * This runs client-side — only the final text payload is sent to the server.
 */
const aggregateMeetingData = (recordings: RecordingSession[]): string => {
  const completedRecordings = recordings.filter(
    (r) => r.status === "completed" && r.analysis && r.source !== "dictation"
  );

  if (completedRecordings.length === 0) {
    throw new Error("No completed recordings available for analysis");
  }

  let aggregatedData = `# WORKSPACE INTELLIGENCE DATA\n\n`;
  aggregatedData += `Total Meetings Analyzed: ${completedRecordings.length}\n`;
  aggregatedData += `Date Range: ${new Date(
    Math.min(...completedRecordings.map((r) => r.date))
  ).toLocaleDateString()} - ${new Date(
    Math.max(...completedRecordings.map((r) => r.date))
  ).toLocaleDateString()}\n\n`;
  aggregatedData += `---\n\n`;

  completedRecordings.forEach((recording, index) => {
    aggregatedData += `## MEETING ${index + 1}: ${recording.title}\n`;
    aggregatedData += `Date: ${new Date(recording.date).toLocaleDateString()}\n`;
    aggregatedData += `Type: ${recording.analysis!.meetingType || "Unknown"}\n`;
    aggregatedData += `Duration: ${Math.floor(recording.duration / 60)}m\n\n`;
    aggregatedData += `### Summary\n${recording.analysis!.summary}\n\n`;

    if (recording.analysis!.actionPoints?.length > 0) {
      aggregatedData += `### Action Items\n`;
      recording.analysis!.actionPoints.forEach((action) => {
        aggregatedData += `- ${action}\n`;
      });
      aggregatedData += `\n`;
    }

    aggregatedData += `---\n\n`;
  });

  return aggregatedData;
};

/**
 * Parse Gemini's strategic analysis response into structured data.
 * (Unchanged from original — keeps your parsing logic intact.)
 */
const parseStrategicResponse = (
  text: string,
  recordingsCount: number,
  dateRange: { start: number; end: number }
): StrategicAnalysis => {
  const summaryMatch = text.match(/📊\s*Executive Summary\s*([\s\S]*?)(?=🔍|$)/i);
  const summary = summaryMatch ? summaryMatch[1].trim() : "";

  const gapsMatch = text.match(/🔍\s*Process Gaps\s*([\s\S]*?)(?=🎯|$)/i);
  const processGaps: ProcessGap[] = [];
  if (gapsMatch) {
    const gapBlocks = gapsMatch[1].split(/\n\n+/);
    gapBlocks.forEach((block) => {
      const titleMatch = block.match(/Title:\s*(.+)/i);
      const descMatch = block.match(/Description:\s*(.+)/i);
      const freqMatch = block.match(/Frequency:\s*(\d+)/i);
      const impactMatch = block.match(/Impact:\s*(high|medium|low)/i);
      if (titleMatch) {
        processGaps.push({
          title: titleMatch[1].trim(),
          description: descMatch ? descMatch[1].trim() : "",
          frequency: freqMatch ? parseInt(freqMatch[1]) : 1,
          impact: (impactMatch ? impactMatch[1] : "medium") as "high" | "medium" | "low",
          relatedMeetings: [],
        });
      }
    });
  }

  const actionsMatch = text.match(/🎯\s*Strategic Actions\s*([\s\S]*?)(?=⚠️|💡|$)/i);
  const strategicActions: StrategicAction[] = [];
  if (actionsMatch) {
    const actionBlocks = actionsMatch[1].split(/\n\n+/);
    actionBlocks.forEach((block) => {
      const titleMatch = block.match(/Title:\s*(.+)/i);
      const descMatch = block.match(/Description:\s*(.+)/i);
      const rationaleMatch = block.match(/Rationale:\s*(.+)/i);
      const priorityMatch = block.match(/Priority:\s*(urgent|high|medium|low)/i);
      if (titleMatch) {
        strategicActions.push({
          title: titleMatch[1].trim(),
          description: descMatch ? descMatch[1].trim() : "",
          rationale: rationaleMatch ? rationaleMatch[1].trim() : "",
          priority: (priorityMatch ? priorityMatch[1] : "medium") as "urgent" | "high" | "medium" | "low",
          estimatedImpact: "",
        });
      }
    });
  }

  const issuesMatch = text.match(/⚠️\s*Issue Patterns\s*([\s\S]*?)(?=💡|$)/i);
  const issuePatterns: IssuePattern[] = [];
  if (issuesMatch) {
    const issueBlocks = issuesMatch[1].split(/\n\n+/);
    issueBlocks.forEach((block) => {
      const issueMatch = block.match(/Issue:\s*(.+)/i);
      const occMatch = block.match(/Occurrences:\s*(\d+)/i);
      const statusMatch = block.match(/Status:\s*(recurring|escalating|resolved)/i);
      if (issueMatch) {
        issuePatterns.push({
          issue: issueMatch[1].trim(),
          occurrences: occMatch ? parseInt(occMatch[1]) : 1,
          firstMentioned: dateRange.start,
          lastMentioned: dateRange.end,
          status: (statusMatch ? statusMatch[1] : "recurring") as "recurring" | "escalating" | "resolved",
          context: "",
        });
      }
    });
  }

  const themesMatch = text.match(/💡\s*Key Themes\s*([\s\S]*?)(?=$)/i);
  const keyThemes: string[] = [];
  if (themesMatch) {
    const themeLines = themesMatch[1].split("\n").filter((line) => line.trim().startsWith("-"));
    themeLines.forEach((line) => {
      const theme = line.replace(/^-\s*/, "").trim();
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
    generatedAt: Date.now(),
  };
};

/**
 * Main function: Analyze all meetings for strategic insights via secure API route.
 */
export const generateStrategicAnalysis = async (
  recordings: RecordingSession[]
): Promise<StrategicAnalysis> => {
  const aggregatedData = aggregateMeetingData(recordings);
  const completedRecordings = recordings.filter(
    (r) => r.status === "completed" && r.analysis && r.source !== "dictation"
  );
  const dates = completedRecordings.map((r) => r.date);
  const dateRange = { start: Math.min(...dates), end: Math.max(...dates) };
  const isSingleMeeting = completedRecordings.length === 1;

  console.log("[Strategic Analysis] Starting analysis of", completedRecordings.length, "meetings");

  const token = await getAuthToken();

  const response = await retryOperation(
    async () => {
      const res = await fetch("/api/gemini/strategic", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ aggregatedData, isSingleMeeting }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        const error: any = new Error(err.error || "Strategic analysis failed");
        error.status = res.status;
        throw error;
      }
      return res.json();
    },
    3,
    1000,
    "Strategic analysis generation"
  );

  const analysis = parseStrategicResponse(response.responseText, completedRecordings.length, dateRange);
  console.log("[Strategic Analysis] Parsed successfully:", {
    processGaps: analysis.processGaps.length,
    strategicActions: analysis.strategicActions.length,
    issuePatterns: analysis.issuePatterns.length,
    keyThemes: analysis.keyThemes.length,
  });

  return analysis;
};
