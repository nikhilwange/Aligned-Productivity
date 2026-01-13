import React, { useState, useRef, useEffect } from 'react';
import { AppState, AudioRecording } from '../types';

interface AudioRecorderProps {
  appState: AppState;
  setAppState: (state: AppState) => void;
  onRecordingComplete: (recording: AudioRecording) => void;
}

type InputMode = 'mic' | 'meeting' | 'call';

const MAX_RECORDING_SECONDS = 7200;

const AudioRecorder: React.FC<AudioRecorderProps> = ({ appState, setAppState, onRecordingComplete }) => {
  const [timer, setTimer] = useState(0);
  const [inputMode, setInputMode] = useState<InputMode>('mic');
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const durationRef = useRef<number>(0);
  const sourceStreamsRef = useRef<MediaStream[]>([]);

  useEffect(() => {
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      sourceStreamsRef.current = [stream];
      
      const mediaRecorder = new MediaRecorder(stream, { audioBitsPerSecond: 128000 });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
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

  const isRecording = appState === AppState.RECORDING;
  const isProcessing = appState === AppState.PROCESSING;

  return (
    <div className="flex flex-col items-center justify-center w-full animate-fade max-w-lg mx-auto">
      {!isRecording && !isProcessing && (
        <div className="flex bg-[#F8FAFC] p-2 rounded-[2rem] mb-16 border border-slate-50 shadow-inner">
          {[
            { id: 'mic', label: 'In person' },
            { id: 'meeting', label: 'Virtual' },
            { id: 'call', label: 'Call' }
          ].map(mode => (
            <button
              key={mode.id}
              onClick={() => setInputMode(mode.id as InputMode)}
              className={`px-10 py-3.5 rounded-[1.5rem] text-[13px] font-black transition-all ${
                inputMode === mode.id ? 'bg-[#7FA9F5] text-white shadow-xl shadow-[#7FA9F5]/30' : 'text-slate-400 hover:text-slate-900'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      )}

      <div className="relative mb-14">
        <div className="w-64 h-64 rounded-full nik-card-dark flex flex-col items-center justify-center shadow-2xl shadow-black/40 relative z-10 transition-transform duration-500 hover:scale-105">
          {isProcessing ? (
             <div className="flex flex-col items-center gap-4">
               <div className="flex gap-2">
                 <div className="w-3 h-3 bg-[#7FA9F5] rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                 <div className="w-3 h-3 bg-[#7FA9F5] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                 <div className="w-3 h-3 bg-[#7FA9F5] rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
               </div>
               <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Synthesizing</span>
             </div>
          ) : isRecording ? (
            <>
              <h2 className="text-6xl font-black tracking-tighter text-white tabular-nums mb-4">{formatTime(timer)}</h2>
              <button onClick={stopRecording} className="px-8 py-2.5 bg-[#7FA9F5] text-white rounded-xl text-xs font-black transition-all hover:bg-white hover:text-[#1C1C1C] active:scale-95 shadow-lg shadow-[#7FA9F5]/30">Stop recording</button>
            </>
          ) : (
            <button onClick={startRecording} className="w-24 h-24 bg-[#7FA9F5] rounded-[2rem] flex items-center justify-center text-white shadow-2xl shadow-[#7FA9F5]/40 hover:scale-110 active:scale-90 transition-all">
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
            </button>
          )}
        </div>
        {isRecording && (
          <div className="absolute inset-0 bg-[#7FA9F5]/20 rounded-full blur-[80px] animate-pulse"></div>
        )}
      </div>

      <div className="text-center">
        <h3 className="text-2xl font-black text-[#1C1C1C] mb-2 tracking-tight">{isRecording ? "Live Insight Engine" : isProcessing ? "Structuring Knowledge" : "Ready to Start"}</h3>
        <p className="text-sm font-semibold text-slate-400 max-w-[280px] mx-auto leading-relaxed">High-fidelity multilingual capture powered by Gemini-3 logic.</p>
      </div>
    </div>
  );
};

export default AudioRecorder;