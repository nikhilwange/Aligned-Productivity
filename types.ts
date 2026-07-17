export type RecordingSource = 'in-person' | 'virtual-meeting' | 'phone-call' | 'dictation';
export type ProcessingStep = 'transcribing' | 'analyzing' | 'finalizing';

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
  processingStep?: ProcessingStep;
  recoveryId?: string; // IndexedDB key — kept while audio is still recoverable for retry
  audioPath?: string;  // Supabase Storage path for the archived full recording (for replay/re-analysis)
}

export enum AppState {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  PAUSED = 'PAUSED',
  PROCESSING = 'PROCESSING',
}

export interface AudioRecording {
  blob: Blob;
  url: string;
  duration: number;
  source: RecordingSource;
  recoveryId?: string;
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

// ─── Action Tracker ───────────────────────────────────────────────────────────

export type ActionItemStatus = 'not_started' | 'in_progress' | 'on_hold' | 'completed';

export interface TrackedActionItem {
  id: string;
  displayId: number;            // Per-user sequential, e.g. 128 → "A-128"
  userId: string;
  recordingId: string | null;
  text: string;
  status: ActionItemStatus;
  functionTag: string | null;
  assignee: string | null;
  dueDate: number | null;       // Unix ms; null = no due date
  sourceIndex: number | null;
  createdAt: number;
  updatedAt: number;
  // Denormalized client-side from recordings array
  sessionTitle?: string;
  sessionDate?: number;
}

export interface ActionItemUpdate {
  status?: ActionItemStatus;
  functionTag?: string | null;
  assignee?: string | null;
  dueDate?: number | null;
  text?: string;
}

export interface PinnedInsight {
  id: string;
  question: string;
  answer: string;
  citations?: string[];
  scope: string;
  pinnedAt: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  citations?: string[];
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

// ─── Subscriptions / billing ─────────────────────────────────────────────────

export type PlanTier = 'free' | 'pro';
export type PlanCycle = 'monthly' | 'annual';

// Mirrors Razorpay's subscription lifecycle. We don't try to enumerate every
// possible value Razorpay might add later — anything unknown still gets
// stored as a string in the DB so we can react in the dashboard.
export type SubscriptionStatus =
  | 'created'
  | 'authenticated'
  | 'active'
  | 'pending'
  | 'halted'
  | 'cancelled'
  | 'completed'
  | 'expired';

export interface Subscription {
  userId: string;
  planTier: PlanTier;
  planCycle: PlanCycle | null;
  razorpayCustomerId: string | null;
  razorpaySubscriptionId: string | null;
  status: SubscriptionStatus | null;
  currentPeriodStart: number | null;   // ms epoch
  currentPeriodEnd: number | null;     // ms epoch
  cancelAtPeriodEnd: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UsageMeter {
  userId: string;
  periodYear: number;
  periodMonth: number; // 1-12
  meetingsCount: number;
  minutesUsed: number;
  updatedAt: number;
}

// Aggregate state surfaced by useSubscription — combines DB rows with the
// app-side caps so consumers don't have to repeat the math.
export interface SubscriptionState {
  subscription: Subscription | null;
  usage: { meetings: number; minutes: number };
  caps: { meetings: number; minutes: number } | null; // null = unlimited (pro)
  isPro: boolean;
  isOverCap: boolean;
  capPercent: number; // 0..1 of the closer cap; 0 for pro/unlimited
  loading: boolean;
}