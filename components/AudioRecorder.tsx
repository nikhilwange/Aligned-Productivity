import React, { useState, useRef, useEffect } from 'react';
import { AppState, AudioRecording } from '../types';

interface AudioRecorderProps {
  appState: AppState;
  setAppState: (state: AppState) => void;
  onRecordingComplete: (recording: AudioRecording) => void;
}

type InputMode = 'mic' | 'meeting' | 'call';

const MAX_RECORDING_SECONDS = 7200; // 2 Hours limit for API stability

const AudioRecorder: React.FC<AudioRecorderProps> = ({ appState, setAppState, onRecordingComplete }) => {
  const [timer, setTimer] = useState(0);
  const [inputMode, setInputMode] = useState<InputMode>('mic');
  const [isScreenCaptureSupported, setIsScreenCaptureSupported] = useState<boolean>(true);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const durationRef = useRef<number>(0);
  const sourceStreamsRef = useRef<MediaStream[]>([]);

  useEffect(() => {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const hasDisplayMedia = navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices;
    setIsScreenCaptureSupported(hasDisplayMedia && !isMobile);

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      cleanupStreams();
    };
  }, []);

  const startTimer = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = window.setInterval(() => {
      setTimer(prev => {
        const newValue = prev + 1;
        durationRef.current = newValue;
        
        if (newValue >= MAX_RECORDING_SECONDS) {
          stopRecording();
          return MAX_RECORDING_SECONDS;
        }
        
        return newValue;
      });
    }, 1000);
  };

  const stopTimer = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  const startRecording = async () => {
    try {
      let finalStream: MediaStream;
      if (inputMode === 'mic' || inputMode === 'call') {
        finalStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        sourceStreamsRef.current = [finalStream];
      } else {
        const displayStream = await (navigator.mediaDevices as any).getDisplayMedia({ 
          video: true,
          audio: { echoCancellation: true },
          systemAudio: "include" 
        });

        if (displayStream.getAudioTracks().length === 0) {
          alert("Share audio was not selected.");
          displayStream.getTracks().forEach((t: any) => t.stop());
          return;
        }

        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const dest = ctx.createMediaStreamDestination();
        ctx.createMediaStreamSource(displayStream).connect(dest);
        ctx.createMediaStreamSource(micStream).connect(dest);
        finalStream = dest.stream;
        sourceStreamsRef.current = [displayStream, micStream];
      }
      
      const options = { audioBitsPerSecond: 16000 };
      const mediaRecorder = new MediaRecorder(finalStream, options);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const source = inputMode === 'meeting' ? 'virtual-meeting' : inputMode === 'call' ? 'phone-call' : 'in-person';
        onRecordingComplete({ blob, url, duration: durationRef.current, source });
        cleanupStreams();
      };

      mediaRecorder.start();
      setAppState(AppState.RECORDING);
      setTimer(0);
      durationRef.current = 0;
      startTimer();
    } catch (err: any) {
      console.error(err);
      cleanupStreams();
    }
  };

  const cleanupStreams = () => {
    sourceStreamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));
    sourceStreamsRef.current = [];
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setAppState(AppState.PROCESSING);
      stopTimer();
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const isRecording = appState === AppState.RECORDING || appState === AppState.PAUSED;
  const isProcessing = appState === AppState.PROCESSING;
  const remainingTime = MAX_RECORDING_SECONDS - timer;
  const progressPercent = (timer / MAX_RECORDING_SECONDS) * 100;

  const getRemainingColor = () => {
    if (remainingTime < 120) return 'text-rose-500'; 
    if (remainingTime < 600) return 'text-amber-600'; 
    return 'text-amber-500';
  };

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-lg mx-auto p-4 animate-slide-up">
      {isRecording && (
        <div className="mb-8 animate-in slide-in-from-top-4 duration-700">
          <div className="flex items-center gap-2.5 px-5 py-2.5 bg-white border border-slate-100 rounded-2xl shadow-xl shadow-amber-900/5 ring-1 ring-black/5">
            <div className="relative">
              <div className="absolute inset-0 bg-amber-500 rounded-full animate-ping opacity-20"></div>
              <div className="relative w-2 h-2 bg-amber-500 rounded-full"></div>
            </div>
            <span className="text-[11px] font-extrabold text-slate-500 tracking-tight">
              High-precision active session
            </span>
          </div>
        </div>
      )}

      {!isRecording && !isProcessing && (
        <div className="flex bg-slate-200/50 p-1.5 rounded-[1.75rem] mb-20 backdrop-blur-xl border border-white">
          {[
            { id: 'mic', label: 'In person', icon: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z' },
            { id: 'meeting', label: 'Virtual', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
            { id: 'call', label: 'Call', icon: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z' }
          ].map(mode => (
            (mode.id !== 'meeting' || isScreenCaptureSupported) && (
              <button
                key={mode.id}
                onClick={() => setInputMode(mode.id as InputMode)}
                className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-[13px] font-bold transition-all duration-300 ${
                  inputMode === mode.id ? 'bg-white text-slate-900 shadow-lg shadow-black/5 ring-1 ring-black/5' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={mode.icon} />
                </svg>
                {mode.label}
              </button>
            )
          ))}
        </div>
      )}

      <div className="relative mb-16 group">
        {isRecording && (
          <svg className="absolute -inset-4 w-[calc(100%+2rem)] h-[calc(100%+2rem)] -rotate-90 pointer-events-none z-0">
            <circle cx="50%" cy="50%" r="48%" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-slate-200" />
            <circle cx="50%" cy="50%" r="48%" fill="none" stroke="url(#gradient)" strokeWidth="2.5" strokeDasharray="301.59" strokeDashoffset={301.59 - (301.59 * progressPercent) / 100} strokeLinecap="round" className="transition-all duration-1000" />
            <defs><linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#d97706" /><stop offset="100%" stopColor="#fbbf24" /></linearGradient></defs>
          </svg>
        )}

        {isRecording && (
          <>
            <div className="absolute inset-0 bg-amber-400 rounded-full opacity-30 blur-3xl animate-soft-pulse scale-150"></div>
            <div className="absolute inset-4 bg-yellow-300 rounded-full opacity-20 blur-2xl animate-soft-pulse delay-700"></div>
            <div className="absolute -inset-8 border border-amber-500/5 rounded-full animate-[spin_12s_linear_infinite]"></div>
          </>
        )}

        <div className="relative z-10">
          {!isRecording ? (
            <button onClick={startRecording} disabled={isProcessing} className={`w-52 h-52 rounded-full flex flex-col items-center justify-center transition-all duration-700 ${isProcessing ? 'bg-slate-50 border border-slate-100' : 'bg-white shadow-[0_32px_80px_rgba(0,0,0,0.06)] hover:shadow-[0_40px_90px_rgba(0,0,0,0.1)] border border-slate-100 hover:scale-105 active:scale-95'}`}>
              {isProcessing ? (
                <div className="flex flex-col items-center">
                  <div className="flex gap-1.5 mb-4">
                    <div className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                    <div className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    <div className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                  </div>
                  <span className="text-[10px] font-bold text-slate-400">Processing</span>
                </div>
              ) : (
                <>
                  <div className="w-16 h-16 bg-gradient-to-br from-amber-50 to-yellow-50 rounded-3xl flex items-center justify-center mb-4 text-amber-600 shadow-inner">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                  </div>
                  <span className="text-[11px] font-extrabold text-slate-400 ml-1">Begin capture</span>
                </>
              )}
            </button>
          ) : (
            <div className="w-52 h-52 rounded-full bg-slate-900 shadow-2xl flex flex-col items-center justify-center relative overflow-hidden ring-4 ring-white">
               <div className="absolute inset-0 flex items-center justify-center gap-1.5 opacity-30 px-6">
                 {[...Array(14)].map((_, i) => (
                   <div key={i} className="w-1.5 bg-amber-400 rounded-full animate-pulse" style={{ height: `${25 + Math.random() * 65}%`, animationDuration: `${0.4 + Math.random() * 0.8}s` }}></div>
                 ))}
               </div>
               <h2 className="text-4xl font-mono text-white tracking-tighter tabular-nums z-10 mb-1">{formatTime(timer)}</h2>
               <div className={`text-[10px] font-extrabold z-10 transition-colors duration-500 ${getRemainingColor()}`}>Rem: {formatTime(remainingTime)}</div>
               <button onClick={stopRecording} className="absolute bottom-6 px-7 py-2.5 bg-white/10 hover:bg-white text-white hover:text-slate-900 backdrop-blur-md rounded-2xl text-[10px] font-extrabold transition-all z-10 border border-white/10 active:scale-95">Finish</button>
            </div>
          )}
        </div>
      </div>

      <div className="text-center max-w-sm">
        <h3 className="text-2xl font-bold text-slate-800 mb-3 tracking-tight">{isRecording ? "Capturing intelligence" : isProcessing ? "Synthesizing insights" : "Voice-to-notion"}</h3>
        <p className="text-slate-400 font-medium text-sm leading-relaxed">{isRecording ? "Your conversation is being monitored by Gemini 2.5 flash for real-time extraction." : "Convert any multilingual dialogue into structured documentation with zero effort."}</p>
      </div>
    </div>
  );
};

export default AudioRecorder;