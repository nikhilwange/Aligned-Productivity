
import React, { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import AudioRecorder from './components/AudioRecorder';
import ResultsView from './components/ResultsView';
import Sidebar from './components/Sidebar';
import DictationView from './components/DictationView';
import DictationLogView from './components/DictationLogView';
import FloatingHUD from './components/FloatingHUD';
import AuthView from './components/AuthView';
import LandingPage from './components/LandingPage';
import { AppState, RecordingSession, AudioRecording, User } from './types';
import { analyzeConversation, enhanceDictationText } from './services/geminiService';
import { supabase, fetchRecordings, saveRecording, deleteRecordingFromDb } from './services/supabaseService';

declare global {
  interface Window {
    ipcRenderer: {
      on: (channel: string, func: (...args: any[]) => void) => (() => void) | undefined;
      send: (channel: string, data?: any) => void;
    };
  }
}

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

  useEffect(() => {
    document.body.className = theme === 'light' ? 'light antialiased' : 'antialiased';
    localStorage.setItem('aligned-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  const [viewMode, setViewMode] = useState<'dashboard' | 'hud'>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'hud' ? 'hud' : 'dashboard';
  });

  useEffect(() => {
    if (window.ipcRenderer) {
      window.ipcRenderer.on('switch-to-hud', () => setViewMode('hud'));
    }
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email || '',
          name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User'
        });
      }

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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
      return () => subscription.unsubscribe();
    };

    initAuth();
  }, []);

  useEffect(() => {
    if (user) {
      const loadData = async () => {
        const data = await fetchRecordings(user.id);
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
      source: audioData.source
    };

    setRecordings(prev => [newSession, ...prev]);
    setActiveRecordingId(newSession.id);
    setIsRecordingMode(false);
    setAppState(AppState.PROCESSING);

    try {
      await saveRecording(newSession, user.id);
      const analysis = await analyzeConversation(audioData.blob);
      const completedSession: RecordingSession = { ...newSession, analysis, status: 'completed' };
      setRecordings(prev => prev.map(rec => rec.id === newSession.id ? completedSession : rec));
      await saveRecording(completedSession, user.id);
    } catch (err: any) {
      console.error("Recording process failed:", err);
      const errorSession: RecordingSession = { ...newSession, status: 'error', errorMessage: err.message };
      setRecordings(prev => prev.map(rec => rec.id === newSession.id ? errorSession : rec));
      await saveRecording(errorSession, user.id);
    }
  }, [user]);

  const handleHudComplete = async (text: string) => {
    console.log("[App] 🔵 handleHudComplete called with text length:", text.length);
    const cleaned = text.trim();

    if (window.ipcRenderer) {
      console.log("[App] 🔵 Sending paste-text via IPC");
      window.ipcRenderer.send('paste-text', cleaned);
      console.log("[App] 🔵 IPC sent - window will hide via main process");
      // DON'T change viewMode - let the window just hide
    } else {
      console.error("[App] ❌ window.ipcRenderer not available!");
      if (navigator.clipboard) {
        navigator.clipboard.writeText(cleaned).catch(console.error);
      }
    }
  };

  const handleHudCancel = () => {
    console.log("[App] 🔵 handleHudCancel called");
    if (window.ipcRenderer) {
      console.log("[App] 🔵 Sending hide-hud via IPC");
      window.ipcRenderer.send('hide-hud');
      console.log("[App] 🔵 IPC sent - window will hide via main process");
      // DON'T change viewMode - let the window just hide
    } else {
      console.error("[App] ❌ window.ipcRenderer not available!");
    }
  };

  // HUD View
  if (viewMode === 'hud') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-transparent">
        <FloatingHUD onComplete={handleHudComplete} onCancel={handleHudCancel} />
      </div>
    );
  }

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
  const showMainContent = isRecordingMode || isLiveMode || !!activeRecordingId;

  return (
    <div className="h-screen bg-[var(--surface-950)] flex overflow-hidden animate-fade-in">
      {/* Sidebar */}
      <div className={`${showMainContent ? 'hidden' : 'flex'} md:flex flex-col w-full md:w-80 h-full shrink-0 z-20`}>
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
      
      {/* Main Content */}
      <main className={`${!showMainContent ? 'hidden' : 'flex'} flex-1 flex flex-col h-full overflow-hidden bg-[var(--surface-950)] z-10 w-full md:border-l md:border-white/[0.04]`}>
        {!isLiveMode && (
          <header className="h-16 border-b border-white/[0.06] flex items-center px-4 md:px-8 justify-between bg-[var(--surface-900)]/50 backdrop-blur-xl shrink-0">
            <div className="flex items-center space-x-3">
              {/* Mobile back button */}
              <button 
                onClick={() => { setActiveRecordingId(null); setIsRecordingMode(true); }} 
                className="md:hidden p-2 -ml-2 text-white/40 hover:bg-white/5 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              
              {/* Logo */}
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-gradient-to-br from-amber-500 via-orange-500 to-yellow-600 rounded-lg shadow-lg flex items-center justify-center text-white font-bold text-sm">
                  A
                </div>
                <h1 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">Aligned</h1>
              </div>
            </div>
            
            {/* Badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg glass text-xs font-semibold text-[var(--text-tertiary)]">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400"></span>
              Gemini 2.5
            </div>
          </header>
        )}
        
        <div className="flex-1 overflow-hidden relative">
          {isLiveMode ? (
            <DictationView
              onCancel={handleEndLive}
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
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
