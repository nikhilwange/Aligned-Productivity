import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

interface DictationViewProps {
    onRecordingComplete: (transcript: string, audioBlob?: Blob) => void;
    onCancel: () => void;
}

const DictationView: React.FC<DictationViewProps> = ({ onRecordingComplete, onCancel }) => {
    const [status, setStatus] = useState<'connecting' | 'listening' | 'processing' | 'error'>('connecting');
    const [transcript, setTranscript] = useState<string>('');
    const [volume, setVolume] = useState(0);
    const [retryCount, setRetryCount] = useState(0);

    // Use ref to track status for use inside callbacks (avoids stale closure)
    const statusRef = useRef(status);
    useEffect(() => { statusRef.current = status; }, [status]);

    // Audio context and processing refs
    const inputContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const sessionRef = useRef<any>(null);
    const accumulatedTranscriptRef = useRef<string>('');
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    useEffect(() => {
        let isMounted = true;

        const init = async () => {
            try {
                const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string;

                if (!apiKey) {
                    console.error("API Key missing");
                    setStatus('error');
                    return;
                }

                const ai = new GoogleGenAI({ apiKey: apiKey! });

                // Setup Audio Context
                const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                inputContextRef.current = new AudioContextClass({ sampleRate: 16000 });

                // Connect to Gemini Live
                const sessionPromise = ai.live.connect({
                    model: 'gemini-2.5-flash',
                    callbacks: {
                        onopen: async () => {
                            if (!isMounted) return;

                            // Start Microphone
                            try {
                                const stream = await navigator.mediaDevices.getUserMedia({
                                    audio: {
                                        echoCancellation: true,
                                        noiseSuppression: true,
                                        sampleRate: 16000
                                    }
                                });

                                // Start local recording as fallback
                                const mediaRecorder = new MediaRecorder(stream);
                                mediaRecorderRef.current = mediaRecorder;
                                audioChunksRef.current = [];

                                mediaRecorder.ondataavailable = (event) => {
                                    if (event.data.size > 0) {
                                        audioChunksRef.current.push(event.data);
                                    }
                                };
                                mediaRecorder.start();

                                sourceRef.current = inputContextRef.current!.createMediaStreamSource(stream);
                                processorRef.current = inputContextRef.current!.createScriptProcessor(4096, 1, 1);

                                processorRef.current.onaudioprocess = (e) => {
                                    const data = e.inputBuffer.getChannelData(0);

                                    // Calculate volume for UI visualizer
                                    const rms = Math.sqrt(data.reduce((a, b) => a + b * b, 0) / data.length);
                                    setVolume(rms * 5);

                                    // Send audio to Gemini - use ref to get current status (not stale closure)
                                    if (sessionRef.current && statusRef.current === 'listening') {
                                        sessionRef.current.then((s: any) => {
                                            try {
                                                s.sendRealtimeInput({
                                                    media: {
                                                        data: encode(new Int16Array(data.map(v => v * 32768)).buffer),
                                                        mimeType: 'audio/pcm;rate=16000'
                                                    }
                                                });
                                            } catch (e) {
                                                console.warn("Failed to send audio", e);
                                            }
                                        }).catch(() => {
                                            // Ignore promise rejections from connection
                                        });
                                    }
                                };

                                sourceRef.current.connect(processorRef.current);
                                // Keep graph alive
                                const gainNode = inputContextRef.current!.createGain();
                                gainNode.gain.value = 0;
                                processorRef.current.connect(gainNode);
                                gainNode.connect(inputContextRef.current!.destination);

                                setStatus('listening');
                            } catch (err) {
                                console.error("Mic access denied or error", err);
                                setStatus('error');
                            }
                        },
                        onmessage: (m: LiveServerMessage) => {
                            if (!isMounted) return;

                            if (m.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
                                // Ignore model audio output
                            }

                            // Handle User Transcription (what we speak)
                            if (m.serverContent?.inputTranscription) {
                                const text = m.serverContent.inputTranscription.text;
                                if (text) {
                                    setTranscript(prev => prev + text);
                                    accumulatedTranscriptRef.current += text;
                                }
                            }
                        },
                        onclose: () => {
                            console.log("Session closed");
                        },
                        onerror: (err) => {
                            console.error("Session error", err);
                            if (isMounted) setStatus('error');
                        }
                    },
                    config: {
                        responseModalities: [Modality.TEXT],
                        inputAudioTranscription: {}
                    }
                });

                sessionRef.current = sessionPromise;
            } catch (e) {
                console.error("Dictation Init Error", e);
                if (isMounted) setStatus('error');
            }
        };

        init();

        return () => {
            isMounted = false;
            cleanup();
        };
    }, [retryCount]);

    const cleanup = () => {
        if (sourceRef.current) sourceRef.current.disconnect();
        if (processorRef.current) processorRef.current.disconnect();
        if (inputContextRef.current && inputContextRef.current.state !== 'closed') inputContextRef.current.close();
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
    };

    const handleStop = async () => {
        setStatus('processing');

        let finalBlob: Blob | undefined;

        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            const stopPromise = new Promise<Blob>((resolve) => {
                const recorder = mediaRecorderRef.current!;
                const chunks: Blob[] = [...audioChunksRef.current];

                const dataHandler = (e: BlobEvent) => {
                    if (e.data.size > 0) chunks.push(e.data);
                };
                recorder.addEventListener('dataavailable', dataHandler);

                recorder.onstop = () => {
                    const blob = new Blob(chunks, { type: 'audio/webm' });
                    recorder.removeEventListener('dataavailable', dataHandler);
                    resolve(blob);
                };

                recorder.stop();
            });

            finalBlob = await stopPromise;
        }

        cleanup();
        onRecordingComplete(transcript || accumulatedTranscriptRef.current, finalBlob);
    };

    const handleRetry = () => {
        setStatus('connecting');
        setRetryCount(prev => prev + 1);
    };

    const encode = (b: any) => btoa(String.fromCharCode(...new Uint8Array(b)));

    return (
        <div className="absolute inset-0 z-50 bg-[var(--surface-950)] flex flex-col h-full animate-fade-in">
            {/* Ambient background */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] rounded-full bg-purple-600/10 blur-[150px] animate-pulse-glow"></div>
                <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-teal-500/10 blur-[120px] animate-pulse-glow" style={{ animationDelay: '1s' }}></div>
            </div>

            {/* Header */}
            <div className="absolute top-0 left-0 right-0 p-4 md:p-6 flex justify-between items-center z-20">
                <button onClick={onCancel} className="p-2.5 rounded-xl glass glass-hover text-white/50 hover:text-white transition-all active:scale-95">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <div className={`px-4 py-2 rounded-xl text-xs font-bold tracking-wide uppercase transition-all ${
                    status === 'listening'
                        ? 'bg-red-500/20 text-red-400 border border-red-500/20'
                        : status === 'processing'
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/20'
                            : status === 'error'
                                ? 'bg-red-500/20 text-red-400 border border-red-500/20'
                                : 'glass text-white/50'
                }`}>
                    <div className="flex items-center gap-2">
                        {status === 'listening' && (
                            <div className="relative">
                                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                                <div className="absolute inset-0 w-2 h-2 rounded-full bg-red-500 animate-ping"></div>
                            </div>
                        )}
                        {status === 'listening' ? 'Recording' : status === 'processing' ? 'Enhancing' : status === 'error' ? 'Error' : 'Connecting'}
                    </div>
                </div>

                <div className="w-10"></div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full pt-20 md:pt-24 px-4 md:px-6 pb-40 md:pb-48 overflow-y-auto scrollbar-hide relative z-10">
                {transcript ? (
                    <div className="text-xl md:text-3xl font-medium text-white/90 leading-relaxed">
                        {transcript}
                        {status === 'listening' && (
                            <span className="inline-block w-0.5 h-7 bg-purple-400 ml-1 animate-pulse align-middle rounded-full"></span>
                        )}
                    </div>
                ) : status === 'error' ? (
                    <div className="flex-1 flex flex-col items-center justify-center">
                        <div className="w-20 h-20 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6">
                            <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.962-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                        </div>
                        <p className="text-xl font-semibold text-red-400 mb-2">Connection Failed</p>
                        <p className="text-sm text-[var(--text-muted)] mb-8 text-center max-w-sm">Could not connect to AI. Check your internet connection or microphone permissions.</p>
                        <button
                            onClick={handleRetry}
                            className="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95"
                        >
                            Try Again
                        </button>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center">
                        <div className="relative mb-6">
                            {status === 'listening' && (
                                <div className="absolute -inset-4 rounded-full bg-gradient-to-br from-red-500/20 to-purple-500/20 blur-2xl animate-pulse-glow"></div>
                            )}
                            <div className={`relative w-20 h-20 rounded-2xl flex items-center justify-center transition-all ${
                                status === 'listening' ? 'bg-red-500/10 border border-red-500/20' : 'glass-card'
                            }`}>
                                <svg className={`w-10 h-10 ${status === 'listening' ? 'text-red-400' : 'text-[var(--text-tertiary)] opacity-40'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                </svg>
                            </div>
                        </div>
                        <p className={`text-xl font-semibold mb-2 ${status === 'listening' ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] opacity-40'}`}>
                            {status === 'listening' ? 'Listening...' : 'Connecting...'}
                        </p>
                        <p className="text-sm text-[var(--text-tertiary)] opacity-30">
                            {status === 'listening' ? 'Speak naturally — AI will transcribe in real time' : 'Setting up microphone and AI connection'}
                        </p>
                    </div>
                )}
            </div>

            {/* Bottom Control */}
            <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8 pb-10 md:pb-14 flex flex-col items-center bg-gradient-to-t from-[var(--surface-950)] via-[var(--surface-950)]/90 to-transparent z-20">
                <div className="relative group">
                    {/* Visualizer Ring */}
                    {status === 'listening' && (
                        <>
                            <div
                                className="absolute inset-0 rounded-full bg-gradient-to-r from-purple-500 to-teal-500 opacity-30 blur-xl transition-transform duration-100"
                                style={{ transform: `scale(${1 + volume * 0.3})` }}
                            ></div>
                            <div
                                className="absolute -inset-4 rounded-full border border-purple-500/20 transition-transform duration-100"
                                style={{ transform: `scale(${1 + volume * 0.15})` }}
                            ></div>
                        </>
                    )}

                    <button
                        onClick={status === 'listening' ? handleStop : status === 'error' ? handleRetry : undefined}
                        disabled={status === 'processing' || status === 'connecting'}
                        className={`relative w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 active:scale-95 disabled:opacity-50 ${
                            status === 'listening'
                                ? 'bg-gradient-to-br from-red-500 to-red-600 text-white hover:from-red-400 hover:to-red-500'
                                : status === 'error'
                                    ? 'bg-gradient-to-br from-amber-500 to-amber-600 text-white'
                                    : 'glass-card text-white'
                        }`}
                    >
                        {status === 'listening' ? (
                            <div className="w-6 h-6 rounded-md bg-white shadow-lg"></div>
                        ) : status === 'processing' ? (
                            <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        ) : status === 'error' ? (
                            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        ) : (
                            <div className="flex gap-1">
                                <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                                <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                            </div>
                        )}
                    </button>
                </div>

                {/* Label below button */}
                <p className="mt-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                    {status === 'listening' ? 'Tap to Stop' : status === 'processing' ? 'Processing...' : status === 'error' ? 'Tap to Retry' : 'Connecting...'}
                </p>
            </div>
        </div>
    );
};

export default DictationView;
