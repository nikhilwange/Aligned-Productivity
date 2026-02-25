
import React, { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import AudioRecorder from './components/AudioRecorder';
import ResultsView from './components/ResultsView';
import Sidebar from './components/Sidebar';
import DictationView from './components/DictationView';
import DictationLogView from './components/DictationLogView';
import StrategistView from './components/StrategistView';
import ChatView from './components/ChatView';
import SessionsLogView from './components/SessionsLogView';
import AuthView from './components/AuthView';
import LandingPage from './components/LandingPage';
import { AppState, RecordingSession, AudioRecording, User, ChatMessage } from './types';
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
  const [activeRecordingId, setActiveRecordingId] = useState<string | null>(null);
  const [isRecordingMode, setIsRecordingMode] = useState<boolean>(true);
  const [isLiveMode, setIsLiveMode] = useState<boolean>(false);
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showAuthView, setShowAuthView] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('aligned-theme') as 'light' | 'dark') || 'dark';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
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

        const { data: authData } = supabase.auth.onAuthStateChange((_event, session) => {
          if (session?.user) {
            setUser({
              id: session.user.id,
              email: session.user.email || '',
              name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User'
            });
          } else {
            setUser(null);
            setRecordings([]);
            setActiveRecordingId(null);
            setIsRecordingMode(true);
          }
        });

        setIsInitialLoad(false);
        return () => authData?.subscription?.unsubscribe();
      } catch (err) {
        console.error('Auth initialization error:', err);
        setIsInitialLoad(false);
      }
    };

    initAuth();
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

  const handleStartNew = () => {
    setActiveRecordingId(null);
    setIsLiveMode(false);
    setIsRecordingMode(true);
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
        setActiveRecordingId(null);
        setIsRecordingMode(true);
        setIsLiveMode(false);
        setAppState(AppState.IDLE);
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
          console.warn('[App] Sarvam failed, falling back to Gemini:', sarvamError.message);
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
              {/* Mobile back button - only when viewing content */}
              {!!activeRecordingId && (
                <button
                  onClick={() => { setActiveRecordingId(null); setIsRecordingMode(true); }}
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
                setActiveRecordingId('dictations'); // Redirect to dictations log
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

                  // Validate transcript before processing
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
                  await saveRecording(errorSession, user.id); // ✅ FIX: Save error state to DB
                  setAppState(AppState.IDLE);
                }
              }}
            />
          ) : activeRecordingId === 'dictations' ? (
            <DictationLogView
              sessions={recordings}
              onDelete={handleDeleteRecording}
            />
          ) : activeRecordingId === 'sessions' ? (
            <SessionsLogView
              sessions={recordings}
              onSelect={handleSelectRecording}
              onDelete={handleDeleteRecording}
            />
          ) : activeRecordingId === 'strategist' ? (
            <StrategistView
              recordings={recordings}
              userId={user?.id || ''}
            />
          ) : activeRecordingId === 'chatbot' ? (
            <ChatView recordings={recordings} messages={chatMessages} onMessagesChange={setChatMessages} />
          ) : activeSession ? (
            <ResultsView session={activeSession} onUpdateTitle={handleUpdateTitle} />
          ) : (
            <div className="h-full flex flex-col items-center justify-center bg-[var(--surface-950)] p-6 relative">
              {/* Ambient background */}
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
          )}
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      {!isLiveMode && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--surface-900)]/95 backdrop-blur-xl border-t border-white/[0.06]" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="flex items-center justify-around h-16 px-1">

            {/* Record */}
            <button
              onClick={() => { handleStartNew(); setSidebarOpen(false); }}
              className={`flex flex-col items-center justify-center gap-0.5 min-w-[56px] h-full rounded-xl transition-all active:scale-90 ${isRecordingMode && !activeRecordingId ? 'text-purple-400' : 'text-[var(--text-muted)]'}`}
            >
              <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <span className="text-[10px] font-semibold">Record</span>
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

            {/* Dictate - Center Featured */}
            <button
              onClick={() => { handleStartLive(); setSidebarOpen(false); }}
              className="flex flex-col items-center justify-center -mt-5 active:scale-90 transition-all"
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center shadow-lg shadow-teal-500/25">
                <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </div>
              <span className="text-[10px] font-semibold text-[var(--text-muted)] mt-1">Dictate</span>
            </button>

            {/* Strategist */}
            <button
              onClick={() => { handleSelectRecording('strategist'); setSidebarOpen(false); }}
              className={`flex flex-col items-center justify-center gap-0.5 min-w-[56px] h-full rounded-xl transition-all active:scale-90 ${activeRecordingId === 'strategist' ? 'text-purple-400' : 'text-[var(--text-muted)]'}`}
            >
              <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <span className="text-[10px] font-semibold">Strategy</span>
            </button>

            {/* Ask Aligned */}
            <button
              onClick={() => { handleSelectRecording('chatbot'); setSidebarOpen(false); }}
              className={`flex flex-col items-center justify-center gap-0.5 min-w-[56px] h-full rounded-xl transition-all active:scale-90 ${activeRecordingId === 'chatbot' ? 'text-teal-400' : 'text-[var(--text-muted)]'}`}
            >
              <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <span className="text-[10px] font-semibold">Chat</span>
            </button>

            {/* Menu */}
            <button
              onClick={() => setSidebarOpen(prev => !prev)}
              className={`flex flex-col items-center justify-center gap-0.5 min-w-[56px] h-full rounded-xl transition-all active:scale-90 ${sidebarOpen ? 'text-purple-400' : 'text-[var(--text-muted)]'}`}
            >
              {sidebarOpen ? (
                <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
              )}
              <span className="text-[10px] font-semibold">Menu</span>
            </button>

          </div>
        </nav>
      )}
    </div>
  );
};

export default App;
