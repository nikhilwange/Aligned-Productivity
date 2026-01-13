import React, { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import AudioRecorder from './components/AudioRecorder';
import ResultsView from './components/ResultsView';
import Sidebar from './components/Sidebar';
import LiveSession from './components/LiveSession';
import AuthView from './components/AuthView';
import { AppState, RecordingSession, AudioRecording, User } from './types';
import { analyzeConversation } from './services/geminiService';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [recordings, setRecordings] = useState<RecordingSession[]>([]);
  const [activeRecordingId, setActiveRecordingId] = useState<string | null>(null);
  const [isRecordingMode, setIsRecordingMode] = useState<boolean>(false);
  const [isLiveMode, setIsLiveMode] = useState<boolean>(false);
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  useEffect(() => {
    const savedUser = localStorage.getItem('vanilog_user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        console.error("Failed to parse user session");
      }
    }
    setIsInitialLoad(false);
  }, []);

  const handleLogin = (newUser: User) => {
    setUser(newUser);
  };

  const handleLogout = () => {
    if (window.confirm("Are you sure you want to logout?")) {
      localStorage.removeItem('vanilog_user');
      setUser(null);
      setActiveRecordingId(null);
      setIsRecordingMode(false);
      setIsLiveMode(false);
      setAppState(AppState.IDLE);
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
    setAppState(AppState.IDLE);
  };

  const handleSelectRecording = (id: string) => {
    setIsRecordingMode(false);
    setIsLiveMode(false);
    setActiveRecordingId(id);
  };

  const handleUpdateTitle = (id: string, newTitle: string) => {
    setRecordings(prev => prev.map(rec => rec.id === id ? { ...rec, title: newTitle } : rec));
  };

  const handleDeleteRecording = (id: string) => {
    if (window.confirm("Are you sure you want to delete this recording? This action cannot be undone.")) {
      setRecordings(prev => prev.filter(rec => rec.id !== id));
      if (activeRecordingId === id) {
        setActiveRecordingId(null);
        if (!isRecordingMode && !isLiveMode) setAppState(AppState.IDLE);
      }
    }
  };

  const handleBackToList = () => {
    setActiveRecordingId(null);
    setIsRecordingMode(false);
    setIsLiveMode(false);
    setAppState(AppState.IDLE);
  };

  const handleRecordingComplete = useCallback(async (audioData: AudioRecording) => {
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
      const analysis = await analyzeConversation(audioData.blob);
      setRecordings(prev => prev.map(rec => rec.id === newSession.id ? { ...rec, analysis, status: 'completed' } : rec));
    } catch (err: any) {
      console.error(err);
      setRecordings(prev => prev.map(rec => rec.id === newSession.id ? { ...rec, status: 'error', errorMessage: err.message || "Failed to analyze audio." } : rec));
    }
  }, []);

  if (isInitialLoad) return null;
  if (!user) return <AuthView onLogin={handleLogin} />;
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
              <button onClick={handleBackToList} className="md:hidden p-2 -ml-2 text-slate-400 hover:bg-slate-50 rounded-xl transition-colors"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-teal-600 to-emerald-600 rounded-lg shadow-lg flex items-center justify-center text-white font-bold text-sm">V</div>
                <h1 className="text-xl font-bold tracking-tight text-slate-800">VaniLog</h1>
              </div>
            </div>
            <div className="px-4 py-1.5 rounded-full bg-slate-100 text-[10px] font-bold text-slate-500 tracking-tight border border-slate-200/50">Gemini 2.5 flash</div>
          </header>
        )}
        <div className="flex-1 overflow-hidden relative">
          {isLiveMode ? <LiveSession onEndSession={handleEndLive} /> : isRecordingMode ? (
            <div className="h-full flex flex-col items-center justify-center bg-slate-50/20 p-6"><AudioRecorder appState={appState} setAppState={setAppState} onRecordingComplete={handleRecordingComplete} /></div>
          ) : activeSession ? <ResultsView session={activeSession} onUpdateTitle={handleUpdateTitle} /> : (
            <div className="hidden md:flex h-full flex-col items-center justify-center text-slate-300 p-8">
               <div className="w-32 h-32 bg-slate-50 rounded-full flex items-center justify-center mb-8 text-slate-200 border border-slate-100 shadow-inner"><svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg></div>
               <h2 className="text-2xl font-bold text-slate-700">Voice-to-insight AI</h2>
               <p className="max-w-xs text-center mt-3 text-sm text-slate-400 font-medium leading-relaxed">Start a new recording or choose from history to see Gemini's analysis.</p>
               <div className="flex gap-4 mt-12">
                 <button onClick={handleStartNew} className="px-8 py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold hover:bg-slate-800 transition-all shadow-xl active:scale-95">Start recording</button>
                 <button onClick={handleStartLive} className="px-8 py-3 bg-white text-slate-600 border border-slate-200 hover:border-teal-300 hover:text-teal-700 rounded-2xl text-sm font-bold transition-all active:scale-95">Live companion</button>
               </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;