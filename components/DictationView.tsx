import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

interface DictationViewProps {
    onRecordingComplete: (transcript: string, audioBlob?: Blob) => void;
    onCancel: () => void;
    transcriptionEngine: 'gemini' | 'sarvam';
}

const DictationView: React.FC<DictationViewProps> = ({ onRecordingComplete, onCancel, transcriptionEngine }) => {
    const [status, setStatus] = useState<'idle' | 'connecting' | 'listening' | 'processing' | 'error'>('idle');
    const [transcript, setTranscript] = useState<string>('');
    const [volume, setVolume] = useState(0);
    const [connectCount, setConnectCount] = useState(0);

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
    const sarvamWsRef = useRef<WebSocket | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);

    // Helper: base64 encode
    const encode = (b: any) => btoa(String.fromCharCode(...new Uint8Array(b)));

    // Setup mic and audio processor (shared by both engines)
    const setupMicrophone = async (audioContext: AudioContext): Promise<MediaStream> => {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 16000,
            }
        });

        micStreamRef.current = stream;

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

        sourceRef.current = audioContext.createMediaStreamSource(stream);
        processorRef.current = audioContext.createScriptProcessor(4096, 1, 1);

        sourceRef.current.connect(processorRef.current);
        // Keep graph alive
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 0;
        processorRef.current.connect(gainNode);
        gainNode.connect(audioContext.destination);

        return stream;
    };

    // Gemini Live init
    const initGemini = async (isMountedRef: { current: boolean }) => {
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string;
        if (!apiKey) {
            console.error("Gemini API Key missing");
            setStatus('error');
            return;
        }

        const ai = new GoogleGenAI({ apiKey });
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        inputContextRef.current = new AudioContextClass({ sampleRate: 16000 });

        const sessionPromise = ai.live.connect({
            model: 'gemini-2.5-flash',
            callbacks: {
                onopen: async () => {
                    if (!isMountedRef.current) return;
                    try {
                        await setupMicrophone(inputContextRef.current!);

                        processorRef.current!.onaudioprocess = (e) => {
                            const data = e.inputBuffer.getChannelData(0);
                            const rms = Math.sqrt(data.reduce((a, b) => a + b * b, 0) / data.length);
                            setVolume(rms * 5);

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
                                }).catch(() => { });
                            }
                        };

                        setStatus('listening');
                    } catch (err) {
                        console.error("Mic access denied or error", err);
                        setStatus('error');
                    }
                },
                onmessage: (m: LiveServerMessage) => {
                    if (!isMountedRef.current) return;
                    if (m.serverContent?.inputTranscription) {
                        const text = m.serverContent.inputTranscription.text;
                        if (text) {
                            setTranscript(prev => prev + text);
                            accumulatedTranscriptRef.current += text;
                        }
                    }
                },
                onclose: () => { console.log("Gemini session closed"); },
                onerror: (err) => {
                    console.error("Gemini session error", err);
                    if (isMountedRef.current) setStatus('error');
                }
            },
            config: {
                responseModalities: [Modality.TEXT],
                inputAudioTranscription: {}
            }
        });

        sessionRef.current = sessionPromise;
    };

    // Sarvam WebSocket init
    const initSarvam = async (isMountedRef: { current: boolean }) => {
        const apiKey = import.meta.env.VITE_SARVAM_API_KEY as string;
        if (!apiKey) {
            console.error("Sarvam API Key missing");
            setStatus('error');
            return;
        }

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        inputContextRef.current = new AudioContextClass({ sampleRate: 16000 });

        // Build WebSocket URL with query params
        const params = new URLSearchParams({
            'language-code': 'unknown',
            'model': 'saaras:v3',
            'input_audio_codec': 'pcm_s16le',
            'sample_rate': '16000',
            'high_vad_sensitivity': 'true',
            'vad_signals': 'true',
        });

        const wsUrl = `wss://api.sarvam.ai/speech-to-text/ws?${params.toString()}`;

        try {
            const ws = new WebSocket(wsUrl, [`api-subscription-key.${apiKey}`]);
            sarvamWsRef.current = ws;

            ws.onopen = async () => {
                if (!isMountedRef.current) return;
                console.log('[Sarvam WS] Connected');

                try {
                    await setupMicrophone(inputContextRef.current!);

                    processorRef.current!.onaudioprocess = (e) => {
                        const data = e.inputBuffer.getChannelData(0);
                        const rms = Math.sqrt(data.reduce((a, b) => a + b * b, 0) / data.length);
                        setVolume(rms * 5);

                        if (sarvamWsRef.current?.readyState === WebSocket.OPEN && statusRef.current === 'listening') {
                            try {
                                // Convert float32 to int16 PCM
                                const int16 = new Int16Array(data.length);
                                for (let i = 0; i < data.length; i++) {
                                    const clamped = Math.max(-1, Math.min(1, data[i]));
                                    int16[i] = clamped * 0x7fff;
                                }
                                const base64Audio = encode(int16.buffer);

                                // Send in Sarvam's expected format
                                sarvamWsRef.current.send(JSON.stringify({
                                    audio: {
                                        data: base64Audio,
                                        sample_rate: 16000,
                                        encoding: 'pcm_s16le',
                                    }
                                }));
                            } catch (e) {
                                console.warn("Failed to send audio to Sarvam", e);
                            }
                        }
                    };

                    setStatus('listening');
                } catch (err) {
                    console.error("Mic access denied or error", err);
                    setStatus('error');
                }
            };

            ws.onmessage = (event) => {
                if (!isMountedRef.current) return;
                try {
                    const data = JSON.parse(event.data);
                    // Handle transcript messages
                    if (data.type === 'transcript' && data.text) {
                        setTranscript(prev => prev + data.text + ' ');
                        accumulatedTranscriptRef.current += data.text + ' ';
                    } else if (data.type === 'translation' && data.text) {
                        // For translate mode (future use)
                        setTranscript(prev => prev + data.text + ' ');
                        accumulatedTranscriptRef.current += data.text + ' ';
                    } else if (data.transcript) {
                        // Alternative response format
                        setTranscript(prev => prev + data.transcript + ' ');
                        accumulatedTranscriptRef.current += data.transcript + ' ';
                    }
                } catch (e) {
                    console.warn('[Sarvam WS] Failed to parse message', e);
                }
            };

            ws.onclose = (event) => {
                console.log('[Sarvam WS] Closed', event.code, event.reason);
            };

            ws.onerror = (event) => {
                console.error('[Sarvam WS] Error', event);
                if (isMountedRef.current) setStatus('error');
            };
        } catch (e) {
            console.error("Sarvam WS Init Error", e);
            if (isMountedRef.current) setStatus('error');
        }
    };

    // Connection effect — runs when connectCount changes (triggered by Start or Retry)
    useEffect(() => {
        if (connectCount === 0) return; // Don't run on mount (idle state)

        const isMountedRef = { current: true };

        const init = async () => {
            try {
                if (transcriptionEngine === 'sarvam') {
                    await initSarvam(isMountedRef);
                } else {
                    await initGemini(isMountedRef);
                }
            } catch (e) {
                console.error("Dictation Init Error", e);
                if (isMountedRef.current) setStatus('error');
            }
        };

        init();

        return () => {
            isMountedRef.current = false;
            cleanup();
        };
    }, [connectCount]);

    const cleanup = () => {
        if (sourceRef.current) sourceRef.current.disconnect();
        if (processorRef.current) processorRef.current.disconnect();
        if (inputContextRef.current && inputContextRef.current.state !== 'closed') inputContextRef.current.close();
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        if (sarvamWsRef.current) {
            sarvamWsRef.current.close();
            sarvamWsRef.current = null;
        }
        if (micStreamRef.current) {
            micStreamRef.current.getTracks().forEach(t => t.stop());
            micStreamRef.current = null;
        }
    };

    const handleStop = async () => {
        setStatus('processing');

        // Close Sarvam WebSocket first to flush any pending transcripts
        if (sarvamWsRef.current && sarvamWsRef.current.readyState === WebSocket.OPEN) {
            // Send flush signal before closing
            try {
                sarvamWsRef.current.send(JSON.stringify({ type: 'flush' }));
            } catch { }
            // Give a brief moment for final transcripts
            await new Promise(resolve => setTimeout(resolve, 500));
            sarvamWsRef.current.close();
            sarvamWsRef.current = null;
        }

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

    const handleStart = () => {
        setStatus('connecting');
        setConnectCount(prev => prev + 1);
    };

    const handleRetry = () => {
        setStatus('connecting');
        setConnectCount(prev => prev + 1);
    };

    const isSarvam = transcriptionEngine === 'sarvam';

    return (
        <div className="absolute inset-0 z-50 bg-[var(--surface-950)] flex flex-col h-full animate-fade-in">
            {/* Ambient background */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className={`absolute top-1/4 left-1/4 w-[500px] h-[500px] rounded-full blur-[150px] animate-pulse-glow ${isSarvam ? 'bg-amber-600/10' : 'bg-purple-600/10'}`}></div>
                <div className={`absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full blur-[120px] animate-pulse-glow ${isSarvam ? 'bg-orange-500/10' : 'bg-teal-500/10'}`} style={{ animationDelay: '1s' }}></div>
            </div>

            {/* Header */}
            <div className="absolute top-0 left-0 right-0 p-4 md:p-6 flex justify-between items-center z-20">
                <button onClick={onCancel} className="p-2.5 rounded-xl glass glass-hover text-white/50 hover:text-white transition-all active:scale-95">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                {status !== 'idle' && (
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
                        {status === 'listening' ? (isSarvam ? 'Sarvam Live' : 'Recording') : status === 'processing' ? 'Enhancing' : status === 'error' ? 'Error' : 'Connecting'}
                    </div>
                </div>
                )}

                <div className="w-10"></div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full pt-20 md:pt-24 px-4 md:px-6 pb-40 md:pb-48 overflow-y-auto scrollbar-hide relative z-10">
                {status === 'idle' ? (
                    <div className="flex-1 flex flex-col items-center justify-center">
                        <div className="relative mb-8">
                            <div className={`absolute -inset-6 rounded-full blur-2xl animate-pulse-glow ${isSarvam ? 'bg-gradient-to-br from-amber-500/20 to-orange-500/20' : 'bg-gradient-to-br from-purple-500/20 to-teal-500/20'}`}></div>
                            <div className="relative w-24 h-24 rounded-3xl glass-card flex items-center justify-center">
                                <svg className="w-12 h-12 text-[var(--text-tertiary)] opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                </svg>
                            </div>
                        </div>
                        <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">Dictation</h2>
                        <p className="text-sm text-[var(--text-muted)] mb-2 text-center max-w-sm">Speak naturally and AI will transcribe and refine your text instantly</p>
                        {isSarvam && (
                            <p className="text-[10px] font-semibold text-amber-500/60 uppercase tracking-wider mb-8">Sarvam engine — Hindi / Marathi optimized</p>
                        )}
                        {!isSarvam && <div className="mb-10"></div>}
                        <button
                            onClick={handleStart}
                            className={`px-8 py-4 text-white font-bold rounded-2xl shadow-lg transition-all duration-300 active:scale-[0.97] flex items-center gap-3 text-base ${
                                isSarvam
                                    ? 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 shadow-amber-500/25'
                                    : 'bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 shadow-purple-500/25'
                            }`}
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                            </svg>
                            Start Dictation
                        </button>
                    </div>
                ) : transcript ? (
                    <div className="text-xl md:text-3xl font-medium text-white/90 leading-relaxed">
                        {transcript}
                        {status === 'listening' && (
                            <span className={`inline-block w-0.5 h-7 ml-1 animate-pulse align-middle rounded-full ${isSarvam ? 'bg-amber-400' : 'bg-purple-400'}`}></span>
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
                                <div className={`absolute -inset-4 rounded-full blur-2xl animate-pulse-glow ${isSarvam ? 'bg-gradient-to-br from-amber-500/20 to-orange-500/20' : 'bg-gradient-to-br from-red-500/20 to-purple-500/20'}`}></div>
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
                            {status === 'listening'
                                ? (isSarvam ? 'Sarvam AI is transcribing in real time' : 'Speak naturally — AI will transcribe in real time')
                                : (isSarvam ? 'Connecting to Sarvam AI...' : 'Setting up microphone and AI connection')
                            }
                        </p>
                    </div>
                )}
            </div>

            {/* Bottom Control - visible when recording is active */}
            {status !== 'idle' && (
            <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8 pb-10 md:pb-14 flex flex-col items-center bg-gradient-to-t from-[var(--surface-950)] via-[var(--surface-950)]/90 to-transparent z-20">
                <div className="relative group">
                    {/* Visualizer Ring */}
                    {status === 'listening' && (
                        <>
                            <div
                                className={`absolute inset-0 rounded-full opacity-30 blur-xl transition-transform duration-100 ${isSarvam ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-purple-500 to-teal-500'}`}
                                style={{ transform: `scale(${1 + volume * 0.3})` }}
                            ></div>
                            <div
                                className={`absolute -inset-4 rounded-full border transition-transform duration-100 ${isSarvam ? 'border-amber-500/20' : 'border-purple-500/20'}`}
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
            )}
        </div>
    );
};

export default DictationView;
