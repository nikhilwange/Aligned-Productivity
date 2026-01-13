export type RecordingSource = 'in-person' | 'virtual-meeting' | 'phone-call';

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