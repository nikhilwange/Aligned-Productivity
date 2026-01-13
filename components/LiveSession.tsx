import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

interface LiveSessionProps {
  onEndSession: () => void;
}

interface TranscriptMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  isFinal: boolean;
}

const LiveSession: React.FC<LiveSessionProps> = ({ onEndSession }) => {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'disconnected'>('connecting');
  const [volume, setVolume] = useState(0);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionRef = useRef<any>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    let isMounted = true;
    const init = async () => {
      try {
        const apiKey = process.env.API_KEY;
        const ai = new GoogleGenAI({ apiKey: apiKey! });
        inputContextRef.current = new AudioContext({ sampleRate: 16000 });
        outputContextRef.current = new AudioContext({ sampleRate: 24000 });
        const sessionPromise = ai.live.connect({
          model: 'gemini-2.5-flash-native-audio-preview-12-2025',
          callbacks: {
            onopen: async () => {
              if (!isMounted) return;
              setStatus('connected');
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              const source = inputContextRef.current!.createMediaStreamSource(stream);
              const processor = inputContextRef.current!.createScriptProcessor(4096, 1, 1);
              processor.onaudioprocess = (e) => {
                const data = e.inputBuffer.getChannelData(0);
                const rms = Math.sqrt(data.reduce((a, b) => a + b*b, 0) / data.length);
                setVolume(rms * 5);
                sessionPromise.then(s => s.sendRealtimeInput({ media: { data: encode(new Int16Array(data.map(v => v * 32768)).buffer), mimeType: 'audio/pcm;rate=16000' } }));
              };
              source.connect(processor);
              processor.connect(inputContextRef.current!.destination);
            },
            onmessage: async (m: LiveServerMessage) => {
              if (m.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
                const audio = await decodeAudioData(decode(m.serverContent.modelTurn.parts[0].inlineData.data), outputContextRef.current!, 24000, 1);
                const src = outputContextRef.current!.createBufferSource();
                src.buffer = audio;
                src.connect(outputContextRef.current!.destination);
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputContextRef.current!.currentTime);
                src.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audio.duration;
              }
              if (m.serverContent?.outputTranscription) updateTranscript('model', m.serverContent.outputTranscription.text, m.serverContent.turnComplete || false);
              if (m.serverContent?.inputTranscription) updateTranscript('user', m.serverContent.inputTranscription.text, m.serverContent.turnComplete || false);
            }
          },
          config: { responseModalities: [Modality.AUDIO], inputAudioTranscription: {}, outputAudioTranscription: {}, systemInstruction: "Be a friendly voice companion." }
        });
        sessionRef.current = sessionPromise;
      } catch (e) { setStatus('error'); }
    };
    init();
    return () => { isMounted = false; };
  }, []);

  const updateTranscript = (role: 'user' | 'model', text: string, isFinal: boolean) => {
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && !last.isFinal) {
        const next = [...prev];
        next[next.length - 1] = { ...last, text: last.text + text, isFinal };
        return next;
      }
      return [...prev, { id: Math.random().toString(), role, text, isFinal }];
    });
  };

  const encode = (b: any) => btoa(String.fromCharCode(...new Uint8Array(b)));
  const decode = (s: string) => new Uint8Array(atob(s).split('').map(c => c.charCodeAt(0)));
  async function decodeAudioData(d: Uint8Array, ctx: AudioContext, r: number, c: number): Promise<AudioBuffer> {
    const int16 = new Int16Array(d.buffer);
    const buf = ctx.createBuffer(c, int16.length/c, r);
    for (let ch = 0; ch < c; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = int16[i*c + ch] / 32768;
    }
    return buf;
  }

  return (
    <div className="relative w-full h-full bg-[#020617] flex flex-col overflow-hidden text-slate-50">
      <div className="absolute inset-0 bg-gradient-to-b from-amber-500/10 via-transparent to-transparent pointer-events-none"></div>
      <div className="relative z-10 flex items-center justify-between p-8">
        <div className="flex items-center gap-3 px-4 py-2 bg-white/5 backdrop-blur-xl rounded-full border border-white/10">
          <div className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'}`}></div>
          <span className="text-[10px] font-bold text-slate-300">
            {status === 'connected' ? 'Live mode' : 'Connecting...'}
          </span>
        </div>
        <button onClick={onEndSession} className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl transition-all"><svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/></svg></button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center relative">
        <div className="relative group">
           <div className="absolute inset-0 bg-amber-500/20 blur-[120px] rounded-full animate-soft-pulse" style={{ transform: `scale(${1 + volume})` }}></div>
           <div className="relative w-48 h-48 md:w-64 md:h-64 rounded-full border border-white/10 bg-gradient-to-br from-white/10 to-transparent flex items-center justify-center backdrop-blur-md transition-transform duration-75" style={{ transform: `scale(${1 + volume * 0.2})` }}>
              <div className="w-12 h-12 bg-white rounded-full shadow-[0_0_40px_rgba(255,255,255,0.3)]"></div>
              <div className="absolute inset-4 border border-amber-500/20 rounded-full animate-[spin_10s_linear_infinite]"></div>
           </div>
        </div>
        <p className="mt-12 text-amber-400/60 font-bold tracking-[0.2em] text-[10px]">Speak naturally</p>
      </div>

      <div className="h-[250px] bg-slate-900/40 backdrop-blur-2xl border-t border-white/5 p-8 overflow-y-auto scrollbar-hide relative z-20">
         <div className="max-w-3xl mx-auto space-y-6 pb-4">
           {messages.map(m => (
             <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2`}>
               <div className={`px-4 py-2.5 rounded-2xl text-sm ${m.role === 'user' ? 'bg-amber-500/10 text-amber-200 border border-amber-500/20' : 'bg-white/5 text-slate-300'}`}>{m.text}</div>
               <span className="text-[9px] font-bold text-slate-600 mt-2 px-1">{m.role === 'user' ? 'You' : 'Gemini'}</span>
             </div>
           ))}
           {messages.length === 0 && <p className="text-center text-slate-600 text-[11px] font-bold pt-10">Start talking to see transcript</p>}
           <div ref={transcriptEndRef} />
         </div>
      </div>
    </div>
  );
};

export default LiveSession;