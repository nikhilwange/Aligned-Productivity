
import React, { useState, useCallback, useEffect } from 'react';
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
import { AppState, RecordingSession, AudioRecording, User, ChatMessage, RecordingSource, TrackedActionItem } from './types';
import { extractTranscript, analyzeTranscript } from './services/geminiService';
import { transcribeAudioWithSarvam } from './services/sarvamService';
import { uploadAudioToStorage, deleteAudioPaths } from './services/storageService';
import { supabase, fetchRecordings, saveRecording, deleteRecordingFromDb, fetchActionItems, syncActionItemsFromRecording, updateActionItem, deleteActionItem } from './services/supabaseService';
import { getRecoverableRecordings, clearRecoverySession, clearAllRecovery } from './services/recordingRecovery';
import ProcessingBanner from './components/ProcessingBanner';
import RecoveryModal from './components/RecoveryModal';
import ConfirmModal, { ConfirmRequest } from './components/ConfirmModal';
import { ToastContainer, ToastData } from './components/Toast';

declare global {
  interface Window {
    ipcRenderer?: {
      on: (channel: string, func: (...args: any[]) => void) => (() => void) | undefined;
      send: (channel: string, data?: any) => void;
    };
  }
}

const isElectron = typeof window !== 'undefined' && !!(window as any).ipcRenderer;

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

  // ─── Processing UX State ──────────────────────────────────────────────────
  const [processingSessionId, setProcessingSessionId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [recoveryData, setRecoveryData] = useState<{
    durationStr: string;
    timeAgo: number;
    blob: Blob;
    source: RecordingSource;
    recoveryId: string;
  } | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  // ─── Toast helper ─────────────────────────────────────────────────────────
  const addToast = useCallback((message: string, type: ToastData['type'] = 'success', opts?: { actionLabel?: string; onAction?: () => void }) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    setToasts(prev => [...prev, { id, message, type, ...opts }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ─── Detect when processing finishes (success or error) ───────────────────
  useEffect(() => {
    if (!processingSessionId) return;
    const session = recordings.find(r => r.id === processingSessionId);
    if (!session) return;

    if (session.status === 'completed') {
      const actionCount = session.analysis?.actionPoints?.length || 0;
      const isViewingSession = activeRecordingId === processingSessionId;

      if (!isViewingSession) {
        addToast(
          `"${session.title}" is ready` + (actionCount > 0 ? ` — ${actionCount} action item${actionCount !== 1 ? 's' : ''} found` : ''),
          'success',
          {
            actionLabel: 'View session',
            onAction: () => {
              setIsRecordingMode(false);
              setActiveRecordingId(processingSessionId);
            },
          }
        );
      }
      setProcessingSessionId(null);
    } else if (session.status === 'error') {
      const isViewingSession = activeRecordingId === processingSessionId;
      if (!isViewingSession) {
        addToast(
          `Processing failed for "${session.title}"` + (session.recoveryId ? ' — tap to retry' : ''),
          'error',
          session.recoveryId ? {
            actionLabel: 'View & retry',
            onAction: () => {
              setIsRecordingMode(false);
              setActiveRecordingId(processingSessionId);
            },
          } : undefined
        );
      }
      setProcessingSessionId(null);
    }
  }, [recordings, processingSessionId, activeRecordingId, addToast]);

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
    const { data: authData } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setShowResetPassword(true);
        return;
      }
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email || '',
          name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User'
        });
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
          setUser({
            id: data.session.user.id,
            email: data.session.user.email || '',
            name: data.session.user.user_metadata?.name || data.session.user.email?.split('@')[0] || 'User'
          });
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

        // Fix stale processing sessions (interrupted by page close/crash)
        const now = Date.now();
        const fixedData = data.map(r => {
          if (r.status === 'processing' && (now - r.date) > 5 * 60 * 1000) {
            return { ...r, status: 'error' as const, errorMessage: 'Processing was interrupted. Tap Retry if audio is still available.', processingStep: undefined };
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

        // Migrate existing completed recordings that have no action_items rows yet
        const syncedIds = new Set(itemsWithMeta.filter(i => i.recordingId).map(i => i.recordingId!));
        const unsynced = data.filter(r =>
          r.status === 'completed' &&
          (r.analysis?.actionPoints?.length ?? 0) > 0 &&
          !syncedIds.has(r.id)
        );
        if (unsynced.length > 0) {
          console.log('[App] Migrating action items for', unsynced.length, 'recordings...');
          for (let i = 0; i < unsynced.length; i += 5) {
            const batch = unsynced.slice(i, i + 5);
            const results = await Promise.all(batch.map(r => syncActionItemsFromRecording(r, user.id)));
            const newItems = results.flat().map(item => {
              const session = data.find(r => r.id === item.recordingId);
              return session ? { ...item, sessionTitle: session.title, sessionDate: session.date } : item;
            });
            if (newItems.length > 0) setActionItems(prev => [...prev, ...newItems]);
          }
        }

        // Check for recoverable recordings from crashed/closed sessions
        try {
          const recoverable = await getRecoverableRecordings();
          if (recoverable.length > 0) {
            const newest = recoverable[0];

            // Smart check: skip if this recording already completed in Supabase
            const alreadyCompleted = data.find(
              r => r.recoveryId === newest.meta.id && r.status === 'completed'
            );
            if (alreadyCompleted) {
              console.log('[App] Recovery entry already completed — clearing silently');
              clearRecoverySession(newest.meta.id);
            } else {
              const durationStr = newest.meta.duration > 0
                ? `${Math.floor(newest.meta.duration / 60)}m ${newest.meta.duration % 60}s`
                : 'unknown duration';
              const timeAgo = Math.round((Date.now() - newest.meta.startedAt) / 60000);
              const source = (newest.meta.source || 'in-person') as RecordingSource;

              // Show in-app modal instead of window.confirm
              setRecoveryData({
                durationStr,
                timeAgo,
                blob: newest.blob,
                source,
                recoveryId: newest.meta.id,
              });
            }
          }
        } catch (err) {
          console.warn('[App] Recovery check failed:', err);
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
      onConfirm: () => { supabase.auth.signOut(); },
    });
  };

  const handleManualEntry = async (data: {
    title: string;
    transcript: string;
    source: RecordingSource;
    date: number;
    duration: number;
  }) => {
    if (!user) return;
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
    setProcessingSessionId(newSession.id);

    const updateSession = (updates: Partial<RecordingSession>) => {
      setRecordings(prev => prev.map(rec =>
        rec.id === newSession.id ? { ...rec, ...updates } : rec
      ));
    };

    try {
      await saveRecording(newSession, user.id);
      const analysisResult = await analyzeTranscript(data.transcript, data.date);
      const fullAnalysis = { ...analysisResult, transcript: data.transcript };
      const completedSession: RecordingSession = {
        ...newSession,
        analysis: fullAnalysis,
        status: 'completed',
        processingStep: undefined,
      };
      updateSession({ analysis: fullAnalysis, status: 'completed', processingStep: undefined });
      await saveRecording(completedSession, user.id);

      try {
        const newItems = await syncActionItemsFromRecording(completedSession, user.id);
        const withMeta = newItems.map(i => ({ ...i, sessionTitle: completedSession.title, sessionDate: completedSession.date }));
        if (withMeta.length > 0) setActionItems(prev => [...prev, ...withMeta]);
      } catch (syncErr) {
        console.warn('[App] Action item sync failed:', syncErr);
      }
    } catch (err: any) {
      console.error('Manual entry processing failed:', err);
      const errorSession: RecordingSession = { ...newSession, status: 'error', errorMessage: err.message, processingStep: undefined };
      updateSession({ status: 'error', errorMessage: err.message, processingStep: undefined });
      await saveRecording(errorSession, user.id);
    } finally {
      setIsManualProcessing(false);
    }
  };

  const handleStartNew = () => {
    setActiveRecordingId(null);
    setIsRecordingMode(true);
    setAppState(AppState.IDLE);
  };

  const handleGoHome = () => {
    setActiveRecordingId('home');
    setIsRecordingMode(false);
    setAppState(AppState.IDLE);
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
          deleteAudioPaths([audioPathToRemove]).catch(() => {});
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

    const updateSession = (updates: Partial<RecordingSession>) => {
      setRecordings(prev => prev.map(rec =>
        rec.id === session.id ? { ...rec, ...updates } : rec
      ));
    };

    try {
      try {
        await saveRecording(session, user.id);
      } catch (saveErr) {
        console.warn("Initial save failed, continuing with processing:", saveErr);
      }

      // Background: archive the full audio to Supabase Storage in parallel with processing.
      // Doesn't block transcription — the audioPath gets saved when (and if) the upload finishes.
      const ext = (blob.type || 'audio/webm').split(';')[0].split('/')[1] || 'webm';
      uploadAudioToStorage(blob, `recordings/${session.id}.${ext}`)
        .then(async (path) => {
          updateSession({ audioPath: path });
          try {
            await saveRecording({ ...session, audioPath: path }, user.id);
          } catch (saveErr) {
            console.warn('[App] Failed to persist audioPath:', saveErr);
          }
        })
        .catch((err) => console.warn('[App] Audio archive upload failed (non-critical):', err?.message));

      // Phase 1: Transcription
      let transcript: string;
      if (transcriptionEngine === 'sarvam' && hasSarvamKey) {
        try {
          console.log('[App] Using Sarvam STT → Gemini analysis pipeline');
          transcript = await transcribeAudioWithSarvam(blob);
        } catch (sarvamError: any) {
          console.error('[App] ⚠️ Sarvam STT failed — falling back to Gemini transcription.', sarvamError.message);
          updateSession({ processingStep: 'transcribing' });
          transcript = await extractTranscript(blob);
        }
      } else {
        transcript = await extractTranscript(blob);
      }

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
      const fullAnalysis = { ...analysisResult, transcript };

      const completedSession: RecordingSession = {
        ...session,
        analysis: fullAnalysis,
        status: 'completed',
        processingStep: undefined,
        errorMessage: undefined,
        recoveryId: undefined, // clear from DB row — blob is about to be removed from IndexedDB
      };
      updateSession({ analysis: fullAnalysis, status: 'completed', processingStep: undefined, errorMessage: undefined, recoveryId: undefined });
      await saveRecording(completedSession, user.id);

      // Clear the IndexedDB recovery entry IMMEDIATELY after Supabase save succeeds
      // This prevents the false recovery popup on page reload
      if (session.recoveryId) {
        try {
          clearRecoverySession(session.recoveryId);
        } catch (clearErr) {
          console.warn('[App] IndexedDB cleanup failed (non-critical):', clearErr);
        }
      }

      // Sync action items to the tracker
      try {
        const newItems = await syncActionItemsFromRecording(completedSession, user.id);
        const withMeta = newItems.map(i => ({ ...i, sessionTitle: completedSession.title, sessionDate: completedSession.date }));
        if (withMeta.length > 0) setActionItems(prev => [...prev, ...withMeta]);
      } catch (syncErr) {
        console.warn('[App] Action item sync failed, will migrate on next load:', syncErr);
      }
    } catch (err: any) {
      console.error("Recording process failed:", err);
      // Keep recoveryId so the user can retry from the IndexedDB blob
      const errorSession: RecordingSession = { ...session, status: 'error', errorMessage: err.message, processingStep: undefined };
      updateSession({ status: 'error', errorMessage: err.message, processingStep: undefined });
      try {
        await saveRecording(errorSession, user.id);
      } catch (saveErr) {
        console.error("Failed to save error state:", saveErr);
      }
    } finally {
      setAppState(AppState.IDLE);
    }
  }, [user, transcriptionEngine, hasSarvamKey]);

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
    setAppState(AppState.PROCESSING);
    setProcessingSessionId(newSession.id);

    await runProcessingForSession(newSession, audioData.blob);
  }, [user, runProcessingForSession]);

  const handleRetryProcessing = useCallback(async (sessionId: string) => {
    if (!user) return;
    const session = recordings.find(r => r.id === sessionId);
    if (!session) return;
    if (!session.recoveryId) {
      addToast('No recoverable audio for this session. Retry is only available right after a failed recording on the same device.', 'error');
      return;
    }

    const recoverable = await getRecoverableRecordings();
    const match = recoverable.find(r => r.meta.id === session.recoveryId);
    if (!match) {
      addToast('The recorded audio is no longer available in this browser. Retry is not possible.', 'error');
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
    setAppState(AppState.PROCESSING);
    setProcessingSessionId(sessionId);

    await runProcessingForSession(resetSession, match.blob);
  }, [user, recordings, runProcessingForSession]);

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
    setRecoveryData(null);
  }, []);

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

        <div className="flex-1 overflow-hidden relative pb-16 md:pb-0">
          {/* Processing Banner — visible on all views when a session is processing */}
          {processingSessionId && activeRecordingId !== processingSessionId && (() => {
            const ps = recordings.find(r => r.id === processingSessionId);
            return ps && ps.status === 'processing' ? (
              <ProcessingBanner
                session={ps}
                onTap={() => {
                  setIsRecordingMode(false);
                  setActiveRecordingId(processingSessionId);
                }}
              />
            ) : null;
          })()}
          {activeRecordingId === 'home' ? (
            <HomeView
              user={user}
              recordings={recordings}
              actionItems={actionItems}
              isLoading={recordingsLoading}
              onSelectSession={handleSelectRecording}
              onStartNew={handleStartNew}
            />
          ) : activeRecordingId === 'sessions' || activeRecordingId === 'dictations' ? (
            <SessionsLogView
              sessions={recordings}
              isLoading={recordingsLoading}
              onSelect={handleSelectRecording}
              onDelete={handleDeleteRecording}
              onRetry={handleRetryProcessing}
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
          ) : activeRecordingId === 'intelligence' || activeRecordingId === 'strategist' || activeRecordingId === 'chatbot' ? (
            <IntelligenceView
              recordings={recordings}
              userId={user?.id || ''}
              messages={chatMessages}
              onMessagesChange={setChatMessages}
            />
          ) : activeSession ? (
            <ResultsView session={activeSession} onUpdateTitle={handleUpdateTitle} />
          ) : isRecordingMode ? (
            <div className="h-full flex flex-col items-center justify-center bg-[var(--surface-950)] p-6 relative">
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/3 w-[400px] h-[400px] rounded-full bg-purple-600/5 blur-[150px]"></div>
                <div className="absolute bottom-1/4 right-1/3 w-[300px] h-[300px] rounded-full bg-teal-500/5 blur-[120px]"></div>
              </div>
              <AudioRecorder
                appState={appState}
                setAppState={setAppState}
                onRecordingComplete={handleRecordingComplete}
                transcriptionEngine={transcriptionEngine}
                onEngineChange={handleEngineChange}
                hasSarvamKey={hasSarvamKey}
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

      {/* Themed confirm modal (replaces window.confirm) */}
      {confirmRequest && (
        <ConfirmModal
          request={confirmRequest}
          onClose={() => setConfirmRequest(null)}
        />
      )}
    </div>
  );
};

export default App;
