export type RecordingSource = 'in-person' | 'virtual-meeting' | 'phone-call' | 'dictation';

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface MeetingAnalysis {
  transcript: string;
  summary: string;
  actionPoints: string[];
  detectedLanguages?: string[];
  isTruncated?: boolean;
  meetingType?: string;
}

export interface RecordingSession {
  id: string;
  title: string;
  date: number; // timestamp
  duration: number;
  analysis: MeetingAnalysis | null;
  status: 'processing' | 'completed' | 'error';
  errorMessage?: string;
  source: RecordingSource;
}

export enum AppState {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  PAUSED = 'PAUSED',
  PROCESSING = 'PROCESSING',
  LIVE = 'LIVE',
}

export interface AudioRecording {
  blob: Blob;
  url: string;
  duration: number;
  source: RecordingSource;
}

export interface ProcessGap {
  title: string;
  description: string;
  frequency: number;
  impact: 'high' | 'medium' | 'low';
  relatedMeetings: string[];
}

export interface StrategicAction {
  title: string;
  description: string;
  rationale: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  estimatedImpact: string;
  suggestedOwner?: string;
}

export interface IssuePattern {
  issue: string;
  occurrences: number;
  firstMentioned: number;
  lastMentioned: number;
  status: 'recurring' | 'escalating' | 'resolved';
  context: string;
}

export interface StrategicAnalysis {
  summary: string;
  processGaps: ProcessGap[];
  strategicActions: StrategicAction[];
  issuePatterns: IssuePattern[];
  keyThemes: string[];
  analyzedMeetingsCount: number;
  dateRange: { start: number; end: number };
  generatedAt: number;
}