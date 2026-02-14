import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

interface FloatingHUDProps {
    onComplete: (text: string) => void;
    onCancel: () => void;
}

type HUDStatus = 'initializing' | 'ready' | 'recording' | 'stopping' | 'error';

/**
 * FloatingHUD - Premium session-based audio transcription overlay
 * 
 * FIXED v3: Direct IPC calls for immediate response
 */
const FloatingHUD: React.FC<FloatingHUDProps> = ({ onComplete, onCancel }) => {
    // Core state
    const [status, setStatus] = useState<HUDStatus>('initializing');
    const [transcript, setTranscript] = useState('');
    const [volume, setVolume] = useState(0);
    const [error, setError] = useState('');

    // Refs for cleanup
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const sessionRef = useRef<any>(null);
    const mountedRef = useRef(true);
    const transcriptBufferRef = useRef('');
    const statusRef = useRef<HUDStatus>('initializing');
    const isClosingRef = useRef(false); // Prevent any further actions once closing

    // Keep statusRef in sync
    useEffect(() => {
        statusRef.current = status;
    }, [status]);

    // Cleanup function
    const cleanup = useCallback(() => {
        console.log('[HUD] Running cleanup...');
        try {
            if (processorRef.current) {
                processorRef.current.disconnect();
                processorRef.current = null;
            }
            if (sourceRef.current) {
                sourceRef.current.disconnect();
                sourceRef.current = null;
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                audioContextRef.current.close().catch(() => {});
                audioContextRef.current = null;
            }
            if (sessionRef.current) {
                try {
                    sessionRef.current.close?.();
                } catch (e) {
                    // Ignore close errors
                }
                sessionRef.current = null;
            }
        } catch (e) {
            console.error('[HUD] Cleanup error:', e);
        }
    }, []);

    // Encode audio for Gemini
    const encodeAudio = useCallback((buffer: ArrayBuffer): string => {
        return btoa(String.fromCharCode(...new Uint8Array(buffer)));
    }, []);

    // DIRECT IPC call to hide window and paste - bypasses React callbacks for reliability
    const hideWindowAndPaste = useCallback((text: string) => {
        console.log('[HUD] 🔵 hideWindowAndPaste called with text length:', text?.length);
        console.log('[HUD] 🔵 Text preview:', text?.substring(0, 50));
        console.log('[HUD] 🔵 window.ipcRenderer exists?', !!window.ipcRenderer);
        
        if (window.ipcRenderer) {
            console.log('[HUD] 🔵 Sending paste-text IPC directly');
            window.ipcRenderer.send('paste-text', text || '');
            console.log('[HUD] 🔵 IPC send() completed');
        } else {
            console.error('[HUD] ❌ No ipcRenderer - using callback fallback');
            onComplete(text);
        }
    }, [onComplete]);

    // DIRECT IPC call to just hide window (cancel)
    const hideWindowOnly = useCallback(() => {
        console.log('[HUD] hideWindowOnly called');
        
        if (window.ipcRenderer) {
            console.log('[HUD] Sending hide-hud IPC directly');
            window.ipcRenderer.send('hide-hud');
        } else {
            console.error('[HUD] No ipcRenderer - using callback fallback');
            onCancel();
        }
    }, [onCancel]);

    // Stop recording and complete via callback
    const stopRecording = useCallback(() => {
        if (isClosingRef.current) {
            console.log('[HUD] Already closing, ignoring');
            return;
        }
        isClosingRef.current = true;
        
        console.log('[HUD] >>> STOP RECORDING <<<');
        console.log('[HUD] Current status:', statusRef.current);
        console.log('[HUD] isClosingRef:', isClosingRef.current);
        
        // Get text FIRST before any state changes
        const finalText = transcriptBufferRef.current.trim();
        console.log('[HUD] ✅ Final text captured:', finalText);
        console.log('[HUD] ✅ Text length:', finalText.length);
        
        // Update UI
        setStatus('stopping');
        console.log('[HUD] ✅ Status set to stopping');
        
        // Cleanup audio
        cleanup();
        console.log('[HUD] ✅ Cleanup completed');
        
        // Call React callback - let App.tsx handle IPC
        console.log('[HUD] ✅ About to call onComplete...');
        console.log('[HUD] ✅ onComplete type:', typeof onComplete);
        console.log('[HUD] ✅ finalText:', finalText);
        
        try {
            onComplete(finalText);
            console.log('[HUD] ✅ onComplete called successfully');
        } catch (error) {
            console.error('[HUD] ❌ onComplete threw error:', error);
        }
        
    }, [cleanup, onComplete]);

    // Cancel and close via callback
    const cancelRecording = useCallback(() => {
        if (isClosingRef.current) {
            console.log('[HUD] Already closing, ignoring');
            return;
        }
        isClosingRef.current = true;
        
        console.log('[HUD] >>> CANCEL RECORDING <<<');
        
        // Cleanup
        cleanup();
        
        // Call React callback - let App.tsx handle IPC
        onCancel();
        
    }, [cleanup, onCancel]);

    // Initialize audio session
    useEffect(() => {
        mountedRef.current = true;
        isClosingRef.current = false;
        let initialized = false;

        const initSession = async () => {
            try {
                console.log('[HUD] Initializing session...');
                setStatus('initializing');
                setTranscript('');
                setError('');
                transcriptBufferRef.current = '';

                const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string;
                if (!apiKey) {
                    throw new Error('Gemini API key not found');
                }

                const ai = new GoogleGenAI({ apiKey });

                const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                audioContextRef.current = new AudioContextClass({ sampleRate: 16000 });

                console.log('[HUD] Connecting to Gemini...');

                const session = await ai.live.connect({
                    model: 'gemini-2.0-flash-exp',
                    callbacks: {
                        onopen: async () => {
                            if (!mountedRef.current || isClosingRef.current) return;

                            console.log('[HUD] Gemini connected, requesting microphone...');

                            try {
                                const stream = await navigator.mediaDevices.getUserMedia({
                                    audio: {
                                        echoCancellation: true,
                                        noiseSuppression: true,
                                        sampleRate: 16000
                                    }
                                });

                                if (!mountedRef.current || isClosingRef.current) {
                                    stream.getTracks().forEach(track => track.stop());
                                    return;
                                }

                                streamRef.current = stream;
                                console.log('[HUD] Microphone ready');

                                sourceRef.current = audioContextRef.current!.createMediaStreamSource(stream);
                                processorRef.current = audioContextRef.current!.createScriptProcessor(4096, 1, 1);

                                processorRef.current.onaudioprocess = (e) => {
                                    if (!mountedRef.current || statusRef.current === 'stopping' || isClosingRef.current) return;

                                    const data = e.inputBuffer.getChannelData(0);

                                    const rms = Math.sqrt(data.reduce((sum, val) => sum + val * val, 0) / data.length);
                                    setVolume(Math.min(rms * 10, 1));

                                    if (sessionRef.current && initialized) {
                                        try {
                                            const pcmData = new Int16Array(data.map(v => Math.max(-1, Math.min(1, v)) * 32767));
                                            sessionRef.current.sendRealtimeInput({
                                                media: {
                                                    data: encodeAudio(pcmData.buffer),
                                                    mimeType: 'audio/pcm;rate=16000'
                                                }
                                            });
                                        } catch (err) {
                                            // Ignore send errors
                                        }
                                    }
                                };

                                sourceRef.current.connect(processorRef.current);
                                const gainNode = audioContextRef.current!.createGain();
                                gainNode.gain.value = 0;
                                processorRef.current.connect(gainNode);
                                gainNode.connect(audioContextRef.current!.destination);

                                initialized = true;
                                setStatus('recording');
                                console.log('[HUD] Recording started');

                            } catch (err: any) {
                                console.error('[HUD] Microphone error:', err);
                                setStatus('error');

                                if (err.name === 'NotAllowedError') {
                                    setError('Microphone permission denied');
                                } else if (err.name === 'NotFoundError') {
                                    setError('No microphone found');
                                } else {
                                    setError('Microphone error');
                                }
                            }
                        },
                        onmessage: (msg: LiveServerMessage) => {
                            if (!mountedRef.current || isClosingRef.current) return;

                            if (msg.serverContent?.inputTranscription?.text) {
                                const text = msg.serverContent.inputTranscription.text;
                                console.log('[HUD] Transcript chunk:', text);

                                transcriptBufferRef.current += text;
                                setTranscript(transcriptBufferRef.current);
                            }
                        },
                        onclose: () => {
                            console.log('[HUD] Gemini session closed');
                        },
                        onerror: (err) => {
                            console.error('[HUD] Session error:', err);
                            if (mountedRef.current && !isClosingRef.current) {
                                setStatus('error');
                                setError('Connection error');
                            }
                        }
                    },
                    config: {
                        responseModalities: [Modality.TEXT],
                        inputAudioTranscription: {}
                    }
                });

                sessionRef.current = session;
                console.log('[HUD] Session ready');

            } catch (err: any) {
                console.error('[HUD] Init error:', err);
                if (mountedRef.current && !isClosingRef.current) {
                    setStatus('error');
                    setError(err.message || 'Initialization failed');
                }
            }
        };

        initSession();

        return () => {
            mountedRef.current = false;
            cleanup();
        };
    }, [cleanup, encodeAudio]);

    // KEYBOARD SHORTCUTS - Multiple layers for reliability
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isClosingRef.current) {
                console.log('[HUD] ⚠️ KEYDOWN ignored - already closing');
                return;
            }
            
            console.log('[HUD] *** KEYDOWN *** Key:', e.key, 'Status:', statusRef.current);
            
            if (e.key === 'Escape') {
                console.log('[HUD] ✅ ESC detected - calling cancelRecording()');
                e.preventDefault();
                e.stopPropagation();
                cancelRecording();
            } else if (e.key === 'Enter') {
                console.log('[HUD] ✅ ENTER detected - calling stopRecording()');
                e.preventDefault();
                e.stopPropagation();
                stopRecording();
            }
        };

        // Attach to multiple targets for reliability
        window.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('keydown', handleKeyDown, true);
        
        // Also attach to body if it exists
        if (document.body) {
            document.body.addEventListener('keydown', handleKeyDown, true);
        }
        
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
            document.removeEventListener('keydown', handleKeyDown, true);
            if (document.body) {
                document.body.removeEventListener('keydown', handleKeyDown, true);
            }
        };
    }, [stopRecording, cancelRecording]);

    // IPC commands from main process
    useEffect(() => {
        if (!window.ipcRenderer) {
            console.log('[HUD] No ipcRenderer available');
            return;
        }

        console.log('[HUD] Setting up IPC listener for toggle-dictation');
        
        const handleCommand = (command: 'start' | 'stop') => {
            if (isClosingRef.current) return;
            
            console.log('[HUD] IPC command:', command);

            if (command === 'stop') {
                if (statusRef.current === 'recording') {
                    stopRecording();
                } else {
                    cancelRecording();
                }
            }
        };

        const cleanupIpc = window.ipcRenderer.on('toggle-dictation', handleCommand);
        return cleanupIpc;
    }, [stopRecording, cancelRecording]);

    // Focus management
    useEffect(() => {
        console.log('[HUD] Setting up focus');
        
        // Focus window immediately
        window.focus();
        
        // Keep trying to focus
        const focusTimer = setInterval(() => {
            if (!isClosingRef.current && document.visibilityState === 'visible') {
                window.focus();
            }
        }, 100);

        // Stop after 3 seconds
        const stopTimer = setTimeout(() => {
            clearInterval(focusTimer);
        }, 3000);
        
        return () => {
            clearInterval(focusTimer);
            clearTimeout(stopTimer);
        };
    }, []);

    return (
        <div 
            className="flex items-center justify-center p-6 h-screen bg-transparent"
            tabIndex={0}
            autoFocus
            onKeyDown={(e) => {
                if (isClosingRef.current) return;
                console.log('[HUD] Container keydown:', e.key);
                if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelRecording();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    stopRecording();
                }
            }}
        >
            <div className="relative flex items-center gap-4 px-6 py-4 rounded-2xl shadow-2xl glass-card min-w-[420px] max-w-[700px] animate-scale-in">
                {/* Ambient glow */}
                {status === 'recording' && (
                    <div 
                        className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-purple-500/20 via-teal-500/20 to-amber-500/20 blur-xl transition-opacity duration-300"
                        style={{ opacity: 0.3 + volume * 0.5 }}
                    ></div>
                )}
                
                {/* Status Indicator */}
                <div className="flex-shrink-0 relative">
                    {status === 'error' ? (
                        <div className="w-4 h-4 rounded-full bg-red-500"></div>
                    ) : status === 'recording' ? (
                        <>
                            <div className="w-4 h-4 rounded-full bg-red-500 animate-pulse"></div>
                            <div className="absolute inset-0 w-4 h-4 rounded-full bg-red-500 animate-ping opacity-50"></div>
                        </>
                    ) : status === 'stopping' ? (
                        <div className="w-4 h-4 rounded-full bg-amber-500 animate-pulse"></div>
                    ) : (
                        <div className="w-4 h-4 rounded-full bg-purple-500 animate-pulse"></div>
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    {status === 'error' ? (
                        <div className="space-y-1">
                            <p className="text-sm font-semibold text-red-400">{error}</p>
                            <p className="text-xs text-white/30">Press ESC to close</p>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-white truncate">
                                {transcript || (status === 'recording' ? 'Listening...' : status === 'stopping' ? 'Copied to Clipboard' : 'Connecting...')}
                            </p>
                            <p className="text-xs text-white/30">
                                {status === 'recording' ? (
                                    <span className="flex items-center gap-2">
                                        <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/50 text-[10px] font-mono">ENTER</kbd>
                                        <span>copy to clipboard</span>
                                        <span className="text-white/20">•</span>
                                        <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/50 text-[10px] font-mono">ESC</kbd>
                                        <span>cancel</span>
                                    </span>
                                ) : status === 'initializing' ? (
                                    <span className="flex items-center gap-2">
                                        <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/50 text-[10px] font-mono">ESC</kbd>
                                        <span>cancel</span>
                                    </span>
                                ) : 'Processing...'}
                            </p>
                        </div>
                    )}
                </div>

                {/* Visualizer */}
                {status === 'recording' && (
                    <div className="flex items-center gap-1 h-8">
                        {[...Array(6)].map((_, i) => (
                            <div
                                key={i}
                                className="w-1 rounded-full transition-all duration-75"
                                style={{
                                    height: `${8 + (Math.sin(Date.now() / 150 + i * 0.8) * 0.5 + 0.5) * volume * 20}px`,
                                    background: `linear-gradient(180deg, #a855f7 0%, #14b8a6 50%, #f59e0b 100%)`,
                                    opacity: 0.4 + volume * 0.6
                                }}
                            />
                        ))}
                    </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2">
                    {status !== 'stopping' && (
                        <button
                            onClick={cancelRecording}
                            className="flex-shrink-0 px-3 py-2 bg-white/10 hover:bg-white/20 text-white/70 text-sm font-semibold rounded-lg transition-all"
                        >
                            Cancel
                        </button>
                    )}
                    {(status === 'recording' || status === 'initializing') && (
                        <button
                            onClick={stopRecording}
                            className="flex-shrink-0 px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 text-white text-sm font-bold rounded-lg transition-all shadow-lg shadow-red-500/25 active:scale-95"
                        >
                            Stop
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FloatingHUD;
