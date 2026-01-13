
import React, { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import AudioRecorder from './components/AudioRecorder';
import ResultsView from './components/ResultsView';
import Sidebar from './components/Sidebar';
import LiveSession from './components/LiveSession';
import AuthView from './components/AuthView';
import { AppState, RecordingSession, AudioRecording, User } from './types';
import { analyzeConversation } from './services/geminiService';
import { supabase, fetchRecordings, saveRecording, deleteRecordingFromDb } from './services/supabaseService';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [recordings, setRecordings] = useState<RecordingSession[]>([]);
  const [activeRecordingId, setActiveRecordingId] = useState<string | null>(null);
  // Default to showing the recorder immediately
  const [isRecordingMode, setIsRecordingMode] = useState<boolean>(true);
  const [isLiveMode, setIsLiveMode] = useState<boolean>(false);
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Initialize Auth and Listen for changes
  useEffect(() => {
    const initAuth = async () => {
      // Check for current session
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email || '',
          name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User'
        });
      }

      // Listen for auth state changes
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

  // Fetch recordings from Supabase whenever user is set
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
    setIsRecordingMode(true); // Return to recorder
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
      title: `Recording ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`,
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

  if (isInitialLoad) return (
    <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
      <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  if (!user) return <AuthView onLogin={() => {}} />; 
  
  const activeSession = recordings.find(r => r.id === activeRecordingId);
  const showMainContent = isRecordingMode || isLiveMode || !!activeRecordingId;

  return (
    <div className="h-screen bg-slate-50 flex overflow-hidden font-sans text-slate-900 animate-in fade-in duration-700">
      <div className={`${showMainContent ? 'hidden' : 'flex'} md:flex flex-col w-full md:w-80 h-full shrink-0 z-20`}>
        <Sidebar user={user} recordings={recordings} activeId={activeRecordingId} onSelect={handleSelectRecording} onNew={handleStartNew} onStartLive={handleStartLive} isLiveActive={isLiveMode} onDelete={handleDeleteRecording} onLogout={handleLogout} />
      </div>
      <main className={`${!showMainContent ? 'hidden' : 'flex'} flex-1 flex flex-col h-full overflow-hidden bg-white shadow-[0_0_50px_rgba(0,0,0,0.05)] z-10 w-full rounded-l-[40px] border-l border-slate-100`}>
        {!isLiveMode && (
          <header className="h-20 border-b border-slate-50 flex items-center px-4 md:px-10 justify-between bg-white shrink-0">
            <div className="flex items-center space-x-3">
              <button onClick={() => { setActiveRecordingId(null); setIsRecordingMode(true); }} className="md:hidden p-2 -ml-2 text-slate-400 hover:bg-slate-50 rounded-xl transition-colors"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-amber-600 to-yellow-600 rounded-lg shadow-lg flex items-center justify-center text-white font-bold text-sm">A</div>
                <h1 className="text-xl font-bold tracking-tight text-slate-800">Aligned</h1>
              </div>
            </div>
            <div className="px-4 py-1.5 rounded-full bg-slate-100 text-[10px] font-bold text-slate-500 tracking-tight border border-slate-200/50">Gemini 2.5 flash</div>
          </header>
        )}
        <div className="flex-1 overflow-hidden relative">
          {isLiveMode ? (
            <LiveSession onEndSession={handleEndLive} />
          ) : activeSession ? (
            <ResultsView session={activeSession} onUpdateTitle={handleUpdateTitle} />
          ) : (
            /* Always default to the recorder if no session is active */
            <div className="h-full flex flex-col items-center justify-center bg-slate-50/20 p-6">
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
