
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import AudioRecorder from './components/AudioRecorder';
import ResultsView from './components/ResultsView';
import Sidebar from './components/Sidebar';
import DictationLogView from './components/DictationLogView';
import SessionsLogView from './components/SessionsLogView';
import ActionItemsView from './components/ActionItemsView';
import HomeView from './components/HomeView';
import IntelligenceView from './components/IntelligenceView';
import ManualEntryView from './components/ManualEntryView';
import SettingsView from './components/SettingsView';
import AuthView from './components/AuthView';
import ResetPassword from './components/ResetPassword';
import LandingPage from './components/LandingPage';
import OAuthConsent from './components/OAuthConsent';
import { AppState, RecordingSession, AudioRecording, User, ChatMessage, RecordingSource, TrackedActionItem, PlanTier } from './types';
import { isUsageLimitError, isSessionCeilingError } from './services/usageLimit';
import { minutesToHoursLabel } from './config/tiers';
import { STT_SESSION_CEILING_MIN, LEFTOVER_MAX_AGE_HOURS, MAX_PAUSE_MIN } from './config/sttLimits';
import { recordingController, claimRecording, isRecordingLive, type FinalizeReason, type RecordingResult } from './services/recordingController';
import RecordingIndicator from './components/RecordingIndicator';
import { usePromptAlert } from './hooks/usePromptAlert';
import LeftoverRecordingNotice from './components/LeftoverRecordingNotice';
import RetranscribeBanner from './components/RetranscribeBanner';
import AudioRetentionNotice from './components/AudioRetentionNotice';
import type { SegmentDeletion } from './services/segmentCleanupPolicy';
import { transcribeSegment, buildSegmentedTranscript, pausesFromManifest, transcriptForAnalysis, resultStatus, needsRetry, type SegmentPiece } from './services/segmentTranscript';
import { extractTranscript, analyzeTranscript } from './services/geminiService';
import { buildSessionTitle } from './utils/sessionTitle';
import { transcribeAudioWithSarvam } from './services/sarvamService';
import { uploadAudioToStorage, deleteAudioPaths, downloadAudioFromStorage, getRecordingFolderInfo } from './services/storageService';
import { supabase, fetchRecordings, saveRecording, deleteRecordingFromDb, fetchActionItems } from './services/supabaseService';
import { getRecoverableRecordings, clearRecoverySession, clearAllRecovery, clearChunkTranscripts, clearAllChunkTranscripts, purgeStaleChunkTranscripts, getSegmentManifest, getAllSegmentManifests, getSegmentBlob, clearSegmentManifest, purgeStaleSegmentManifests, getSegmentTranscripts, getSegmentResults, clearSegmentTranscripts, clearAllSegmentTranscripts, purgeStaleSegmentTranscripts, SegmentManifest } from './services/recordingRecovery';
import { reuploadPendingSegments, getActiveSegmentSessionId, ingestFileAsSegments, deleteSegmentedRecording, applyLocalRetention } from './services/segmentRecorder';
import { UNCLEAR_MARKER, segmentedAudioRetention, retentionWarningDaysLeft } from './supabase/functions/_shared/audioRetention.ts';
import { USE_SEGMENTED_RECORDING, BILLING_ENABLED } from './config/features';
import { startHeartbeat, clearHeartbeat, isHeartbeatFresh, HEARTBEAT_STALE_MS } from './services/processingHeartbeat';
import { beginPipelineRun, endPipelineRun } from './services/pipelineRuns';
import { stopLiveTranscription, clearLiveSession } from './services/liveTranscription';
import JSZip from 'jszip';
import { useWakeLock } from './hooks/useWakeLock';
import ProcessingBanner from './components/ProcessingBanner';
import RecoveryModal from './components/RecoveryModal';
import ConfirmModal, { ConfirmRequest } from './components/ConfirmModal';
import { ToastContainer, ToastData } from './components/Toast';
import PricingView from './components/PricingView';
import UpgradeModal from './components/UpgradeModal';
import BillingSection from './components/BillingSection';
import { useSubscription } from './hooks/useSubscription';
import { canStartNewRecording } from './hooks/usePaywall';

declare global {
  interface Window {
    ipcRenderer?: {
      on: (channel: string, func: (...args: any[]) => void) => (() => void) | undefined;
      send: (channel: string, data?: any) => void;
    };
  }
}

const isElectron = typeof window !== 'undefined' && !!(window as any).ipcRenderer;

// Per-session pipeline run tokens now live in services/pipelineRuns.ts so the
// live transcription worker can register in the SAME map (single authority for
// "who may do Sarvam work right now"). Behaviour is unchanged.

type ProgressMap = Record<string, { done: number; total: number }>;

// Set (or, with null, clear) one session's entry in a progress map.
const withProgress = (map: ProgressMap, id: string, value: { done: number; total: number } | null): ProgressMap => {
  if (value) return { ...map, [id]: value };
  if (!(id in map)) return map;
  const { [id]: _removed, ...rest } = map;
  return rest;
};

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [recordings, setRecordings] = useState<RecordingSession[]>([]);
  const [activeRecordingId, setActiveRecordingId] = useState<string | null>('home');
  const [isRecordingMode, setIsRecordingMode] = useState<boolean>(false);
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showAuthView, setShowAuthView] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('aligned-theme') as 'light' | 'dark') || 'light';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isManualProcessing, setIsManualProcessing] = useState(false);
  const [actionItems, setActionItems] = useState<TrackedActionItem[]>([]);
  const [recordingsLoading, setRecordingsLoading] = useState<boolean>(true);
  const [transcriptionEngine, setTranscriptionEngine] = useState<'gemini' | 'sarvam'>(() => {
    return (localStorage.getItem('aligned-engine') as 'gemini' | 'sarvam') || 'gemini';
  });

  // ─── Subscription / paywall state ─────────────────────────────────────────
  // Single source of truth for plan tier + usage caps. Realtime-subscribed
  // inside the hook so the webhook-driven tier flip lands without refresh.
  const subscriptionState = useSubscription(user?.id ?? null, user?.email ?? null);
  const [upgradeModal, setUpgradeModal] = useState<{ open: boolean; reason?: string; offerTiers?: PlanTier[] }>({ open: false });

  // ─── Processing UX State ──────────────────────────────────────────────────
  // Every session whose pipeline we're watching for a "ready"/"failed" toast.
  // Several can run at once — e.g. a new recording starts while the previous
  // one is still being summarized.
  const [processingSessionIds, setProcessingSessionIds] = useState<string[]>([]);
  const trackProcessing = useCallback((id: string) => {
    setProcessingSessionIds(prev => (prev.includes(id) ? prev : [...prev, id]));
  }, []);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [recoveryData, setRecoveryData] = useState<{
    durationStr: string;
    timeAgo: number;
    blob: Blob;
    source: RecordingSource;
    recoveryId: string;
  } | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  // Unfinished recordings found on load that were NOT auto-saved (old, too
  // long, or not the one auto-resumed). The user picks Save or Discard.
  const [leftoverRecordings, setLeftoverRecordings] = useState<SegmentManifest[]>([]);
  // Set below, once runSegmentedProcessingForSession exists; read by loadData.
  const resumeSegmentedRecordingRef = useRef<(m: SegmentManifest, existing: RecordingSession | null) => Promise<void>>(async () => {});
  // Banner progress, keyed by session id so concurrent pipelines don't clobber
  // each other. Component state only — never persisted.
  // Sarvam chunk progress ("26 of 144").
  const [chunkProgress, setChunkProgress] = useState<ProgressMap>({});
  // Segment progress for segmented processing ("Transcribing segment 4 of 22").
  const [segmentProgress, setSegmentProgress] = useState<ProgressMap>({});
  // How many segments the live worker had already transcribed when Finish ran.
  // When most of the work is pre-done the banner says "Finalizing your notes…"
  // instead of a raw segment count.
  const [preTranscribed, setPreTranscribed] = useState<ProgressMap>({});
  // "Download audio" gather progress for a failed segmented session ("Preparing download… 3 of 12").
  const [audioDownload, setAudioDownload] = useState<{ sessionId: string; done: number; total: number } | null>(null);
  // Client-side split progress for a manual audio upload. A 3.5h MP3 scans in
  // well under a second, but the per-segment upload that follows is network-
  // bound and worth showing. Component state only.
  const [uploadSplit, setUploadSplit] = useState<
    { sessionId: string; phase: 'splitting' | 'saving' | 'uploading'; percent: number } | null
  >(null);

  // Keep the device awake while any session is actively processing (fresh
  // recording, manual upload, retry, or auto-resume). Feature-detected + safe.
  const isProcessingActive = recordings.some(r => r.status === 'processing') || isManualProcessing;
  useWakeLock(isProcessingActive);

  // ─── Toast helper ─────────────────────────────────────────────────────────
  const addToast = useCallback((message: string, type: ToastData['type'] = 'success', opts?: { actionLabel?: string; onAction?: () => void }) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    setToasts(prev => [...prev, { id, message, type, ...opts }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ─── STT ceiling notices ──────────────────────────────────────────────────
  // "4-hour" for the real 240-min ceiling; "2-minute" when it's lowered to test.
  const sttCeilingLabel = STT_SESSION_CEILING_MIN % 60 === 0
    ? `${STT_SESSION_CEILING_MIN / 60}-hour`
    : `${STT_SESSION_CEILING_MIN}-minute`;
  // recoveryIds whose ceiling the recorder has already announced, so the
  // finisher hitting the same ceiling doesn't show a second notice.
  const ceilingNotifiedRef = useRef<Set<string>>(new Set());

  // What the user is told when a recording ended by itself. It was saved in
  // every case — only a confirmed Discard drops audio.
  const finalizeNotice = (reason: FinalizeReason): string | null => {
    switch (reason) {
      case 'session_ceiling': return `Recording reached the ${sttCeilingLabel} limit and was saved.`;
      case 'long_sleep': return 'Recording was saved when your device slept for a long time.';
      case 'silence': return 'Recording stopped after a long silence and was saved.';
      case 'share_ended': return 'Screen audio sharing ended, so the recording was saved.';
      case 'share_silent': return 'Meeting audio was silent for a while, so the recording was saved.';
      case 'pause_timeout': return `Recording was paused for ${MAX_PAUSE_MIN} minutes, so it was saved.`;
      case 'mic_ended': return 'The microphone disconnected, so the recording was saved.';
      case 'tier_cap': return `Free sessions are capped at ${minutesToHoursLabel(subscriptionState.sessionCapMinutes ?? 90)} — the recording was saved.`;
      default: return null;
    }
  };

  // Single chokepoint: returns true if the user is allowed to start a new
  // recording right now, otherwise opens the Upgrade modal with the
  // explanation copy and returns false. Callers (handleStartNew /
  // handleManualEntry) bail when this returns false.
  const checkRecordingAllowed = useCallback((): boolean => {
    // Billing off: no usage cap / paywall — every recording is allowed.
    if (!BILLING_ENABLED) return true;
    const decision = canStartNewRecording(subscriptionState);
    if (decision.allowed) return true;
    setUpgradeModal({ open: true, reason: decision.message, offerTiers: decision.upgradeTiers });
    return false;
  }, [subscriptionState]);

  // ─── Detect when processing finishes (success or error) ───────────────────
  useEffect(() => {
    if (processingSessionIds.length === 0) return;
    const finished: string[] = [];
    let anyCompleted = false;

    for (const id of processingSessionIds) {
      const session = recordings.find(r => r.id === id);
      if (!session) continue;
      const isViewingSession = activeRecordingId === id;
      const openSession = () => {
        setIsRecordingMode(false);
        setActiveRecordingId(id);
      };

      if (session.status === 'completed') {
        const actionCount = session.analysis?.actionPoints?.length || 0;
        if (!isViewingSession) {
          addToast(
            `"${session.title}" is ready` + (actionCount > 0 ? ` — ${actionCount} action item${actionCount !== 1 ? 's' : ''} found` : ''),
            'success',
            { actionLabel: 'View session', onAction: openSession }
          );
        }
        finished.push(id);
        anyCompleted = true;
      } else if (session.status === 'error') {
        const isRetryable = Boolean(session.recoveryId || session.audioPath);
        if (!isViewingSession) {
          addToast(
            `Processing failed for "${session.title}"` + (isRetryable ? ' — tap to retry' : ''),
            'error',
            isRetryable ? { actionLabel: 'View & retry', onAction: openSession } : undefined
          );
        }
        finished.push(id);
      }
    }

    if (finished.length > 0) {
      setProcessingSessionIds(prev => prev.filter(id => !finished.includes(id)));
    }
    // A completed session may have consumed audio-minutes → refresh the
    // usage meter / tier state so the sidebar + gates reflect it.
    if (anyCompleted) subscriptionState.refetch();
  }, [recordings, processingSessionIds, activeRecordingId, addToast, subscriptionState.refetch]);

  const handleEngineChange = (engine: 'gemini' | 'sarvam') => {
    setTranscriptionEngine(engine);
    localStorage.setItem('aligned-engine', engine);
  };

  // Always show the toggle — the key check happens at API call time in sarvamService.ts
  const hasSarvamKey = true;

  useEffect(() => {
    document.body.className = theme === 'light' ? 'light antialiased' : 'antialiased';
    localStorage.setItem('aligned-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  useEffect(() => {
    // Register the auth listener FIRST so we never miss events like
    // PASSWORD_RECOVERY that Supabase fires when it processes URL tokens.
    // Apply a Supabase session user to state, but ONLY when the user id
    // actually changes. Supabase re-emits SIGNED_IN / TOKEN_REFRESHED on token
    // refresh and on tab focus; creating a new `user` object each time would
    // re-run the loadData effect (deps: [user]) mid-recording and let segment
    // recovery mistake the live recording for a crashed one. Returning `prev`
    // for the same id keeps the reference stable so the effect does not re-run.
    // Genuine changes (sign-out → null, switching users → different id) still
    // update state.
    const applySessionUser = (sessionUser: { id: string; email?: string | null; user_metadata?: any }) => {
      setUser(prev => {
        if (prev && prev.id === sessionUser.id) return prev; // same user — no churn
        return {
          id: sessionUser.id,
          email: sessionUser.email || '',
          name: sessionUser.user_metadata?.name || sessionUser.email?.split('@')[0] || 'User',
        };
      });
    };

    const { data: authData } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setShowResetPassword(true);
        return;
      }
      if (session?.user) {
        applySessionUser(session.user);
      } else {
        setUser(null);
        setRecordings([]);
        setActiveRecordingId('home');
        setIsRecordingMode(false);
      }
    });

    const initAuth = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.error('Error getting session:', error);
        } else if (data?.session?.user) {
          applySessionUser(data.session.user);
        }
      } catch (err) {
        console.error('Auth initialization error:', err);
      } finally {
        setIsInitialLoad(false);
      }
    };

    initAuth();

    return () => authData?.subscription?.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      const loadData = async () => {
        console.log('[App] Loading recordings for user:', user.id);
        setRecordingsLoading(true);

        // Fetch recordings and action items in parallel
        const [data, trackedItems] = await Promise.all([
          fetchRecordings(user.id),
          fetchActionItems(user.id),
        ]);
        console.log('[App] Fetched recordings:', data.length, 'recordings');

        // Fix stale processing sessions (interrupted by page close/crash).
        // Track which ones we just flipped so we can try to auto-resume the
        // most recent recoverable one below instead of leaving it as an error.
        //
        // A legitimate long transcription now runs for 10–30+ minutes, so the
        // old "processing for > 5 min → interrupted" check falsely stamped
        // healthy runs (and permanently re-stamped retried sessions, whose
        // `date` never changes). Instead we use a liveness heartbeat: a session
        // is interrupted ONLY if no tab has written a fresh (<90s) heartbeat for
        // it. A hard 24h backstop still catches anything truly stuck.
        const now = Date.now();
        const HARD_BACKSTOP_MS = 24 * 60 * 60 * 1000;
        const interruptedIds = new Set<string>();
        const fixedData = data.map(r => {
          if (r.status === 'processing') {
            const hbFresh = isHeartbeatFresh(r.id, now, HEARTBEAT_STALE_MS);
            const tooOld = (now - r.date) > HARD_BACKSTOP_MS;
            // Fresh heartbeat → another tab (or this one, pre-reload) is genuinely
            // working; leave it in `processing`. Backstop overrides regardless.
            if (tooOld || !hbFresh) {
              clearHeartbeat(r.id);
              interruptedIds.add(r.id);
              return { ...r, status: 'error' as const, errorMessage: 'Processing was interrupted. Tap Retry if audio is still available.', processingStep: undefined };
            }
          }
          return r;
        });
        setRecordings(fixedData);

        // Attach session titles/dates for display
        const itemsWithMeta = trackedItems.map(item => {
          const session = data.find(r => r.id === item.recordingId);
          return session ? { ...item, sessionTitle: session.title, sessionDate: session.date } : item;
        });
        setActionItems(itemsWithMeta);

        // Note: action items are no longer auto-synced from recordings. Users
        // explicitly promote actions to the tracker from the session view via
        // the "Add to tracker" UI in ResultsView. Existing rows in the
        // `action_items` table (synced under the old behavior) are preserved.

        // Housekeeping: drop chunk-transcript caches + segment manifests older than 7 days.
        purgeStaleChunkTranscripts();
        if (USE_SEGMENTED_RECORDING) {
          // Retention (shared rules with the server's audio-retention sweep).
          // "Unclear parts" is judged from the saved transcript, exactly as the
          // server judges it.
          applyLocalRetention(isRecordingLive, async (recoveryId) => {
            const row = data.find(r => r.recoveryId === recoveryId);
            return {
              rowStatus: row ? row.status : null,
              hasProblems: !!row?.analysis?.transcript?.includes(UNCLEAR_MARKER),
            };
          });
          purgeStaleSegmentTranscripts(); // Phase 3 live transcripts
        }

        // Shared guard: auto-resume AT MOST ONE session per load across both the
        // Phase 1 blob path and the Phase 2 segment path.
        let didAutoResume = false;

        // Check for recoverable recordings from crashed/closed sessions
        try {
          const recoverable = await getRecoverableRecordings();

          // ── Auto-resume ────────────────────────────────────────────────
          // If a session we just marked interrupted has a recoverable blob,
          // resume it automatically instead of showing an error. Guard rails:
          // at most one per load (most recent), and at most 2 attempts per
          // recoveryId (sessionStorage counter) to avoid a crash loop.
          let autoResumedRecoveryId: string | null = null;
          const resumeCandidates = fixedData
            .filter(r =>
              interruptedIds.has(r.id) &&
              // Never resume a session another tab is actively working on.
              !isHeartbeatFresh(r.id) &&
              r.recoveryId &&
              recoverable.some(rec => rec.meta.id === r.recoveryId)
            )
            .sort((a, b) => b.date - a.date);

          for (const cand of resumeCandidates) {
            const key = `aligned-autoresume-${cand.recoveryId}`;
            const attempts = parseInt(sessionStorage.getItem(key) || '0', 10);
            if (attempts >= 2) continue; // Crash-loop guard — fall back to manual Retry.
            const rec = recoverable.find(x => x.meta.id === cand.recoveryId);
            if (!rec) continue;

            sessionStorage.setItem(key, String(attempts + 1));
            autoResumedRecoveryId = cand.recoveryId!;
            didAutoResume = true;
            addToast(`Resuming processing for "${cand.title}"…`, 'success');

            const resetSession: RecordingSession = {
              ...cand,
              status: 'processing',
              processingStep: 'transcribing',
              errorMessage: undefined,
              analysis: null,
            };
            setRecordings(prev => prev.map(r => r.id === cand.id ? resetSession : r));
            trackProcessing(cand.id);
            // Fire-and-forget: do not await, so load doesn't block on full processing.
            runProcessingForSession(resetSession, rec.blob);
            break; // At most one auto-resume per load.
          }

          // ── Recovery modal ─────────────────────────────────────────────
          // Show the modal for the newest recoverable entry that is NOT already
          // completed and was NOT auto-resumed (auto-resume supersedes it).
          // Orphaned recordings (no matching session row) still surface here.
          const modalEntry = recoverable.find(rec => {
            if (rec.meta.id === autoResumedRecoveryId) return false; // suppressed
            const sess = data.find(r => r.recoveryId === rec.meta.id);
            if (sess?.status === 'completed') {
              console.log('[App] Recovery entry already completed — clearing silently');
              clearRecoverySession(rec.meta.id);
              return false;
            }
            return true;
          });

          if (modalEntry) {
            const durationStr = modalEntry.meta.duration > 0
              ? `${Math.floor(modalEntry.meta.duration / 60)}m ${modalEntry.meta.duration % 60}s`
              : 'unknown duration';
            const timeAgo = Math.round((Date.now() - modalEntry.meta.startedAt) / 60000);
            const source = (modalEntry.meta.source || 'in-person') as RecordingSource;

            // Show in-app modal instead of window.confirm
            setRecoveryData({
              durationStr,
              timeAgo,
              blob: modalEntry.blob,
              source,
              recoveryId: modalEntry.meta.id,
            });
          }
        } catch (err) {
          console.warn('[App] Recovery check failed:', err);
        }

        // ── Phase 2: resume from uploaded segments ─────────────────────────
        // A segmented recording that crashed mid-meeting leaves a manifest (and
        // cached/uploaded segments) but may have no session row yet. Re-upload
        // any pending segments for durability, then auto-resume at most one
        // incomplete segmented session (sharing the single-resume + 2-attempt
        // guard with the blob path above).
        if (USE_SEGMENTED_RECORDING) {
          try {
            const manifests = await getAllSegmentManifests();
            const activeSegId = getActiveSegmentSessionId();
            const SEVEN_MIN_MS = 7 * 60 * 1000;
            const candidates: SegmentManifest[] = [];
            for (const m of manifests) {
              if (m.segments.length === 0) continue;
              // Never recover the recording in progress in THIS tab.
              if (m.sessionId === activeSegId) continue;
              const sess = data.find(r => r.recoveryId === m.sessionId);
              // Being processed right now (here or in another tab) — leave it.
              if (sess && sess.status === 'processing') continue;
              // A leftover of a COMPLETED recording (completed rows keep their
              // recoveryId): never processed again. Kept only while it still
              // has unclear/failed segments to re-transcribe (the 7-day cleanup
              // removes it after that); otherwise deleted now.
              if (sess && sess.status === 'completed') {
                if ((await isRecordingLive(m.sessionId)) === true) continue;
                const results = await getSegmentResults(m.sessionId);
                const retryable = m.segments.some(s => needsRetry(resultStatus(results[s.index])));
                if (!retryable) {
                  console.log(`[App] Deleting leftover of completed session "${sess.title}" (${m.sessionId}) — never processed`);
                  clearLiveSession(m.sessionId);
                  await deleteSegmentedRecording(m.sessionId, m, {
                    kind: 'automatic', reason: 'completed_leftover', rowStatus: sess.status,
                    hasProblems: retryable || !!sess.analysis?.transcript?.includes(UNCLEAR_MARKER),
                  });
                }
                continue;
              }
              // Still being recorded (or processed) in another tab? The
              // recorder holds a per-recording Web Lock for its whole life and
              // the browser drops it the instant that tab closes. Lock held =
              // live elsewhere = never rescue.
              const live = await isRecordingLive(m.sessionId);
              if (live === true) continue;
              if (live === null) {
                // No Web Locks in this browser: fall back to the heuristics.
                // Phase 3: a live-transcription worker beats under the
                // recoveryId while it works. Fresh beat = live work, not a crash.
                if (isHeartbeatFresh(m.sessionId)) continue;
                // A manifest written in the last 7 minutes is almost certainly
                // still being recorded or mid-handoff.
                if (m.updatedAt && (Date.now() - m.updatedAt) < SEVEN_MIN_MS) continue;
              }
              candidates.push(m);
            }
            candidates.sort((a, b) => b.startedAt - a.startedAt);

            // Durability: re-upload any segment that never reached Storage.
            for (const manifest of candidates) {
              await reuploadPendingSegments(manifest.sessionId).catch(() => {});
            }

            // Never auto-process a leftover that is old or implausibly long
            // (a runaway recorder) — the user decides via Save / Discard.
            const isRunaway = (m: SegmentManifest) =>
              Date.now() - m.startedAt > LEFTOVER_MAX_AGE_HOURS * 3600_000 ||
              m.segments.reduce((s, seg) => s + (seg.durationMs || 0), 0) > STT_SESSION_CEILING_MIN * 60_000;
            const needsDecision: SegmentManifest[] = [];

            for (const manifest of candidates) {
              const existing = fixedData.find(r => r.recoveryId === manifest.sessionId);
              if (isRunaway(manifest)) {
                // A failed session already offers Retry; only orphans need the notice.
                if (!existing) needsDecision.push(manifest);
                console.warn(`[App] Leftover recording ${manifest.sessionId} is old or too long — not auto-processing`);
                continue;
              }
              if (didAutoResume) {
                if (!existing) needsDecision.push(manifest);
                continue;
              }
              const key = `aligned-autoresume-${manifest.sessionId}`;
              const attempts = parseInt(sessionStorage.getItem(key) || '0', 10);
              if (attempts >= 2) { // crash-loop guard
                if (!existing) needsDecision.push(manifest);
                continue;
              }
              // Never resume a session another tab is actively working on.
              if (existing && isHeartbeatFresh(existing.id)) continue;

              sessionStorage.setItem(key, String(attempts + 1));
              didAutoResume = true;
              const time = new Date(manifest.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              addToast(existing
                ? `Resuming processing for "${existing.title}"…`
                : `Saved your unfinished recording from ${time}`, 'success');
              // Fire-and-forget: don't block load on full processing.
              void resumeSegmentedRecordingRef.current(manifest, existing ?? null);
            }

            if (needsDecision.length > 0) setLeftoverRecordings(needsDecision);
          } catch (err) {
            console.warn('[App] Segment recovery failed:', err);
          }
        }

        setRecordingsLoading(false);
      };
      loadData();
    } else {
      setRecordingsLoading(false);
    }
  }, [user]);

  const handleLogout = () => {
    setConfirmRequest({
      title: 'Sign out?',
      message: 'You can sign back in any time from the same email.',
      confirmLabel: 'Sign out',
      cancelLabel: 'Stay',
      // Save a recording in progress before the session goes away.
      onConfirm: async () => {
        if (recordingController.isActive()) await recordingController.finalizeRecording('user_stop');
        supabase.auth.signOut();
      },
    });
  };

  const handleManualEntry = async (data: {
    title: string;
    source: RecordingSource;
    date: number;
    duration: number;
    transcript?: string;
    audioBlob?: Blob;
  }) => {
    if (!user) return;
    // Manual entry creates a new recordings row → counts against the cap.
    // Gate before any persistence work happens.
    if (!checkRecordingAllowed()) return;

    // ── Audio-upload branch ──────────────────────────────────────────────
    // Reuses the same orchestration as a fresh recording, which means the
    // file goes through Storage upload, transcription (with the silent
    // Sarvam fallback for long audio), then analysis. This is also how
    // users can re-process a failed long recording: download the archived
    // audio from Supabase Storage and re-upload it here.
    if (data.audioBlob) {
      const uploadRecoveryId = `upl-${Date.now()}`;
      const audioSession: RecordingSession = {
        id: uuidv4(),
        title: data.title,
        date: data.date,
        duration: data.duration,
        analysis: null,
        status: 'processing',
        source: data.source,
        processingStep: 'transcribing',
        recoveryId: uploadRecoveryId,
      };
      setRecordings(prev => [audioSession, ...prev]);
      setActiveRecordingId(audioSession.id);
      trackProcessing(audioSession.id);
      setIsManualProcessing(true);
      try {
        // ── Segmented upload path ────────────────────────────────────────
        // Cut the file into ~5-minute segments client-side and run the SAME
        // pipeline a live recording uses. Without this a long upload takes the
        // monolithic path: one whole-file PUT (a 813 MB / 3.5h MP3 came back
        // 413 EntityTooLarge) plus a single transcription call over the lot.
        //
        // Only MP3 and WAV can be cut without re-encoding; anything else
        // returns null and falls through to the original path below, which is
        // still fine for the smaller files it can already handle.
        let manifest: SegmentManifest | null = null;
        if (USE_SEGMENTED_RECORDING && data.audioBlob instanceof File) {
          try {
            manifest = await ingestFileAsSegments(
              data.audioBlob,
              uploadRecoveryId,
              data.source,
              (phase, fraction) => {
                setUploadSplit({
                  sessionId: audioSession.id,
                  phase,
                  percent: Math.round(fraction * 100),
                });
              },
            );
          } catch (err: any) {
            // A malformed file that claimed to be MP3/WAV. Fall back rather
            // than fail the import outright — the whole-file path may cope.
            console.warn('[App] Upload split failed, using whole-file path:', err?.message);
          } finally {
            setUploadSplit(null);
          }
        }

        if (manifest && manifest.segments.length > 0) {
          await runSegmentedProcessingForSession(audioSession, manifest);
        } else {
          await runProcessingForSession(audioSession, data.audioBlob);
        }
      } finally {
        setIsManualProcessing(false);
      }
      return;
    }

    // ── Transcript-paste branch (original flow) ─────────────────────────
    if (!data.transcript) {
      console.error('Manual entry: neither transcript nor audioBlob provided');
      return;
    }
    const transcript = data.transcript;
    setIsManualProcessing(true);

    const newSession: RecordingSession = {
      id: uuidv4(),
      title: data.title,
      date: data.date,
      duration: data.duration,
      analysis: null,
      status: 'processing',
      source: data.source,
      processingStep: 'analyzing',
    };

    setRecordings(prev => [newSession, ...prev]);
    setActiveRecordingId(newSession.id);
    trackProcessing(newSession.id);
    // Heartbeat so a reload during analysis isn't stamped "interrupted".
    startHeartbeat(newSession.id);

    const updateSession = (updates: Partial<RecordingSession>) => {
      setRecordings(prev => prev.map(rec =>
        rec.id === newSession.id ? { ...rec, ...updates } : rec
      ));
    };

    // Transcript paste has no STT cost → never counts against audio-hours.
    const NON_BILLABLE = { billable: false } as const;
    try {
      await saveRecording(newSession, user.id, NON_BILLABLE);
      const analysisResult = await analyzeTranscript(transcript, data.date);
      const fullAnalysis = { ...analysisResult, transcript };
      const completedSession: RecordingSession = {
        ...newSession,
        analysis: fullAnalysis,
        status: 'completed',
        processingStep: undefined,
      };
      updateSession({ analysis: fullAnalysis, status: 'completed', processingStep: undefined });
      await saveRecording(completedSession, user.id, NON_BILLABLE);

      // Action items are no longer auto-synced. The user can promote selected
      // actions to the tracker from the session view.
    } catch (err: any) {
      console.error('Manual entry processing failed:', err);
      const errorSession: RecordingSession = { ...newSession, status: 'error', errorMessage: err.message, processingStep: undefined };
      updateSession({ status: 'error', errorMessage: err.message, processingStep: undefined });
      await saveRecording(errorSession, user.id, NON_BILLABLE);
    } finally {
      clearHeartbeat(newSession.id);
      setIsManualProcessing(false);
    }
  };

  const handleStartNew = () => {
    // A recording is already running: "New" just returns to it (a second one
    // can't be started — the controller refuses — and the usage gate is about
    // starting, not returning).
    if (recordingController.isActive()) {
      setActiveRecordingId(null);
      setIsRecordingMode(true);
      return;
    }
    if (!checkRecordingAllowed()) return;
    setActiveRecordingId(null);
    setIsRecordingMode(true);
  };

  const handleGoHome = () => {
    // Navigation never touches a recording in progress — the controller owns it.
    setActiveRecordingId('home');
    setIsRecordingMode(false);
  };

  const handleSelectRecording = (id: string) => {
    if (id === 'home') {
      handleGoHome();
      return;
    }
    setIsRecordingMode(false);
    setActiveRecordingId(id);
  };

  const handleUpdateTitle = async (id: string, newTitle: string) => {
    if (!user) return;
    const sessionToUpdate = recordings.find(r => r.id === id);
    if (!sessionToUpdate) return;

    const updatedSession = { ...sessionToUpdate, title: newTitle };
    setRecordings(prev => prev.map(rec => rec.id === id ? updatedSession : rec));

    try {
      await saveRecording(updatedSession, user.id);
    } catch (e) {
      console.error("Failed to update title in Supabase", e);
    }
  };

  const handleDeleteRecording = (id: string) => {
    if (!user) return;

    setConfirmRequest({
      title: 'Delete this recording?',
      message: 'The session, transcript, notes, and audio archive will be removed. This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      variant: 'destructive',
      onConfirm: async () => {
        const previousRecordings = [...recordings];
        const sessionToDelete = recordings.find(rec => rec.id === id);
        const audioPathToRemove = sessionToDelete?.audioPath;
        const segRecoveryId = sessionToDelete?.recoveryId;

        setRecordings(prev => prev.filter(rec => rec.id !== id));

        if (activeRecordingId === id) {
          handleGoHome();
        }

        setActionItems(prev => prev.filter(i => i.recordingId !== id));

        try {
          await deleteRecordingFromDb(id, user.id);
        } catch (err) {
          setRecordings(previousRecordings);
          addToast('Delete failed — check your connection and try again.', 'error');
          return;
        }

        if (audioPathToRemove) {
          try {
            await deleteAudioPaths([audioPathToRemove]);
          } catch (err: any) {
            console.error('[App] Audio cleanup failed during delete:', err);
            addToast(
              `Session deleted, but the server audio archive could not be removed (${err?.message ?? 'unknown error'}). Please contact support if this keeps happening.`,
              'error',
            );
          }
        }

        // Segmented sessions have multiple files under recordings/{sessionId}/.
        // Completed ones already cleaned up on success (no manifest), so this
        // only fires for failed/interrupted segmented sessions still holding
        // segments. Legacy single-file sessions (audioPath only) are unaffected.
        if (USE_SEGMENTED_RECORDING && segRecoveryId) {
          try {
            // Stop any live worker still holding this session before deleting.
            clearLiveSession(segRecoveryId);
            await deleteSegmentedRecording(segRecoveryId, undefined, { kind: 'user_confirmed', action: 'delete_session' });
          } catch (err: any) {
            console.error('[App] Segment cleanup failed during delete:', err);
          }
        }
      },
    });
  };

  // Shared pipeline: transcribe → analyze → save. Works for both fresh recordings and
  // retries. Caller is responsible for adding/updating the session in `recordings` state
  // and setting it to processing before calling this. On success, clears the IndexedDB
  // recovery entry. On failure, leaves IndexedDB intact so the user can retry again.
  const runProcessingForSession = useCallback(async (session: RecordingSession, blob: Blob) => {
    if (!user) return;

    // Single-pipeline gate: abort any previous run for this session, then start
    // a fresh heartbeat so reconciliation/auto-resume treat it as live.
    const controller = beginPipelineRun(session.id);
    const signal = controller.signal;
    startHeartbeat(session.id);

    // Ignore any state write from a run that has been superseded.
    const updateSession = (updates: Partial<RecordingSession>) => {
      if (signal.aborted) return;
      setRecordings(prev => prev.map(rec =>
        rec.id === session.id ? { ...rec, ...updates } : rec
      ));
    };

    // Recognise the classes of gemini-transcribe-audio failures where
    // retrying via Sarvam is genuinely worth trying:
    //   - Wall-time / worker-limit (546, 504, client-side "timed out")
    //     means Supabase killed the worker — Sarvam's 25s chunks survive
    //     any wall.
    //   - Files API rejection / generateContent failure means Gemini
    //     itself couldn't process the file (unsupported codec, transient
    //     5xx, MIME edge cases). Sarvam decodes locally via the browser's
    //     audio stack, so it handles WEBM/Opus and other containers Gemini
    //     can be picky about.
    // We deliberately do NOT include 4xx semantics-level errors here
    // (empty payload, repetitive output 422) — those mean the input is
    // genuinely bad and Sarvam would also fail. Letting them propagate
    // surfaces the real problem to the user.
    const isGeminiFallbackTrigger = (err: any): boolean => {
      const status = err?.status;
      const message = typeof err?.message === 'string' ? err.message : '';
      if (status === 546 || status === 504) return true;
      if (message.includes('timed out')) return true;
      if (message.includes('Gemini Files API')) return true;
      if (message.includes('Gemini generateContent failed')) return true;
      return false;
    };

    try {
      try {
        await saveRecording(session, user.id);
      } catch (saveErr) {
        console.warn("Initial save failed, continuing with processing:", saveErr);
      }

      // Archive the full audio to Supabase Storage. The Vercel function body
      // limit (4.5 MB) means anything larger than ~3 MB raw can't be sent
      // inline, so we await the upload first and pass the storage path to
      // extractTranscript — it'll mint a signed URL the server fetches from.
      // Small files don't need this and could run in parallel, but waiting
      // sequentially is simpler and adds only the upload latency.
      const ext = (blob.type || 'audio/webm').split(';')[0].split('/')[1] || 'webm';
      const INLINE_BODY_THRESHOLD_BYTES = 3 * 1024 * 1024;
      const needsStorageUrl = blob.size > INLINE_BODY_THRESHOLD_BYTES;

      const persistAudioPath = async (path: string) => {
        updateSession({ audioPath: path });
        try {
          await saveRecording({ ...session, audioPath: path }, user.id);
        } catch (saveErr) {
          console.warn('[App] Failed to persist audioPath:', saveErr);
        }
      };

      // Reuse a previously-archived audio path on retry so we don't re-upload
      // (and don't trip storage's `upsert: false` constraint).
      let archivedAudioPath: string | undefined = session.audioPath;
      // Tracked so the success path can await background uploads before
      // deleting the archive (privacy: delete-on-success).
      let archiveUploadPromise: Promise<string | null> | null = null;
      if (needsStorageUrl && !archivedAudioPath) {
        try {
          archivedAudioPath = await uploadAudioToStorage(blob, `recordings/${session.id}.${ext}`);
          await persistAudioPath(archivedAudioPath);
        } catch (err: any) {
          throw new Error(
            `Audio archive upload failed (required for files over 3 MB): ${err?.message ?? 'unknown'}`
          );
        }
      } else if (!needsStorageUrl && !archivedAudioPath) {
        // Small file: archive in the background, don't block transcription.
        archiveUploadPromise = uploadAudioToStorage(blob, `recordings/${session.id}.${ext}`)
          .then(async (path) => {
            await persistAudioPath(path);
            return path;
          })
          .catch((err) => {
            console.warn('[App] Audio archive upload failed (non-critical):', err?.message);
            return null;
          });
      }

      // Phase 1: Transcription
      let transcript: string;
      // Report Sarvam chunk progress into the processing banner. Session-scoped
      // React state only — nothing is persisted to types.ts or Supabase.
      // Every Sarvam call must carry a recoveryId (server ledger / ceiling key).
      // Legacy sessions retried from their stored audio have none, so key them
      // by session id; their chunk cache ages out with the 7-day purge.
      const sarvamRecoveryId = session.recoveryId ?? `sess-${session.id}`;
      const sarvamOpts = {
        recoveryId: sarvamRecoveryId,
        signal,
        onProgress: (done: number, total: number) => { if (!signal.aborted) setChunkProgress(p => withProgress(p, session.id, { done, total })); },
      };
      if (transcriptionEngine === 'sarvam' && hasSarvamKey) {
        try {
          console.log('[App] Using Sarvam STT → Gemini analysis pipeline');
          transcript = await transcribeAudioWithSarvam(blob, sarvamOpts);
        } catch (sarvamError: any) {
          // A usage-cap 402 is terminal — don't burn a Gemini call on it.
          if (isUsageLimitError(sarvamError)) throw sarvamError;
          console.error('[App] ⚠️ Sarvam STT failed — falling back to Gemini transcription.', sarvamError.message);
          setChunkProgress(p => withProgress(p, session.id, null));
          updateSession({ processingStep: 'transcribing' });
          transcript = await extractTranscript(blob, { audioPath: archivedAudioPath });
        }
      } else {
        // Gemini primary path with a silent Sarvam safety net for long audio.
        // Supabase Edge free tier kills workers at 150s; a 50-min recording
        // routinely exceeds that on the inline-base64 path AND on the Files
        // API path. When that wall is hit we silently retry via Sarvam,
        // which uses 25-second client-side chunks (one short request each)
        // and therefore survives any wall. Other failures (4xx, empty
        // transcript, etc.) propagate to the outer catch and surface as
        // 'Processing failed' so the user knows something real broke.
        try {
          transcript = await extractTranscript(blob, { audioPath: archivedAudioPath });
        } catch (geminiErr: any) {
          if (isGeminiFallbackTrigger(geminiErr) && hasSarvamKey) {
            console.warn(
              '[App] Gemini transcription failed — falling back to Sarvam:',
              geminiErr.message,
            );
            updateSession({ processingStep: 'transcribing' });
            transcript = await transcribeAudioWithSarvam(blob, sarvamOpts);
          } else {
            throw geminiErr;
          }
        }
      }

      // Transcription done — clear the chunk-progress indicator.
      setChunkProgress(p => withProgress(p, session.id, null));

      // Superseded mid-run → stop before writing any transcript/analysis state.
      if (signal.aborted) return;

      // Intermediate update: show transcript immediately
      const partialAnalysis = { transcript, summary: '', actionPoints: [] as string[] };
      const transcribedSession: RecordingSession = {
        ...session,
        analysis: partialAnalysis,
        status: 'processing',
        processingStep: 'analyzing',
      };
      updateSession({ analysis: partialAnalysis, processingStep: 'analyzing' });
      await saveRecording(transcribedSession, user.id);

      // Phase 2: Analysis
      const analysisResult = await analyzeTranscript(transcript, session.date);
      if (signal.aborted) return; // superseded during analysis — don't finalize
      const fullAnalysis = { ...analysisResult, transcript };

      // Name the session after what was actually discussed, e.g.
      //   "Trinergy PD Correction & 6100+ Target Plan_25 Aug 3:30 PM"
      // Returns null — leaving the name alone — when the user has already
      // titled this session, or when the model gave us nothing more useful
      // than the "Recording <date> <time>" fallback it already carries.
      const autoTitle = buildSessionTitle(session.title, fullAnalysis.title, session.date);
      const titlePatch = autoTitle ? { title: autoTitle } : {};

      const completedSession: RecordingSession = {
        ...session,
        ...titlePatch,
        analysis: fullAnalysis,
        status: 'completed',
        processingStep: undefined,
        errorMessage: undefined,
        recoveryId: undefined, // clear from DB row — blob is about to be removed from IndexedDB
      };
      updateSession({ ...titlePatch, analysis: fullAnalysis, status: 'completed', processingStep: undefined, errorMessage: undefined, recoveryId: undefined });
      await saveRecording(completedSession, user.id);

      // Privacy: once notes are safely saved the server audio archive is no
      // longer needed. Delete it to honour the "audio is removed the moment
      // your notes are ready" promise. Background small-file uploads are
      // awaited here so we don't leak audio whose upload finishes after the
      // analysis. Failures are logged but non-fatal — the daily pg_cron
      // sweep catches any orphans.
      if (!archivedAudioPath && archiveUploadPromise) {
        archivedAudioPath = (await archiveUploadPromise) ?? undefined;
      }
      if (archivedAudioPath) {
        try {
          await deleteAudioPaths([archivedAudioPath]);
          updateSession({ audioPath: undefined });
          await saveRecording({ ...completedSession, audioPath: undefined }, user.id);
        } catch (cleanupErr: any) {
          console.error('[App] Server audio cleanup-on-success failed:', cleanupErr);
        }
      }

      // Clear the IndexedDB recovery entry IMMEDIATELY after Supabase save succeeds
      // This prevents the false recovery popup on page reload
      if (session.recoveryId) {
        try {
          clearRecoverySession(session.recoveryId);
          // Also drop any resumable chunk-transcript cache for this recording.
          clearChunkTranscripts(session.recoveryId);
        } catch (clearErr) {
          console.warn('[App] IndexedDB cleanup failed (non-critical):', clearErr);
        }
      }

      // Action items are no longer auto-synced. The user can promote selected
      // actions to the tracker from the session view.
    } catch (err: any) {
      // Superseded by a newer run (Retry / auto-resume) → exit silently without
      // stamping error or touching any session state; the newer run owns it.
      if (signal.aborted) return;
      console.error("Recording process failed:", err);
      // A monthly usage-cap 402 gets a friendly error + upgrade prompt rather
      // than a generic red failure, and never retries.
      // A per-recording STT ceiling refusal is not a billing limit: no upgrade prompt.
      const ceiling = isSessionCeilingError(err);
      const usage = isUsageLimitError(err) && !ceiling;
      const friendlyMsg = ceiling
        ? `This recording exceeds the ${sttCeilingLabel} transcription limit.`
        : usage ? 'Monthly limit reached — upgrade to continue.' : err.message;
      // Keep recoveryId so the user can retry from the IndexedDB blob
      const errorSession: RecordingSession = { ...session, status: 'error', errorMessage: friendlyMsg, processingStep: undefined };
      updateSession({ status: 'error', errorMessage: friendlyMsg, processingStep: undefined });
      try {
        await saveRecording(errorSession, user.id);
      } catch (saveErr) {
        console.error("Failed to save error state:", saveErr);
      }
      if (usage) {
        const t = err.tier as PlanTier;
        const offer: PlanTier[] = t === 'free' ? ['pro', 'max'] : t === 'pro' ? ['max'] : [];
        setUpgradeModal({
          open: true,
          reason: `You've reached your ${minutesToHoursLabel(err.limitMinutes || 0)} of audio this month. Upgrade to keep recording.`,
          offerTiers: offer,
        });
      }
    } finally {
      // Only tear down heartbeat/controller/UI if this run is still the current
      // one — a superseding run has already taken ownership of all three.
      if (endPipelineRun(session.id, controller)) {
        clearHeartbeat(session.id);
        setChunkProgress(p => withProgress(p, session.id, null));
      }
    }
  }, [user, transcriptionEngine, hasSarvamKey, sttCeilingLabel]);

  // ── Segmented cleanup ───────────────────────────────────────────────────
  // IMPORTANT (egress): a completed segmented session must have its whole
  // `recordings/{sessionId}/` prefix deleted from Storage — leaving segments
  // behind is the known Supabase egress-overage source. We also clear the
  // IndexedDB manifest + cached blobs and the per-segment Phase 1 chunk caches.
  const cleanupSegmentedSession = useCallback(async (recoveryId: string, manifest: SegmentManifest, deletion: SegmentDeletion) => {
    try {
      await deleteSegmentedRecording(recoveryId, manifest, deletion);
    } catch (err) {
      console.warn('[App] Segmented cleanup failed (non-critical):', err);
    }
  }, []);

  // Segment-wise pipeline: transcribe each segment in order (each ≤5 min, so
  // decode/chunk is safe), concatenate, then run the SAME analyzeTranscript as
  // today. Reuses Phase 1's resumable Sarvam chunk cache per segment via a
  // stable `${recoveryId}:seg{index}` key so a retry resumes at sub-chunk level.
  const runSegmentedProcessingForSession = useCallback(async (session: RecordingSession, manifest: SegmentManifest) => {
    if (!user) return;
    const recoveryId = session.recoveryId!;

    // Single-pipeline gate + liveness heartbeat (see runProcessingForSession).
    const controller = beginPipelineRun(session.id);
    const signal = controller.signal;
    startHeartbeat(session.id);

    // Phase 3 handoff: the live worker is keyed by `recoveryId`, NOT `session.id`,
    // so beginPipelineRun above does not cancel it. Abort it explicitly and wait
    // for it to unwind before we touch the same per-segment chunk-cache keys.
    // Guarded: a handoff hiccup must never stop the pipeline from running.
    try { await stopLiveTranscription(recoveryId); } catch (e) {
      console.warn('[App] Live-transcription handoff failed (non-critical):', e);
    }
    if (signal.aborted) return;

    const updateSession = (updates: Partial<RecordingSession>) => {
      if (signal.aborted) return;
      setRecordings(prev => prev.map(rec => rec.id === session.id ? { ...rec, ...updates } : rec));
    };

    const finishStartedAt = Date.now();
    try {
      try { await saveRecording(session, user.id); } catch (e) { console.warn('Initial save failed:', e); }

      const segments = [...manifest.segments].sort((a, b) => a.index - b.index);
      // One piece per segment, in order: its text and how it went (see
      // services/segmentTranscript.ts). Stored per segment so a later
      // "Re-transcribe unclear parts" can patch the transcript in place.
      const pieces: SegmentPiece[] = [];
      // Set once the server refuses with `session_ceiling`: this recording has
      // used its whole STT budget, so every remaining segment is skipped (no
      // more Sarvam calls) and the session is saved with what was transcribed.
      let ceilingHit = false;
      let ceilingSkipped = 0;

      // Results already stored for this recording — by the live worker during
      // the meeting, or by an earlier run. Drives both the instrumentation line
      // and the banner's "Finalizing your notes…" copy.
      const stored = await getSegmentResults(recoveryId);
      const preDone = segments.filter(s => stored[s.index] !== undefined).length;
      console.log(`[Pipeline] finish started: ${preDone} of ${segments.length} segments pre-transcribed`);
      setPreTranscribed(p => withProgress(p, session.id, { done: preDone, total: segments.length }));

      for (let i = 0; i < segments.length; i++) {
        if (signal.aborted) return; // superseded — stop before the next segment
        const seg = segments[i];
        setSegmentProgress(p => withProgress(p, session.id, { done: i, total: segments.length }));
        updateSession({ processingStep: 'transcribing' });

        // Phase 3: reuse the result the live worker (or an earlier run) stored.
        const prev = stored[seg.index];
        if (prev !== undefined) {
          const status = resultStatus(prev)!;
          console.log(`[Pipeline] segment ${seg.index}: using stored result (${status})`);
          pieces.push({ seg, text: prev.transcript, status });
          continue;
        }

        if (ceilingHit) {
          console.log(`[Pipeline] segment ${seg.index}: skipped (STT ceiling reached)`);
          ceilingSkipped++;
          pieces.push({ seg, text: null, status: 'skipped' });
          continue;
        }

        try {
          pieces.push(await transcribeSegment(recoveryId, seg, {
            signal,
            onProgress: (done, total) => { if (!signal.aborted) setChunkProgress(p => withProgress(p, session.id, { done, total })); },
          }));
        } catch (e: any) {
          // Superseded by a newer run → exit silently (don't degrade anything).
          if (signal.aborted) return;
          // Recording hit the STT ceiling → keep what we have, skip the rest.
          if (isSessionCeilingError(e)) {
            console.warn(`[Pipeline] segment ${seg.index}: STT ceiling reached — skipping remaining segments`);
            ceilingHit = true;
            ceilingSkipped++;
            pieces.push({ seg, text: null, status: 'skipped' });
            continue;
          }
          // A monthly usage-cap 402 aborts the whole session (not a partial degrade).
          throw e;
        }
        if (signal.aborted) return;
        setChunkProgress(p => withProgress(p, session.id, null));
      }
      setSegmentProgress(p => withProgress(p, session.id, null));

      // Superseded mid-run → stop before writing any transcript/analysis state.
      if (signal.aborted) return;

      // Stitch + trim trailing non-speech (see buildSegmentedTranscript).
      const built = buildSegmentedTranscript(pieces, session.duration, pausesFromManifest(manifest));
      // Duration saved = captured audio up to the last segment with real speech.
      const sessionDuration = built.durationSec;
      if (built.trimmedCount > 0) {
        console.log(
          `[Pipeline] trimmed ${built.trimmedCount} trailing segment(s) with no real speech ` +
          `(duration ${session.duration}s → ${sessionDuration}s)`,
        );
      }
      // Kept segments that are unclear or failed — their audio is kept for a retry.
      const unclearCount = built.problems;
      const fullTranscript = built.transcript;
      const transcriptionMs = Date.now() - finishStartedAt;

      // Ceiling already used up before any segment could be transcribed (e.g. a
      // resumed runaway recording): nothing to analyze, so fail clearly.
      if (ceilingHit && !fullTranscript) {
        throw new Error(`This recording already used its ${sttCeilingLabel} transcription limit, so nothing more could be transcribed.`);
      }

      // Show transcript immediately, then analyze (unchanged path).
      const partialAnalysis = { transcript: fullTranscript, summary: '', actionPoints: [] as string[] };
      updateSession({ analysis: partialAnalysis, processingStep: 'analyzing', duration: sessionDuration });
      await saveRecording({ ...session, duration: sessionDuration, analysis: partialAnalysis, status: 'processing', processingStep: 'analyzing' }, user.id);

      const analysisStartedAt = Date.now();
      // Pause lines go to the analysis as a neutral marker without times.
      const analysisResult = await analyzeTranscript(transcriptForAnalysis(fullTranscript), session.date);
      if (signal.aborted) return; // superseded during analysis — don't finalize
      const analysisMs = Date.now() - analysisStartedAt;
      console.log(
        `[Pipeline] finish complete: transcription ${(transcriptionMs / 1000).toFixed(1)}s, ` +
        `analysis ${(analysisMs / 1000).toFixed(1)}s, total ${((Date.now() - finishStartedAt) / 1000).toFixed(1)}s`,
      );
      const fullAnalysis = { ...analysisResult, transcript: fullTranscript };

      // Name the session after what was discussed, exactly as the monolithic
      // pipeline does. Segmentation is the default path for in-app recordings
      // and split uploads, so without this the auto-name rarely reached a session.
      const autoTitle = buildSessionTitle(session.title, fullAnalysis.title, session.date);
      const titlePatch = autoTitle ? { title: autoTitle } : {};

      const completedSession: RecordingSession = {
        ...session,
        ...titlePatch,
        duration: sessionDuration,
        analysis: fullAnalysis,
        status: 'completed',
        processingStep: undefined,
        errorMessage: undefined,
        // KEPT on completed segmented sessions (no longer cleared): it is the
        // durable link from this row to its recording, so a leftover of a
        // completed recording is recognised and deleted on load — never
        // processed again — and unclear parts can be re-transcribed.
        recoveryId,
        audioPath: undefined,
      };
      updateSession({ ...titlePatch, duration: sessionDuration, analysis: fullAnalysis, status: 'completed', processingStep: undefined, errorMessage: undefined, recoveryId });
      await saveRecording(completedSession, user.id);

      if (unclearCount > 0) {
        addToast(`Processing complete — ${unclearCount} of ${segments.length} segment${segments.length !== 1 ? 's' : ''} couldn't be transcribed. Open the session to re-transcribe ${unclearCount !== 1 ? 'them' : 'it'}.`, 'error');
      }
      if (ceilingHit) {
        console.warn(`[Pipeline] STT ceiling: ${ceilingSkipped} of ${segments.length} segments not transcribed`);
        // The recorder already announced it when it auto-stopped; otherwise
        // (e.g. a resumed or retried recording) say so here.
        if (!ceilingNotifiedRef.current.has(recoveryId)) {
          addToast(`This recording reached the ${sttCeilingLabel} transcription limit — audio after that point wasn't transcribed.`, 'info');
        }
        ceilingNotifiedRef.current.delete(recoveryId);
      }

      // Delete-on-success: remove segments from Storage + clear local state —
      // unless some segments are unclear or failed. Then the audio is kept
      // (7-day cleanup) so "Re-transcribe unclear parts" can re-send just those.
      if (unclearCount > 0) {
        console.log(`[Pipeline] keeping audio for ${unclearCount} unclear/failed segment(s) of ${recoveryId} for re-transcription`);
      } else {
        await cleanupSegmentedSession(recoveryId, manifest, {
          kind: 'automatic', reason: 'completed_clean', rowStatus: completedSession.status, hasProblems: false,
        });
      }
    } catch (err: any) {
      // Superseded by a newer run → exit silently; the newer run owns the session.
      if (signal.aborted) return;
      console.error('Segmented processing failed:', err);
      const usage = isUsageLimitError(err);
      const friendlyMsg = usage ? 'Monthly limit reached — upgrade to continue.' : err.message;
      updateSession({ status: 'error', errorMessage: friendlyMsg, processingStep: undefined });
      try {
        await saveRecording({ ...session, status: 'error', errorMessage: friendlyMsg, processingStep: undefined }, user.id);
      } catch (saveErr) {
        console.error('Failed to save error state:', saveErr);
      }
      if (usage) {
        const t = err.tier as PlanTier;
        const offer: PlanTier[] = t === 'free' ? ['pro', 'max'] : t === 'pro' ? ['max'] : [];
        setUpgradeModal({
          open: true,
          reason: `You've reached your ${minutesToHoursLabel(err.limitMinutes || 0)} of audio this month. Upgrade to keep recording.`,
          offerTiers: offer,
        });
      }
    } finally {
      // Only tear down if this run is still current (a superseding run may own it).
      if (endPipelineRun(session.id, controller)) {
        clearHeartbeat(session.id);
        setChunkProgress(p => withProgress(p, session.id, null));
        setSegmentProgress(p => withProgress(p, session.id, null));
        setPreTranscribed(p => withProgress(p, session.id, null));
      }
    }
  }, [user, addToast, cleanupSegmentedSession, sttCeilingLabel]);

  const handleRecordingComplete = useCallback(async (audioData: AudioRecording) => {
    if (!user) return;

    const newSession: RecordingSession = {
      id: uuidv4(),
      title: `Recording ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      date: Date.now(),
      duration: audioData.duration,
      analysis: null,
      status: 'processing',
      source: audioData.source,
      processingStep: 'transcribing',
      recoveryId: audioData.recoveryId,
    };

    setRecordings(prev => [newSession, ...prev]);
    setActiveRecordingId(newSession.id);
    setIsRecordingMode(false);
    // The recorder is done — processing runs in the background and never owns
    // appState, so a new recording can start while this one is summarized.
    setAppState(AppState.IDLE);
    trackProcessing(newSession.id);

    // Segmented handoff: if this recording produced a segment manifest, process
    // it segment-by-segment. The recovery-modal recover path (real blob, no
    // manifest) and manual uploads fall through to the monolithic pipeline.
    if (USE_SEGMENTED_RECORDING && audioData.recoveryId) {
      const manifest = await getSegmentManifest(audioData.recoveryId);
      if (manifest && manifest.segments.length > 0) {
        await runSegmentedProcessingForSession(newSession, manifest);
        return;
      }
      if (manifest && manifest.segments.length === 0) {
        setRecordings(prev => prev.map(r => r.id === newSession.id
          ? { ...r, status: 'error', errorMessage: 'Recording captured no audio. Please try again.', processingStep: undefined }
          : r));
        return;
      }
    }

    await runProcessingForSession(newSession, audioData.blob);
  }, [user, runProcessingForSession, runSegmentedProcessingForSession]);

  // ─── Recording controller → processing handoff ────────────────────────────
  // The app-level controller (services/recordingController.ts) owns the whole
  // recording; every way it ends lands here and becomes a saved session via
  // the existing handleRecordingComplete path. Refs keep the one-time
  // registration pointed at the latest callbacks.
  const recordingHandoffRef = useRef<(r: RecordingResult) => void>(() => {});
  recordingHandoffRef.current = (r: RecordingResult) => {
    if (r.reason === 'session_ceiling') ceilingNotifiedRef.current.add(r.recoveryId);
    const notice = finalizeNotice(r.reason);
    if (notice) addToast(notice, 'info');
    // The per-recording lock is held until processing is done, so no other
    // tab can "rescue" this recording while it is being saved here.
    handleRecordingComplete({ blob: new Blob([]), url: '', duration: r.durationSec, source: r.source as RecordingSource, recoveryId: r.recoveryId })
      .catch((err) => console.error('[App] Processing the finished recording failed:', err))
      .finally(() => r.releaseRecordingLock());
  };
  const recordingWarningRef = useRef<(kind: 'session_ceiling' | 'tier_cap', minsLeft: number) => void>(() => {});
  recordingWarningRef.current = (kind, minsLeft) => {
    const mins = `${minsLeft} minute${minsLeft !== 1 ? 's' : ''}`;
    if (kind === 'tier_cap') {
      addToast(`Free sessions are capped at 90 minutes — ${mins} left. Recording will stop and be saved.`, 'error');
    } else {
      addToast(`Recordings are limited to ${sttCeilingLabel.replace('-', ' ')}s — ${mins} left. It will stop and be saved.`, 'info');
    }
  };
  useEffect(() => recordingController.setHandlers({
    onFinalized: (r) => recordingHandoffRef.current(r),
    onWarning: (kind, minsLeft) => recordingWarningRef.current(kind, minsLeft),
  }), []);

  // Process an unfinished recording's manifest into a saved session (auto
  // "rescue" on load, or Save on the leftover notice). Claims the recording's
  // Web Lock first: if another tab holds it, it is live or already being
  // processed there, so this tab never touches it.
  resumeSegmentedRecordingRef.current = async (manifest: SegmentManifest, existing: RecordingSession | null) => {
    // Completed rows keep their recoveryId — never resume one.
    if (existing?.status === 'completed') return;
    const release = await claimRecording(manifest.sessionId);
    if (!release) {
      console.log(`[App] ${manifest.sessionId} is live in another tab — not rescuing`);
      return;
    }
    try {
      const durationMs = manifest.segments.reduce((s, seg) => s + (seg.durationMs || 0), 0);
      const resumeSession: RecordingSession = existing
        ? { ...existing, status: 'processing', processingStep: 'transcribing', errorMessage: undefined, analysis: null }
        : {
            id: uuidv4(),
            title: `Recording ${new Date(manifest.startedAt).toLocaleDateString()} ${new Date(manifest.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
            date: manifest.startedAt,
            duration: Math.round(durationMs / 1000),
            analysis: null,
            status: 'processing',
            source: (manifest.source || 'in-person') as RecordingSource,
            processingStep: 'transcribing',
            recoveryId: manifest.sessionId,
          };
      setRecordings(prev => existing
        ? prev.map(r => r.id === resumeSession.id ? resumeSession : r)
        : [resumeSession, ...prev]);
      trackProcessing(resumeSession.id);
      await runSegmentedProcessingForSession(resumeSession, manifest);
    } finally {
      release();
    }
  };

  // ─── Re-transcribe unclear parts ──────────────────────────────────────────
  // A completed session whose recording had unclear / failed segments keeps
  // that audio for 7 days. This re-sends ONLY those segments, patches the
  // transcript in place from the stored per-segment results, re-runs the
  // analysis and, once nothing is left to fix, deletes the audio. The session
  // stays 'completed' throughout, so an interruption changes nothing saved.
  const [retranscribeInfo, setRetranscribeInfo] = useState<{ sessionId: string; problems: number; total: number; deleteInDays: number | null } | null>(null);
  const [retranscribeProgress, setRetranscribeProgress] = useState<{ sessionId: string; done: number; total: number } | null>(null);

  const refreshRetranscribeInfo = useCallback(async (session: RecordingSession | undefined) => {
    if (!session || session.status !== 'completed' || !session.recoveryId) { setRetranscribeInfo(null); return; }
    const manifest = await getSegmentManifest(session.recoveryId);
    if (!manifest) { setRetranscribeInfo(null); return; } // audio not on this device
    const results = await getSegmentResults(session.recoveryId);
    const problems = manifest.segments.filter(s => needsRetry(resultStatus(results[s.index]))).length;
    if (problems === 0) { setRetranscribeInfo(null); return; }
    // Countdown from the SHARED retention rules, anchored on the newest Storage
    // object — the same anchor the server sweep deletes on.
    const folder = await getRecordingFolderInfo(session.recoveryId);
    const verdict = folder?.lastUploadMs
      ? segmentedAudioRetention({ rowStatus: 'completed', hasUnclearParts: true, lastUploadMs: folder.lastUploadMs, nowMs: Date.now() })
      : null;
    const deleteInDays = retentionWarningDaysLeft(verdict?.deleteAtMs, Date.now());
    setRetranscribeInfo({ sessionId: session.id, problems, total: manifest.segments.length, deleteInDays });
  }, []);

  const activeSessionForBanner = recordings.find(r => r.id === activeRecordingId);
  useEffect(() => {
    void refreshRetranscribeInfo(activeSessionForBanner);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionForBanner?.id, activeSessionForBanner?.status, activeSessionForBanner?.recoveryId, refreshRetranscribeInfo]);

  // Failed / interrupted sessions: the server sweep deletes their audio 30
  // days after the last upload. Warn in the last RETENTION_WARNING_DAYS.
  const [failedAudioNotice, setFailedAudioNotice] = useState<{ sessionId: string; daysLeft: number } | null>(null);
  useEffect(() => {
    const s = activeSessionForBanner;
    setFailedAudioNotice(null);
    if (!s || !s.recoveryId || (s.status !== 'error' && (s.status as string) !== 'interrupted')) return;
    let cancelled = false;
    void (async () => {
      const folder = await getRecordingFolderInfo(s.recoveryId!);
      if (cancelled || !folder?.lastUploadMs) return;
      const verdict = segmentedAudioRetention({ rowStatus: s.status, hasUnclearParts: false, lastUploadMs: folder.lastUploadMs, nowMs: Date.now() });
      const daysLeft = retentionWarningDaysLeft(verdict.deleteAtMs, Date.now());
      if (daysLeft !== null) setFailedAudioNotice({ sessionId: s.id, daysLeft });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionForBanner?.id, activeSessionForBanner?.status, activeSessionForBanner?.recoveryId]);

  const handleRetranscribeUnclear = async (session: RecordingSession) => {
    if (!user || !session.recoveryId || retranscribeProgress) return;
    const recoveryId = session.recoveryId;
    const manifest = await getSegmentManifest(recoveryId);
    if (!manifest) { addToast('The audio for this recording is no longer on this device.', 'error'); return; }
    const release = await claimRecording(recoveryId);
    if (!release) { addToast('This recording is busy in another tab.', 'error'); return; }
    try {
      const segments = [...manifest.segments].sort((a, b) => a.index - b.index);
      const before = await getSegmentResults(recoveryId);
      const targets = segments.filter(s => needsRetry(resultStatus(before[s.index])));
      console.log(`[Pipeline] re-transcribing ${targets.length} unclear/failed segment(s) of ${recoveryId}`);
      setRetranscribeProgress({ sessionId: session.id, done: 0, total: targets.length });
      for (let i = 0; i < targets.length; i++) {
        try {
          const piece = await transcribeSegment(recoveryId, targets[i]);
          console.log(`[Pipeline] re-transcribed segment ${targets[i].index}: ${piece.status}`);
        } catch (e: any) {
          // Usage refusal (ceiling / monthly): stop; what's done is stored.
          console.warn(`[Pipeline] re-transcription stopped: ${e?.message ?? e}`);
          break;
        }
        setRetranscribeProgress({ sessionId: session.id, done: i + 1, total: targets.length });
      }

      // Patch the transcript in place from ALL stored per-segment results.
      const after = await getSegmentResults(recoveryId);
      const pieces: SegmentPiece[] = segments.map(seg => {
        const r = after[seg.index];
        return r ? { seg, text: r.transcript, status: resultStatus(r)! } : { seg, text: null, status: 'skipped' as const };
      });
      const built = buildSegmentedTranscript(pieces, session.duration, pausesFromManifest(manifest));
      const analysisResult = await analyzeTranscript(transcriptForAnalysis(built.transcript), session.date);
      const updated: RecordingSession = {
        ...session,
        duration: built.durationSec,
        analysis: { ...analysisResult, transcript: built.transcript },
      };
      setRecordings(prev => prev.map(r => r.id === session.id ? updated : r));
      await saveRecording(updated, user.id);

      if (built.problems === 0) {
        addToast('All parts of the recording are now transcribed.', 'success');
        await cleanupSegmentedSession(recoveryId, manifest, {
          kind: 'automatic', reason: 'retranscribed_clean', rowStatus: updated.status, hasProblems: built.problems > 0,
        });
      } else {
        addToast(`${built.problems} part${built.problems !== 1 ? 's' : ''} still couldn't be transcribed. The audio is kept so you can try again later.`, 'error');
      }
    } catch (err: any) {
      console.error('[App] Re-transcription failed:', err);
      addToast(`Re-transcription failed: ${err?.message ?? 'unknown error'}`, 'error');
    } finally {
      release();
      setRetranscribeProgress(null);
      void refreshRetranscribeInfo(recordings.find(r => r.id === session.id) ?? session);
    }
  };

  const handleLeftoverSave = (manifest: SegmentManifest) => {
    setLeftoverRecordings(prev => prev.filter(m => m.sessionId !== manifest.sessionId));
    const existing = recordings.find(r => r.recoveryId === manifest.sessionId) ?? null;
    // A completed recording is never re-processed (see loadData).
    if (existing?.status === 'completed') return;
    void resumeSegmentedRecordingRef.current(manifest, existing);
  };

  const handleLeftoverDiscard = (manifest: SegmentManifest) => {
    setConfirmRequest({
      title: 'Discard this recording?',
      message: 'Its audio will be permanently deleted. This cannot be undone.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep',
      variant: 'destructive',
      onConfirm: async () => {
        setLeftoverRecordings(prev => prev.filter(m => m.sessionId !== manifest.sessionId));
        clearLiveSession(manifest.sessionId);
        await deleteSegmentedRecording(manifest.sessionId, manifest, { kind: 'user_confirmed', action: 'discard_leftover' });
      },
    });
  };

  // Tap the recording indicator → back to the recorder screen (never blocked
  // by the usage gate: this is returning to a recording, not starting one).
  const openRecorder = () => {
    setActiveRecordingId(null);
    setIsRecordingMode(true);
  };
  // Recorder prompt while the user is elsewhere → notification; click returns here.
  usePromptAlert(openRecorder);

  const handleDiscardRecording = () => {
    setConfirmRequest({
      title: 'Discard this recording?',
      message: 'The audio recorded so far will be permanently deleted and no session will be saved. This cannot be undone.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep recording',
      variant: 'destructive',
      onConfirm: () => { void recordingController.discard(); },
    });
  };

  const handleRetryProcessing = useCallback(async (sessionId: string) => {
    if (!user) return;
    const session = recordings.find(r => r.id === sessionId);
    if (!session) return;
    // Completed rows keep their recoveryId; they are never re-processed
    // (unclear parts use "Re-transcribe unclear parts" instead).
    if (session.status === 'completed') return;

    // Segmented retry: resume from the manifest/segments (and Phase 1's
    // sub-chunk cache per segment), not from a single blob. Re-upload any
    // still-pending segments first for durability.
    if (USE_SEGMENTED_RECORDING && session.recoveryId) {
      const manifest = await getSegmentManifest(session.recoveryId);
      if (manifest && manifest.segments.length > 0) {
        await reuploadPendingSegments(session.recoveryId).catch(() => {});
        const resetSession: RecordingSession = {
          ...session,
          status: 'processing',
          processingStep: 'transcribing',
          errorMessage: undefined,
          analysis: null,
        };
        setRecordings(prev => prev.map(r => r.id === sessionId ? resetSession : r));
        setActiveRecordingId(sessionId);
        trackProcessing(sessionId);
        await runSegmentedProcessingForSession(resetSession, manifest);
        return;
      }
    }

    // IndexedDB is fastest (available right after a failed recording on the
    // same browser). If that's gone, fall back to the server audio archive so
    // Retry works after a reload, on another device, or after IndexedDB has
    // been evicted. Silent fallback per design — the button behaves the same.
    let blob: Blob | null = null;
    if (session.recoveryId) {
      const recoverable = await getRecoverableRecordings();
      const match = recoverable.find(r => r.meta.id === session.recoveryId);
      if (match) blob = match.blob;
    }
    if (!blob && session.audioPath) {
      try {
        blob = await downloadAudioFromStorage(session.audioPath);
      } catch (err: any) {
        console.error('[App] Retry: server audio download failed:', err);
      }
    }
    if (!blob) {
      addToast('The recorded audio is no longer available. Retry is not possible.', 'error');
      return;
    }

    // Reset the session to a processing state so the UI shows the spinner again
    const resetSession: RecordingSession = {
      ...session,
      status: 'processing',
      processingStep: 'transcribing',
      errorMessage: undefined,
      analysis: null,
    };
    setRecordings(prev => prev.map(r => r.id === sessionId ? resetSession : r));
    setActiveRecordingId(sessionId);
    trackProcessing(sessionId);

    await runProcessingForSession(resetSession, blob);
  }, [user, recordings, runProcessingForSession, runSegmentedProcessingForSession]);

  // Trigger a browser save dialog for a Blob.
  const triggerBlobDownload = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a short delay so the download has time to start.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  // Download the archived audio for a failed session so the user can keep it
  // (and, via Manual Entry re-upload, rescue an unprocessable recording).
  //
  //  - Legacy single-file sessions (audioPath): download the one blob as-is.
  //  - Segmented sessions (recoveryId + manifest): each segment is an
  //    independent container, so we gather every segment — IndexedDB cache
  //    first, then a signed-URL download from Storage — and bundle them into a
  //    single .zip WITHOUT concatenating (naive concat produces broken files).
  const handleDownloadAudio = useCallback(async (sessionId: string) => {
    if (!user) return;
    const session = recordings.find(r => r.id === sessionId);
    if (!session) return;

    const safeTitle = (session.title || 'recording').replace(/[^\w\-]+/g, '_').slice(0, 60);

    // ── Segmented path ────────────────────────────────────────────────────
    if (USE_SEGMENTED_RECORDING && session.recoveryId) {
      let manifest: SegmentManifest | null = null;
      try {
        manifest = await getSegmentManifest(session.recoveryId);
      } catch { /* fall through to legacy path below */ }

      if (manifest && manifest.segments.length > 0) {
        const segments = [...manifest.segments].sort((a, b) => a.index - b.index);
        const zip = new JSZip();
        let gathered = 0;
        let missing = 0;
        setAudioDownload({ sessionId, done: 0, total: segments.length });
        try {
          for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            let blob = await getSegmentBlob(session.recoveryId, seg.index).catch(() => null);
            if (!blob && seg.storagePath) {
              try { blob = await downloadAudioFromStorage(seg.storagePath); } catch (e: any) {
                console.error(`[App] Download: segment ${seg.index} fetch failed:`, e?.message);
              }
            }
            if (blob) {
              const ext = seg.ext || 'webm';
              zip.file(`seg-${String(seg.index).padStart(4, '0')}.${ext}`, blob);
              gathered++;
            } else {
              missing++;
            }
            setAudioDownload({ sessionId, done: i + 1, total: segments.length });
          }

          if (gathered === 0) {
            addToast('The recorded audio is no longer available for this session.', 'error');
            return;
          }
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          triggerBlobDownload(zipBlob, `${safeTitle}.zip`);
          if (missing > 0) {
            addToast(`Downloaded ${gathered} of ${segments.length} segments — ${missing} could not be retrieved.`, 'error');
          }
        } catch (err: any) {
          console.error('[App] Segmented audio download failed:', err);
          addToast(`Audio download failed: ${err?.message ?? 'unknown error'}`, 'error');
        } finally {
          setAudioDownload(null);
        }
        return;
      }
    }

    // ── Legacy single-file path ───────────────────────────────────────────
    if (session.audioPath) {
      try {
        const blob = await downloadAudioFromStorage(session.audioPath);
        const ext = (blob.type || 'audio/webm').split(';')[0].split('/')[1] || 'webm';
        triggerBlobDownload(blob, `${safeTitle}.${ext}`);
      } catch (err: any) {
        console.error('[App] Audio download failed:', err);
        addToast(`Audio download failed: ${err?.message ?? 'unknown error'}`, 'error');
      }
      return;
    }

    addToast('No audio archive available for this session.', 'error');
  }, [user, recordings, addToast, triggerBlobDownload]);

  // ─── Recovery modal handlers ──────────────────────────────────────────────
  const handleRecoverRecording = useCallback(() => {
    if (!recoveryData) return;
    handleRecordingComplete({
      blob: recoveryData.blob,
      url: URL.createObjectURL(recoveryData.blob),
      duration: 0,
      source: recoveryData.source,
      recoveryId: recoveryData.recoveryId,
    });
    setRecoveryData(null);
  }, [recoveryData, handleRecordingComplete]);

  const handleDiscardRecovery = useCallback(() => {
    clearAllRecovery();
    clearAllChunkTranscripts();
    clearAllSegmentTranscripts(); // Phase 3 live transcripts
    setRecoveryData(null);
  }, []);

  // OAuth 2.1 consent screen (Claude connecting to the Aligned MCP server).
  // Supabase bounces the user here at /oauth/consent?authorization_id=… — this
  // owns its own auth/consent flow, so short-circuit the rest of the app.
  if (typeof window !== 'undefined' && window.location.pathname === '/oauth/consent') {
    return <OAuthConsent />;
  }

  // Loading State
  if (isInitialLoad) return (
    <div className="h-screen w-screen flex items-center justify-center bg-[var(--surface-950)]">
      <div className="relative">
        <div className="w-12 h-12 rounded-full border-4 border-white/10"></div>
        <div className="absolute inset-0 w-12 h-12 rounded-full border-4 border-t-amber-500 border-r-transparent border-b-transparent border-l-transparent animate-spin"></div>
      </div>
    </div>
  );

  // Show Reset Password page when PASSWORD_RECOVERY event is detected
  if (showResetPassword) {
    return (
      <ResetPassword
        onComplete={() => {
          setShowResetPassword(false);
          window.history.replaceState(null, '', '/');
        }}
      />
    );
  }

  // Show Landing Page or Auth View if not logged in
  if (!user) {
    if (!showAuthView) {
      return <LandingPage onGetStarted={() => setShowAuthView(true)} />;
    }
    return <AuthView onLogin={() => { }} />;
  }

  const activeSession = recordings.find(r => r.id === activeRecordingId);

  return (
    <div className="h-screen bg-[var(--surface-950)] flex overflow-hidden animate-fade-in">
      {/* Desktop Sidebar - always visible on md+ */}
      <div className="hidden md:flex flex-col w-80 h-full shrink-0 z-20">
        <Sidebar
          user={user}
          recordings={recordings}
          activeId={activeRecordingId}
          onSelect={handleSelectRecording}
          onNew={handleStartNew}
          onDelete={handleDeleteRecording}
          onLogout={handleLogout}
          theme={theme}
          onToggleTheme={toggleTheme}
          actionItems={actionItems}
          usage={subscriptionState}
          onUpgrade={() => setUpgradeModal({ open: true })}
          recordingIndicator={<RecordingIndicator variant="sidebar" onOpen={openRecorder} />}
        />
      </div>

      {/* Mobile Sidebar Overlay */}
      <div className={`md:hidden fixed inset-0 z-50 transition-all duration-300 ${sidebarOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
        <div
          className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${sidebarOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setSidebarOpen(false)}
        />
        <div className={`absolute left-0 top-0 bottom-0 w-[85vw] max-w-sm transition-transform duration-300 ease-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <Sidebar
            user={user}
            recordings={recordings}
            activeId={activeRecordingId}
            onSelect={(id) => { handleSelectRecording(id); setSidebarOpen(false); }}
            onNew={() => { handleStartNew(); setSidebarOpen(false); }}
            onDelete={handleDeleteRecording}
            onLogout={handleLogout}
            theme={theme}
            onToggleTheme={toggleTheme}
            onClose={() => setSidebarOpen(false)}
            actionItems={actionItems}
            usage={subscriptionState}
            onUpgrade={() => { setSidebarOpen(false); setUpgradeModal({ open: true }); }}
            recordingIndicator={<RecordingIndicator variant="sidebar" onOpen={() => { openRecorder(); setSidebarOpen(false); }} />}
          />
        </div>
      </div>

      {/* Main Content - always visible */}
      <main className="flex flex-1 flex-col h-full overflow-hidden bg-[var(--surface-950)] z-10 w-full md:border-l md:border-white/[0.04]">
        <header className="h-14 md:h-16 border-b border-white/[0.06] flex items-center px-4 md:px-8 justify-between bg-[var(--surface-900)]/50 backdrop-blur-xl shrink-0">
            <div className="flex items-center space-x-3">
              {/* Mobile back button - only when viewing a specific session */}
              {activeSession && (
                <button
                  onClick={handleGoHome}
                  className="md:hidden p-2.5 -ml-1 text-[var(--text-muted)] hover:bg-white/5 rounded-xl transition-colors active:scale-95"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}

              {/* Logo */}
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-amber-500 rounded-lg shadow-lg flex items-center justify-center text-black font-bold text-sm">
                  A
                </div>
                <h1 className="font-display-tight text-lg md:text-xl font-semibold text-[var(--text-primary)]">Aligned</h1>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Badge */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg glass text-xs font-semibold text-[var(--text-tertiary)]">
                <span className={`w-1.5 h-1.5 rounded-full ${transcriptionEngine === 'sarvam' ? 'bg-amber-400' : 'bg-teal-400'}`}></span>
                <span className="hidden sm:inline">{transcriptionEngine === 'sarvam' ? 'Sarvam + Gemini' : 'Gemini 2.5'}</span>
                <span className="sm:hidden">{transcriptionEngine === 'sarvam' ? 'Sarvam' : 'AI'}</span>
              </div>
              {/* Mobile hamburger menu */}
              <button
                onClick={() => setSidebarOpen(prev => !prev)}
                className="md:hidden p-2.5 rounded-xl glass glass-hover active:scale-95 transition-all"
              >
                <svg className="w-5 h-5 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
              </button>
            </div>
          </header>

        {/* Mobile: persistent recording bar on every screen (desktop shows it in the sidebar) */}
        <RecordingIndicator variant="bar" onOpen={openRecorder} />

        <div className="flex-1 overflow-hidden relative pb-16 md:pb-0">
          {/* Processing Banner — visible on all views when a session is processing */}
          {processingSessionIds.map(id => {
            if (id === activeRecordingId) return null;
            const ps = recordings.find(r => r.id === id);
            return ps && ps.status === 'processing' ? (
              <ProcessingBanner
                key={id}
                session={ps}
                progress={chunkProgress[id] ?? null}
                segmentProgress={segmentProgress[id] ?? null}
                preTranscribed={preTranscribed[id] ?? null}
                onTap={() => {
                  setIsRecordingMode(false);
                  setActiveRecordingId(id);
                }}
              />
            ) : null;
          })}
          {/* Failed / interrupted session whose audio the retention sweep will delete soon */}
          {activeSession && failedAudioNotice?.sessionId === activeSession.id && (
            <AudioRetentionNotice daysLeft={failedAudioNotice.daysLeft} />
          )}
          {/* Completed session with unclear / failed parts: re-send just those */}
          {activeSession && retranscribeInfo?.sessionId === activeSession.id && (
            <RetranscribeBanner
              problems={retranscribeInfo.problems}
              total={retranscribeInfo.total}
              deleteInDays={retranscribeInfo.deleteInDays}
              progress={retranscribeProgress?.sessionId === activeSession.id ? retranscribeProgress : null}
              onRetranscribe={() => void handleRetranscribeUnclear(activeSession)}
            />
          )}
          {activeRecordingId === 'home' ? (
            <HomeView
              user={user}
              recordings={recordings}
              actionItems={actionItems}
              isLoading={recordingsLoading}
              onSelectSession={handleSelectRecording}
              onStartNew={handleStartNew}
              usage={BILLING_ENABLED ? subscriptionState : undefined}
              onUpgrade={() => setUpgradeModal({ open: true })}
            />
          ) : activeRecordingId === 'sessions' || activeRecordingId === 'dictations' ? (
            <SessionsLogView
              sessions={recordings}
              isLoading={recordingsLoading}
              onSelect={handleSelectRecording}
              onDelete={handleDeleteRecording}
              onRetry={handleRetryProcessing}
              onDownloadAudio={handleDownloadAudio}
              downloadState={audioDownload}
            />
          ) : activeRecordingId === 'actions' ? (
            <ActionItemsView
              recordings={recordings}
              actionItems={actionItems}
              onActionItemsChange={setActionItems}
              userId={user.id}
              userName={user.name}
              onSelectSession={handleSelectRecording}
            />
          ) : activeRecordingId === 'manual-entry' ? (
            <ManualEntryView
              onSubmit={handleManualEntry}
              onCancel={handleGoHome}
              isProcessing={isManualProcessing}
              progressLabel={
                uploadSplit
                  ? uploadSplit.phase === 'splitting'
                    ? `Splitting audio… ${uploadSplit.percent}%`
                    : uploadSplit.phase === 'saving'
                      ? `Preparing segments… ${uploadSplit.percent}%`
                      : 'Uploading segments…'
                  : null
              }
            />
          ) : activeRecordingId === 'settings' ? (
            <SettingsView
              user={user}
              theme={theme}
              onToggleTheme={toggleTheme}
              transcriptionEngine={transcriptionEngine}
              onEngineChange={handleEngineChange}
              hasSarvamKey={hasSarvamKey}
              onLogout={handleLogout}
            />
          ) : BILLING_ENABLED && (activeRecordingId === 'billing' || activeRecordingId === 'pricing') ? (
            <div className="h-full overflow-y-auto">
              <div className="max-w-3xl mx-auto px-6 md:px-12 pt-8">
                <BillingSection
                  state={subscriptionState}
                  onUpgradeClick={() => setUpgradeModal({ open: true })}
                  onCancelled={() => addToast('Subscription will end at the close of your billing period.', 'success')}
                />
              </div>
              <PricingView user={user} variant="page" />
            </div>
          ) : activeRecordingId === 'intelligence' || activeRecordingId === 'strategist' || activeRecordingId === 'chatbot' ? (
            <IntelligenceView
              recordings={recordings}
              userId={user?.id || ''}
              messages={chatMessages}
              onMessagesChange={setChatMessages}
            />
          ) : activeSession ? (
            <ResultsView
              session={activeSession}
              onUpdateTitle={handleUpdateTitle}
              userId={user?.id}
              actionItems={actionItems}
              onActionItemsAdded={(newItems) => setActionItems(prev => [...prev, ...newItems])}
            />
          ) : isRecordingMode ? (
            <div className="h-full flex flex-col items-center justify-center bg-[var(--surface-950)] p-6 relative">
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/3 w-[400px] h-[400px] rounded-full bg-purple-600/5 blur-[150px]"></div>
                <div className="absolute bottom-1/4 right-1/3 w-[300px] h-[300px] rounded-full bg-teal-500/5 blur-[120px]"></div>
              </div>
              <AudioRecorder
                transcriptionEngine={transcriptionEngine}
                onEngineChange={handleEngineChange}
                hasSarvamKey={hasSarvamKey}
                sessionCapMinutes={BILLING_ENABLED ? subscriptionState.sessionCapMinutes : null}
                backgroundProcessing={recordings.some(r => r.status === 'processing')}
                onNotice={(message, type) => addToast(message, type ?? 'info')}
                onRequestDiscard={handleDiscardRecording}
              />
            </div>
          ) : (
            <HomeView
              user={user}
              recordings={recordings}
              actionItems={actionItems}
              isLoading={recordingsLoading}
              onSelectSession={handleSelectRecording}
              onStartNew={handleStartNew}
              usage={BILLING_ENABLED ? subscriptionState : undefined}
              onUpgrade={() => setUpgradeModal({ open: true })}
            />
          )}
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--surface-900)]/95 backdrop-blur-xl border-t border-white/[0.06]" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="flex items-end justify-around h-16 px-2">

            {/* Home */}
            <button
              onClick={() => { handleGoHome(); setSidebarOpen(false); }}
              className={`flex flex-col items-center justify-center gap-0.5 min-w-[56px] h-full rounded-xl transition-all active:scale-90 ${activeRecordingId === 'home' && !isRecordingMode ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}
            >
              <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <span className="text-[10px] font-semibold">Home</span>
            </button>

            {/* Sessions */}
            <button
              onClick={() => { handleSelectRecording('sessions'); setSidebarOpen(false); }}
              className={`flex flex-col items-center justify-center gap-0.5 min-w-[56px] h-full rounded-xl transition-all active:scale-90 ${activeRecordingId === 'sessions' ? 'text-teal-400' : 'text-[var(--text-muted)]'}`}
            >
              <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span className="text-[10px] font-semibold">Sessions</span>
            </button>

            {/* Record FAB — elevated centre */}
            <button
              onClick={() => { handleStartNew(); setSidebarOpen(false); }}
              className="flex flex-col items-center justify-center -mt-5 active:scale-90 transition-all"
            >
              <div className="w-14 h-14 rounded-2xl bg-amber-500 flex items-center justify-center shadow-lg">
                <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <span className="text-[10px] font-semibold text-amber-400 mt-1">Record</span>
            </button>

            {/* Actions */}
            <button
              onClick={() => { handleSelectRecording('actions'); setSidebarOpen(false); }}
              className={`flex flex-col items-center justify-center gap-0.5 min-w-[56px] h-full rounded-xl transition-all active:scale-90 ${activeRecordingId === 'actions' ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}
            >
              <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              <span className="text-[10px] font-semibold">Actions</span>
            </button>

            {/* Intelligence */}
            <button
              onClick={() => { handleSelectRecording('intelligence'); setSidebarOpen(false); }}
              className={`flex flex-col items-center justify-center gap-0.5 min-w-[56px] h-full rounded-xl transition-all active:scale-90 ${activeRecordingId === 'intelligence' || activeRecordingId === 'strategist' || activeRecordingId === 'chatbot' ? 'text-purple-400' : 'text-[var(--text-muted)]'}`}
            >
              <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <span className="text-[10px] font-semibold">Intel</span>
            </button>

          </div>
        </nav>

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Recovery modal */}
      {recoveryData && (
        <RecoveryModal
          durationStr={recoveryData.durationStr}
          timeAgo={recoveryData.timeAgo}
          onRecover={handleRecoverRecording}
          onDiscard={handleDiscardRecovery}
        />
      )}

      {/* Unfinished recordings that were not auto-saved: Save / Discard */}
      {!recoveryData && leftoverRecordings.length > 0 && (
        <LeftoverRecordingNotice
          manifest={leftoverRecordings[0]}
          remaining={leftoverRecordings.length - 1}
          onSave={() => handleLeftoverSave(leftoverRecordings[0])}
          onDiscard={() => handleLeftoverDiscard(leftoverRecordings[0])}
          onLater={() => setLeftoverRecordings(prev => prev.slice(1))}
        />
      )}

      {/* Themed confirm modal (replaces window.confirm) */}
      {confirmRequest && (
        <ConfirmModal
          request={confirmRequest}
          onClose={() => setConfirmRequest(null)}
        />
      )}

      {/* Paywall — opens when canStartNewRecording returns false. */}
      {BILLING_ENABLED && user && (
        <UpgradeModal
          user={user}
          open={upgradeModal.open}
          reason={upgradeModal.reason}
          offerTiers={upgradeModal.offerTiers}
          onClose={() => setUpgradeModal({ open: false })}
          onSubscribed={() => {
            addToast('Payment received — activating your Pro account…', 'success');
            // Realtime subscription will flip tier when the webhook lands.
            setUpgradeModal({ open: false });
          }}
        />
      )}
    </div>
  );
};

export default App;
