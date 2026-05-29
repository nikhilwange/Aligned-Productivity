import { RecordingSession, StrategicAnalysis, ProcessGap, StrategicAction, IssuePattern } from "../types";
import { retryOperation, invokeEdgeFunction } from "./geminiService";

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
 * Parse the strategic analysis response into structured data.
 *
 * History: originally this matched five rigid emoji-prefixed headers
 * (e.g. `/📊\s*Executive Summary/`). That worked when the response came
 * directly from Gemini, because Gemini reproduced the emojis faithfully.
 * Now that the request flows through Portkey, the active provider may be
 * Gemini, OpenAI, or Krutrim — and any of them can render the headers as
 * `**Executive Summary**`, `## Executive Summary`, plain text, or even
 * wrap the whole document in ```markdown fences. The old regex returned
 * null for every section, leaving the StrategistView blank with just the
 * "Regenerate Analysis" button.
 *
 * This rewrite:
 *   1. Strips leading/trailing markdown code fences.
 *   2. Tries a JSON fallback first — some Portkey configs / providers
 *      return `{ summary: ..., processGaps: [...] }` instead of prose.
 *   3. Splits the text into sections by header recognition (matches the
 *      header on its OWN LINE, with or without emoji / `**` / `##` /
 *      `###` decoration), then routes each section to its parser.
 *   4. Section blocks inside (Title:, Description:, etc.) still use the
 *      same field-label regexes — those are stable across providers.
 */
const SECTION_NAMES = {
  summary: 'executive summary',
  gaps: 'process gaps',
  actions: 'strategic actions',
  issues: 'issue patterns',
  themes: 'key themes',
} as const;

const ALL_SECTION_KEYS = Object.values(SECTION_NAMES);

/** Strip ``` fences and any leading "markdown"/"json" language tag. */
const stripCodeFences = (text: string): string => {
  let t = text.trim();
  t = t.replace(/^```(?:markdown|md|json|text|plaintext)?\s*\n?/i, '');
  t = t.replace(/\n?```\s*$/, '');
  return t.trim();
};

/**
 * Strip markdown emphasis markers from an extracted field. Portkey-fronted
 * providers (especially when served from semantic cache) commonly wrap or
 * embed bold markers in field values:
 *   - leading/trailing: `**Title**`, `** text **`
 *   - inline: `**Bold label:** rest of sentence` (very common in Key Themes
 *     bullets, where each item is a `**Theme:** description` pair)
 * StrategistView renders these fields as plain text, so any unstripped
 * `**` / `__` leaks into the UI as literal asterisks.
 *
 * We remove ALL paired bold markers (`**`, `__`) anywhere in the string,
 * plus any single `*` / `_` at the very start or end. Standalone inline
 * single `*` / `_` are left alone — they're unlikely in this output and
 * could be legitimate punctuation.
 */
const stripEmphasis = (s: string): string =>
  s
    .trim()
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/^[*_]+\s*/, '')
    .replace(/\s*[*_]+$/, '')
    .trim();

/**
 * Split the response into sections keyed by lower-cased section name.
 *
 * Header recognition: a line that — after stripping leading whitespace,
 * up to two leading emojis, optional `#` or `*` markers — equals one of
 * the known section names (case-insensitive). The body of a section is
 * everything between its header line and the next header line (or EOF).
 */
const splitIntoSections = (text: string): Record<string, string> => {
  const lines = text.split('\n');
  const headerIndices: Array<{ name: string; idx: number }> = [];

  const headerRegex =
    /^\s*(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}️]\s*){0,3}(?:#{1,6}\s+|\*{1,3}\s*)?([A-Za-z][A-Za-z &]+?)(?:\s*\*{1,3}|\s*:)?\s*$/u;

  lines.forEach((line, idx) => {
    const m = line.match(headerRegex);
    if (!m) return;
    const candidate = m[1].toLowerCase().trim();
    if (ALL_SECTION_KEYS.includes(candidate as typeof ALL_SECTION_KEYS[number])) {
      headerIndices.push({ name: candidate, idx });
    }
  });

  const sections: Record<string, string> = {};
  for (let i = 0; i < headerIndices.length; i++) {
    const start = headerIndices[i].idx + 1;
    const end = i + 1 < headerIndices.length ? headerIndices[i + 1].idx : lines.length;
    sections[headerIndices[i].name] = lines.slice(start, end).join('\n').trim();
  }
  return sections;
};

/** Try to coerce a JSON-shaped response into a StrategicAnalysis. */
const tryParseJsonFallback = (
  text: string,
  recordingsCount: number,
  dateRange: { start: number; end: number },
): StrategicAnalysis | null => {
  if (!text.startsWith('{')) return null;
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }

  const pickArray = (...keys: string[]): any[] => {
    for (const k of keys) {
      const v = json[k];
      if (Array.isArray(v)) return v;
    }
    return [];
  };

  const summary: string =
    json.summary ?? json.executiveSummary ?? json.executive_summary ?? '';

  const processGaps: ProcessGap[] = pickArray('processGaps', 'process_gaps', 'gaps').map((g: any) => ({
    title: stripEmphasis(String(g.title ?? g.name ?? '')),
    description: stripEmphasis(String(g.description ?? g.desc ?? '')),
    frequency: Number(g.frequency ?? 1) || 1,
    impact: (String(g.impact ?? 'medium').toLowerCase() as 'high' | 'medium' | 'low'),
    relatedMeetings: [],
  })).filter((g) => g.title);

  const strategicActions: StrategicAction[] = pickArray('strategicActions', 'strategic_actions', 'actions').map((a: any) => ({
    title: stripEmphasis(String(a.title ?? a.name ?? '')),
    description: stripEmphasis(String(a.description ?? a.desc ?? '')),
    rationale: stripEmphasis(String(a.rationale ?? a.reason ?? '')),
    priority: (String(a.priority ?? 'medium').toLowerCase() as 'urgent' | 'high' | 'medium' | 'low'),
    estimatedImpact: stripEmphasis(String(a.estimatedImpact ?? a.estimated_impact ?? a.impact ?? '')),
  })).filter((a) => a.title);

  const issuePatterns: IssuePattern[] = pickArray('issuePatterns', 'issue_patterns', 'issues').map((i: any) => ({
    issue: stripEmphasis(String(i.issue ?? i.title ?? i.description ?? '')),
    occurrences: Number(i.occurrences ?? 1) || 1,
    firstMentioned: dateRange.start,
    lastMentioned: dateRange.end,
    status: (String(i.status ?? 'recurring').toLowerCase() as 'recurring' | 'escalating' | 'resolved'),
    context: stripEmphasis(String(i.context ?? '')),
  })).filter((i) => i.issue);

  const keyThemes: string[] = pickArray('keyThemes', 'key_themes', 'themes')
    .map((t: any) => stripEmphasis(typeof t === 'string' ? t : String(t?.name ?? '')))
    .filter(Boolean);

  return {
    summary: stripEmphasis(String(summary)),
    processGaps,
    strategicActions,
    issuePatterns,
    keyThemes,
    analyzedMeetingsCount: recordingsCount,
    dateRange,
    generatedAt: Date.now(),
  };
};

const parseStrategicResponse = (
  text: string,
  recordingsCount: number,
  dateRange: { start: number; end: number }
): StrategicAnalysis => {
  const cleaned = stripCodeFences(text);

  const jsonResult = tryParseJsonFallback(cleaned, recordingsCount, dateRange);
  if (jsonResult) return jsonResult;

  const sections = splitIntoSections(cleaned);

  const summary = stripEmphasis(sections[SECTION_NAMES.summary] ?? '');

  const parseGapBlocks = (body: string): ProcessGap[] => {
    if (!body) return [];
    return body.split(/\n\n+/).map((block) => {
      const titleMatch = block.match(/Title:\s*(.+)/i);
      const descMatch = block.match(/Description:\s*(.+)/i);
      const freqMatch = block.match(/Frequency:\s*(\d+)/i);
      const impactMatch = block.match(/Impact:\s*(high|medium|low)/i);
      if (!titleMatch) return null;
      return {
        title: stripEmphasis(titleMatch[1]),
        description: descMatch ? stripEmphasis(descMatch[1]) : '',
        frequency: freqMatch ? parseInt(freqMatch[1]) : 1,
        impact: (impactMatch ? impactMatch[1] : 'medium') as 'high' | 'medium' | 'low',
        relatedMeetings: [],
      } satisfies ProcessGap;
    }).filter((g): g is ProcessGap => g !== null);
  };

  const parseActionBlocks = (body: string): StrategicAction[] => {
    if (!body) return [];
    return body.split(/\n\n+/).map((block) => {
      const titleMatch = block.match(/Title:\s*(.+)/i);
      const descMatch = block.match(/Description:\s*(.+)/i);
      const rationaleMatch = block.match(/Rationale:\s*(.+)/i);
      const priorityMatch = block.match(/Priority:\s*(urgent|high|medium|low)/i);
      if (!titleMatch) return null;
      return {
        title: stripEmphasis(titleMatch[1]),
        description: descMatch ? stripEmphasis(descMatch[1]) : '',
        rationale: rationaleMatch ? stripEmphasis(rationaleMatch[1]) : '',
        priority: (priorityMatch ? priorityMatch[1] : 'medium') as 'urgent' | 'high' | 'medium' | 'low',
        estimatedImpact: '',
      } satisfies StrategicAction;
    }).filter((a): a is StrategicAction => a !== null);
  };

  const parseIssueBlocks = (body: string): IssuePattern[] => {
    if (!body) return [];
    return body.split(/\n\n+/).map((block) => {
      const issueMatch = block.match(/Issue:\s*(.+)/i);
      const occMatch = block.match(/Occurrences:\s*(\d+)/i);
      const statusMatch = block.match(/Status:\s*(recurring|escalating|resolved)/i);
      if (!issueMatch) return null;
      return {
        issue: stripEmphasis(issueMatch[1]),
        occurrences: occMatch ? parseInt(occMatch[1]) : 1,
        firstMentioned: dateRange.start,
        lastMentioned: dateRange.end,
        status: (statusMatch ? statusMatch[1] : 'recurring') as 'recurring' | 'escalating' | 'resolved',
        context: '',
      } satisfies IssuePattern;
    }).filter((i): i is IssuePattern => i !== null);
  };

  const parseThemeLines = (body: string): string[] => {
    if (!body) return [];
    return body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('-') || line.startsWith('*') || /^\d+\./.test(line))
      .map((line) => stripEmphasis(line.replace(/^[-*]\s*|^\d+\.\s*/, '')))
      .filter(Boolean);
  };

  return {
    summary,
    processGaps: parseGapBlocks(sections[SECTION_NAMES.gaps] ?? ''),
    strategicActions: parseActionBlocks(sections[SECTION_NAMES.actions] ?? ''),
    issuePatterns: parseIssueBlocks(sections[SECTION_NAMES.issues] ?? ''),
    keyThemes: parseThemeLines(sections[SECTION_NAMES.themes] ?? ''),
    analyzedMeetingsCount: recordingsCount,
    dateRange,
    generatedAt: Date.now(),
  };
};

/**
 * Main function: Analyze all meetings for strategic insights via Gemini directly.
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

  // Strategic analysis lives on Supabase Edge Function (150s budget) — Vercel
  // Hobby's 60s ceiling can't fit a 65K-token Gemini response.
  const responseText = await retryOperation(
    async () => {
      const data = await invokeEdgeFunction<{ responseText: string }>(
        'gemini-strategic',
        { aggregatedData, isSingleMeeting },
      );
      if (!data.responseText) throw new Error("Empty strategic analysis response");
      return data.responseText;
    },
    3,
    1000,
    "Strategic analysis generation"
  );

  // Surface the raw response so a parser miss is obvious in DevTools.
  console.log(
    "[Strategic Analysis] Raw response (first 500 chars):",
    responseText.slice(0, 500),
  );

  const analysis = parseStrategicResponse(responseText, completedRecordings.length, dateRange);
  console.log("[Strategic Analysis] Parsed:", {
    summaryLength: analysis.summary.length,
    processGaps: analysis.processGaps.length,
    strategicActions: analysis.strategicActions.length,
    issuePatterns: analysis.issuePatterns.length,
    keyThemes: analysis.keyThemes.length,
  });

  return analysis;
};
