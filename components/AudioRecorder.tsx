import React, { useState, useRef, useEffect } from 'react';
import { AppState, AudioRecording } from '../types';
import { isNativeApp } from '../services/nativePermissions';

interface AudioRecorderProps {
  appState: AppState;
  setAppState: (state: AppState) => void;
  onRecordingComplete: (recording: AudioRecording) => void;
  transcriptionEngine: 'gemini' | 'sarvam';
  onEngineChange: (engine: 'gemini' | 'sarvam') => void;
  hasSarvamKey: boolean;
}

type InputMode = 'mic' | 'meeting' | 'call';

const MAX_RECORDING_SECONDS = 7200; // 2 Hours limit for API stability

const AudioRecorder: React.FC<AudioRecorderProps> = ({ appState, setAppState, onRecordingComplete, transcriptionEngine, onEngineChange, hasSarvamKey }) => {
  const [timer, setTimer] = useState(0);
  const [inputMode, setInputMode] = useState<InputMode>('mic');
  const [isScreenCaptureSupported, setIsScreenCaptureSupported] = useState<boolean>(true);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const durationRef = useRef<number>(0);
  const sourceStreamsRef = useRef<MediaStream[]>([]);

  useEffect(() => {
    const isMobile = isNativeApp() || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
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
    if (remainingTime < 120) return 'text-red-400';
    if (remainingTime < 600) return 'text-amber-400';
    return 'text-[var(--text-muted)]';
  };

  const inputModes = [
    { id: 'mic', label: 'In Person', icon: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z', color: 'purple' },
    { id: 'meeting', label: 'Virtual', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', color: 'teal' },
    { id: 'call', label: 'Call', icon: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z', color: 'amber' }
  ];

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-xl mx-auto p-4 animate-fade-in-up h-full md:h-auto">
      {/* Recording Status Badge */}
      {isRecording && (
        <div className="mb-10 animate-fade-in-down">
          <div className="flex items-center gap-3 px-5 py-3 glass-card rounded-2xl">
            <div className="relative">
              <div className="absolute inset-0 bg-red-500 rounded-full animate-ping opacity-40"></div>
              <div className="relative w-2.5 h-2.5 bg-red-500 rounded-full"></div>
            </div>
            <span className="text-xs font-semibold text-[var(--text-secondary)] tracking-wide">
              High-precision active session
            </span>
          </div>
        </div>
      )}

      {/* Engine Selector */}
      {!isRecording && !isProcessing && hasSarvamKey && (
        <div className="flex justify-center gap-1.5 glass-card p-1.5 rounded-xl mb-4 md:mb-6">
          <button
            onClick={() => onEngineChange('gemini')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-300 ${
              transcriptionEngine === 'gemini'
                ? 'bg-teal-500/20 text-teal-600 shadow-lg shadow-teal-500/10'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-black/5'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400"></span>
            Gemini
          </button>
          <button
            onClick={() => onEngineChange('sarvam')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-300 ${
              transcriptionEngine === 'sarvam'
                ? 'bg-amber-500/20 text-amber-600 shadow-lg shadow-amber-500/10'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-black/5'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
            Sarvam
          </button>
        </div>
      )}

      {/* Engine label */}
      {!isRecording && !isProcessing && transcriptionEngine === 'sarvam' && hasSarvamKey && (
        <p className="text-[10px] font-semibold text-amber-500/60 uppercase tracking-wider mb-4 md:mb-6">
          Hindi / Marathi optimized transcription
        </p>
      )}

      {/* Input Mode Selector */}
      {!isRecording && !isProcessing && (
        <div className="flex flex-wrap justify-center gap-2 glass-card p-2 rounded-2xl mb-12 md:mb-16 max-w-full">
          {inputModes.map(mode => (
            (mode.id !== 'meeting' || isScreenCaptureSupported) && (
              <button
                key={mode.id}
                onClick={() => setInputMode(mode.id as InputMode)}
                className={`flex items-center gap-2.5 px-5 md:px-6 py-3 rounded-xl text-sm font-semibold transition-all duration-300 ${
                  inputMode === mode.id 
                    ? mode.color === 'purple' 
                      ? 'bg-purple-500/20 text-purple-600 shadow-lg shadow-purple-500/10' 
                      : mode.color === 'teal'
                        ? 'bg-teal-500/20 text-teal-600 shadow-lg shadow-teal-500/10'
                        : 'bg-amber-500/20 text-amber-600 shadow-lg shadow-amber-500/10'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-black/5'
                  }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={mode.icon} />
                </svg>
                {mode.label}
              </button>
            )
          ))}
        </div>
      )}

      {/* Main Recording Button */}
      <div className="relative mb-16 group">
        {/* Progress Ring for Recording */}
        {isRecording && (
          <svg className="absolute -inset-6 w-[calc(100%+3rem)] h-[calc(100%+3rem)] -rotate-90 pointer-events-none z-0">
            <circle cx="50%" cy="50%" r="48%" fill="none" stroke="currentColor" strokeWidth="3" className="text-white/10" />
            <circle 
              cx="50%" cy="50%" r="48%" 
              fill="none" 
              stroke="url(#progressGradient)" 
              strokeWidth="3" 
              strokeDasharray="301.59" 
              strokeDashoffset={301.59 - (301.59 * progressPercent) / 100} 
              strokeLinecap="round" 
              className="transition-all duration-1000" 
            />
            <defs>
              <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#a855f7" />
                <stop offset="50%" stopColor="#14b8a6" />
                <stop offset="100%" stopColor="#f59e0b" />
              </linearGradient>
            </defs>
          </svg>
        )}

        {/* Glow effects for recording */}
        {isRecording && (
          <>
            <div className="absolute inset-0 bg-purple-500 rounded-full opacity-20 blur-[60px] animate-pulse-glow scale-150"></div>
            <div className="absolute inset-4 bg-teal-400 rounded-full opacity-15 blur-[40px] animate-pulse-glow" style={{ animationDelay: '0.5s' }}></div>
            <div className="absolute -inset-12 border border-purple-500/10 rounded-full animate-rotate-slow"></div>
          </>
        )}

        <div className="relative z-10">
          {!isRecording ? (
            <button 
              onClick={startRecording} 
              disabled={isProcessing} 
              className={`w-56 h-56 rounded-full flex flex-col items-center justify-center transition-all duration-500 group ${
                isProcessing 
                  ? 'glass cursor-wait' 
                  : 'glass-card hover:scale-105 active:scale-95 cursor-pointer'
              }`}
            >
              {isProcessing ? (
                <div className="flex flex-col items-center">
                  <div className="flex gap-2 mb-4">
                    <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                    <div className="w-3 h-3 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    <div className="w-3 h-3 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                  </div>
                  <span className="text-xs font-semibold text-[var(--text-muted)]">Processing</span>
                </div>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-teal-500/20 flex items-center justify-center mb-4 text-purple-600 group-hover:scale-110 transition-transform duration-300">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  </div>
                  <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Begin Capture</span>
                </>
              )}
            </button>
          ) : (
            <div className="w-56 h-56 rounded-full bg-gradient-to-br from-[var(--surface-800)] to-[var(--surface-900)] shadow-2xl flex flex-col items-center justify-center relative overflow-hidden ring-2 ring-purple-500/30">
              {/* Audio visualizer bars */}
              <div className="absolute inset-0 flex items-center justify-center gap-1.5 opacity-40 px-10">
                {[...Array(16)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1.5 rounded-full transition-all"
                    style={{
                      height: `${20 + Math.random() * 60}%`,
                      background: `linear-gradient(180deg, #a855f7 0%, #14b8a6 50%, #f59e0b 100%)`,
                      animationDuration: `${0.3 + Math.random() * 0.5}s`,
                      animation: 'wave ease-in-out infinite',
                      animationDelay: `${i * 0.05}s`
                    }}
                  ></div>
                ))}
              </div>

              {/* Timer */}
              <h2 className="text-5xl font-mono text-[var(--text-primary)] tracking-tighter tabular-nums z-10 mb-1 font-semibold">{formatTime(timer)}</h2>
              <div className={`text-[10px] font-bold z-10 transition-colors duration-500 ${getRemainingColor()}`}>
                {formatTime(remainingTime)} remaining
              </div>

              {/* Stop button */}
              <button
                onClick={stopRecording}
                className="absolute bottom-6 px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white backdrop-blur-md rounded-xl text-xs font-bold transition-all z-10 shadow-lg shadow-purple-500/25 active:scale-95"
              >
                Finish
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="text-center max-w-sm">
        <h3 className="text-2xl font-bold text-[var(--text-primary)] mb-3 tracking-tight">
          {isRecording ? "Capturing intelligence" : isProcessing ? "Synthesizing insights" : "Structured Intelligence"}
        </h3>
        <p className="text-[var(--text-tertiary)] font-medium text-sm leading-relaxed">
          {isRecording 
            ? "Your conversation is being analyzed by Gemini 2.5 for real-time extraction." 
            : "Transform any multilingual dialogue into structured documentation with zero effort."
          }
        </p>
      </div>
    </div>
  );
};

export default AudioRecorder;
