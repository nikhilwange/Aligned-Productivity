
import React, { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import AudioRecorder from './components/AudioRecorder';
import ResultsView from './components/ResultsView';
import Sidebar from './components/Sidebar';
import DictationView from './components/DictationView';
import DictationLogView from './components/DictationLogView';
import SessionsLogView from './components/SessionsLogView';
import ActionItemsView from './components/ActionItemsView';
import HomeView from './components/HomeView';
import IntelligenceView from './components/IntelligenceView';
import ManualEntryView from './components/ManualEntryView';
import AuthView from './components/AuthView';
import ResetPassword from './components/ResetPassword';
import LandingPage from './components/LandingPage';
import { AppState, RecordingSession, AudioRecording, User, ChatMessage, RecordingSource } from './types';
import { analyzeConversation, extractTranscript, analyzeTranscript, enhanceDictationText } from './services/geminiService';
import { transcribeAudioWithSarvam } from './services/sarvamService';
import { supabase, fetchRecordings, saveRecording, deleteRecordingFromDb } from './services/supabaseService';

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
  const [isLiveMode, setIsLiveMode] = useState<boolean>(false);
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showAuthView, setShowAuthView] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('aligned-theme') as 'light' | 'dark') || 'dark';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isManualProcessing, setIsManualProcessing] = useState(false);
  const [transcriptionEngine, setTranscriptionEngine] = useState<'gemini' | 'sarvam'>(() => {
    return (localStorage.getItem('aligned-engine') as 'gemini' | 'sarvam') || 'gemini';
  });

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
        const data = await fetchRecordings(user.id);
        console.log('[App] Fetched recordings:', data.length, 'recordings');
        setRecordings(data);
      };
      loadData();
    }
  }, [user]);

  const handleLogout = async () => {
    if (window.confirm("Are you sure you want to logout?")) {
      await supabase.auth.signOut();
    }
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

    const updateSession = (updates: Partial<RecordingSession>) => {
      setRecordings(prev => prev.map(rec =>
        rec.id === newSession.id ? { ...rec, ...updates } : rec
      ));
    };

    try {
      await saveRecording(newSession, user.id);
      const analysisResult = await analyzeTranscript(data.transcript);
      const fullAnalysis = { ...analysisResult, transcript: data.transcript };
      const completedSession: RecordingSession = {
        ...newSession,
        analysis: fullAnalysis,
        status: 'completed',
        processingStep: undefined,
      };
      updateSession({ analysis: fullAnalysis, status: 'completed', processingStep: undefined });
      await saveRecording(completedSession, user.id);
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
    setIsLiveMode(false);
    setIsRecordingMode(true);
    setAppState(AppState.IDLE);
  };

  const handleGoHome = () => {
    setActiveRecordingId('home');
    setIsRecordingMode(false);
    setIsLiveMode(false);
    setAppState(AppState.IDLE);
  };

  const handleStartLive = () => {
    setActiveRecordingId(null);
    setIsRecordingMode(false);
    setIsLiveMode(true);
    setAppState(AppState.LIVE);
  };

  const handleEndLive = () => {
    setIsLiveMode(false);
    setIsRecordingMode(true);
    setAppState(AppState.IDLE);
  };

  const handleSelectRecording = (id: string) => {
    if (id === 'home') {
      handleGoHome();
      return;
    }
    setIsRecordingMode(false);
    setIsLiveMode(false);
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

  const handleDeleteRecording = async (id: string) => {
    if (!user) return;

    if (window.confirm("Are you sure you want to delete this recording? This action cannot be undone.")) {
      const previousRecordings = [...recordings];

      setRecordings(prev => prev.filter(rec => rec.id !== id));

      if (activeRecordingId === id) {
        handleGoHome();
      }

      try {
        await deleteRecordingFromDb(id, user.id);
      } catch (err) {
        setRecordings(previousRecordings);
        alert("Delete failed. Please check your internet connection and try again.");
      }
    }
  };

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
    };

    setRecordings(prev => [newSession, ...prev]);
    setActiveRecordingId(newSession.id);
    setIsRecordingMode(false);
    setAppState(AppState.PROCESSING);

    const updateSession = (updates: Partial<RecordingSession>) => {
      setRecordings(prev => prev.map(rec =>
        rec.id === newSession.id ? { ...rec, ...updates } : rec
      ));
    };

    try {
      await saveRecording(newSession, user.id);

      // Phase 1: Transcription
      let transcript: string;
      if (transcriptionEngine === 'sarvam' && hasSarvamKey) {
        try {
          console.log('[App] Using Sarvam STT → Gemini analysis pipeline');
          transcript = await transcribeAudioWithSarvam(audioData.blob);
        } catch (sarvamError: any) {
          console.error('[App] ⚠️ Sarvam STT failed — falling back to Gemini transcription.', sarvamError.message);
          updateSession({ processingStep: 'transcribing' }); // reset so spinner stays visible during fallback
          transcript = await extractTranscript(audioData.blob);
        }
      } else {
        transcript = await extractTranscript(audioData.blob);
      }

      // Intermediate update: show transcript immediately
      const partialAnalysis = { transcript, summary: '', actionPoints: [] as string[] };
      const transcribedSession: RecordingSession = {
        ...newSession,
        analysis: partialAnalysis,
        status: 'processing',
        processingStep: 'analyzing',
      };
      updateSession({ analysis: partialAnalysis, processingStep: 'analyzing' });
      await saveRecording(transcribedSession, user.id);

      // Phase 2: Analysis
      const analysisResult = await analyzeTranscript(transcript);
      const fullAnalysis = { ...analysisResult, transcript };

      const completedSession: RecordingSession = {
        ...newSession,
        analysis: fullAnalysis,
        status: 'completed',
        processingStep: undefined,
      };
      updateSession({ analysis: fullAnalysis, status: 'completed', processingStep: undefined });
      await saveRecording(completedSession, user.id);
    } catch (err: any) {
      console.error("Recording process failed:", err);
      const errorSession: RecordingSession = { ...newSession, status: 'error', errorMessage: err.message, processingStep: undefined };
      updateSession({ status: 'error', errorMessage: err.message, processingStep: undefined });
      await saveRecording(errorSession, user.id);
    }
  }, [user, transcriptionEngine, hasSarvamKey]);

  // Loading State
  if (isInitialLoad) return (
    <div className="h-screen w-screen flex items-center justify-center bg-[var(--surface-950)]">
      <div className="relative">
        <div className="w-12 h-12 rounded-full border-4 border-white/10"></div>
        <div className="absolute inset-0 w-12 h-12 rounded-full border-4 border-t-purple-500 border-r-teal-500 border-b-amber-500 border-l-transparent animate-spin"></div>
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
          onStartLive={handleStartLive}
          isLiveActive={isLiveMode}
          onDelete={handleDeleteRecording}
          onLogout={handleLogout}
          theme={theme}
          onToggleTheme={toggleTheme}
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
            onStartLive={() => { handleStartLive(); setSidebarOpen(false); }}
            isLiveActive={isLiveMode}
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
        {!isLiveMode && (
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
                <div className="w-8 h-8 bg-gradient-to-br from-amber-500 via-orange-500 to-yellow-600 rounded-lg shadow-lg flex items-center justify-center text-white font-bold text-sm">
                  A
                </div>
                <h1 className="text-base md:text-lg font-bold tracking-tight text-[var(--text-primary)]">Aligned</h1>
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
        )}

        <div className="flex-1 overflow-hidden relative pb-16 md:pb-0">
          {isLiveMode ? (
            <DictationView
              onCancel={handleEndLive}
              transcriptionEngine={transcriptionEngine}
              onRecordingComplete={async (transcript, audioBlob) => {
                if (!user) return;

                const newSession: RecordingSession = {
                  id: uuidv4(),
                  title: `Dictation ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                  date: Date.now(),
                  duration: 0,
                  analysis: null,
                  status: 'processing',
                  source: 'dictation'
                };

                setRecordings(prev => [newSession, ...prev]);
                setActiveRecordingId('sessions');
                setIsLiveMode(false);
                setAppState(AppState.PROCESSING);

                try {
                  await saveRecording(newSession, user.id);

                  let finalTranscript = transcript;
                  if (!finalTranscript && audioBlob) {
                    console.log("Live transcript missing, falling back to audio blob analysis...");
                    const fallbackAnalysis = await analyzeConversation(audioBlob);
                    finalTranscript = fallbackAnalysis.transcript;
                  }

                  if (!finalTranscript || finalTranscript.trim().length === 0) {
                    throw new Error("No transcript available from dictation or audio fallback");
                  }

                  const analysis = await enhanceDictationText(finalTranscript);
                  const completedSession: RecordingSession = { ...newSession, analysis, status: 'completed' };
                  setRecordings(prev => prev.map(rec => rec.id === newSession.id ? completedSession : rec));
                  await saveRecording(completedSession, user.id);
                  setAppState(AppState.IDLE);
                } catch (err: any) {
                  console.error("Dictation processing failed", err);
                  const errorSession: RecordingSession = { ...newSession, status: 'error', errorMessage: err.message };
                  setRecordings(prev => prev.map(rec => rec.id === newSession.id ? errorSession : rec));
                  await saveRecording(errorSession, user.id);
                  setAppState(AppState.IDLE);
                }
              }}
            />
          ) : activeRecordingId === 'home' ? (
            <HomeView
              user={user}
              recordings={recordings}
              onSelectSession={handleSelectRecording}
              onStartNew={handleStartNew}
              onStartLive={handleStartLive}
            />
          ) : activeRecordingId === 'sessions' || activeRecordingId === 'dictations' ? (
            <SessionsLogView
              sessions={recordings}
              onSelect={handleSelectRecording}
              onDelete={handleDeleteRecording}
            />
          ) : activeRecordingId === 'actions' ? (
            <ActionItemsView recordings={recordings} onSelectSession={handleSelectRecording} />
          ) : activeRecordingId === 'manual-entry' ? (
            <ManualEntryView
              onSubmit={handleManualEntry}
              onCancel={handleGoHome}
              isProcessing={isManualProcessing}
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
              onSelectSession={handleSelectRecording}
              onStartNew={handleStartNew}
              onStartLive={handleStartLive}
            />
          )}
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      {!isLiveMode && (
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
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
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
      )}
    </div>
  );
};

export default App;
