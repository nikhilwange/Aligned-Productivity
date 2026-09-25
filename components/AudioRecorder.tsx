import React, { useState, useEffect } from 'react';
import { isNativeApp } from '../services/nativePermissions';
import { LIVE_TRANSCRIPTION } from '../config/features';
import { STT_SESSION_CEILING_MIN, SILENCE_AUTOSTOP_MIN } from '../config/sttLimits';
import { subscribeLiveProgress, type LiveProgress } from '../services/liveTranscription';
import { recordingController, type InputMode } from '../services/recordingController';
import { useRecording } from '../hooks/useRecording';
import { RecordingPromptCard, ReconnectShareButton, SleepNotice, PauseNotice, formatRecordingTime, useSecondsSince } from './RecordingIndicator';
import { requestPromptAlertPermission } from '../hooks/usePromptAlert';

// A VIEW of the app-level recording controller (services/recordingController.ts).
// It owns no streams, recorders or timers: mounting / unmounting it — which
// happens on every navigation — never affects a recording in progress.

interface AudioRecorderProps {
  transcriptionEngine: 'gemini' | 'sarvam';
  onEngineChange: (engine: 'gemini' | 'sarvam') => void;
  hasSarvamKey: boolean;
  // Per-session recording cap in minutes (Free tier = 90; null = no cap).
  // At the cap the recording stops and is saved; a warning fires 5 min before.
  sessionCapMinutes?: number | null;
  // True while an earlier session is still being summarized. Recording is not
  // blocked by it — this only drives a reassurance line under the button.
  backgroundProcessing?: boolean;
  /** Show a toast (e.g. "A recording is already running in another tab."). */
  onNotice: (message: string, type?: 'info' | 'error') => void;
  /** Ask the user to confirm discarding the current recording. */
  onRequestDiscard: () => void;
}

const IN_PERSON_TIP_KEY = 'aligned-tip-in-person-dismissed';

const AudioRecorder: React.FC<AudioRecorderProps> = ({ transcriptionEngine, onEngineChange, hasSarvamKey, sessionCapMinutes, backgroundProcessing, onNotice, onRequestDiscard }) => {
  const rec = useRecording();
  const [selectedMode, setSelectedMode] = useState<InputMode>('mic');
  const [isScreenCaptureSupported, setIsScreenCaptureSupported] = useState<boolean>(true);
  // Phase 3: how many finalized segments have been transcribed live so far.
  // Component state only — never persisted.
  const [liveProgress, setLiveProgress] = useState<LiveProgress | null>(null);
  const [tipHidden, setTipHidden] = useState(false);

  const isRecording = rec.status === 'recording';
  const isStarting = rec.status === 'starting';
  const isProcessing = rec.status === 'finalizing';
  const inputMode: InputMode = rec.inputMode ?? selectedMode;

  useEffect(() => {
    const isMobile = isNativeApp() || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const hasDisplayMedia = navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices;
    setIsScreenCaptureSupported(hasDisplayMedia && !isMobile);
  }, []);

  // Phase 3: mirror live-transcription progress for the reassurance line.
  // Only listens to THIS recording.
  useEffect(() => {
    if (!LIVE_TRANSCRIPTION) return;
    return subscribeLiveProgress((p) => {
      if (p.sessionId === recordingController.getSnapshot().recoveryId) setLiveProgress(p);
    });
  }, []);

  useEffect(() => {
    if (rec.recoveryId) setLiveProgress(null); // new recording → fresh readout
    setTipHidden(false);
  }, [rec.recoveryId]);

  const startRecording = async () => {
    const failure = await recordingController.start({ inputMode: selectedMode, sessionCapMinutes });
    if (!failure) return;
    if (failure.code === 'busy' || failure.code === 'other_tab') onNotice(failure.message, 'error');
    else alert(failure.message);
  };

  const stopRecording = () => { void recordingController.finalizeRecording('user_stop'); };
  const togglePause = () => {
    if (recordingController.getSnapshot().paused) void recordingController.resume();
    else recordingController.pause();
  };
  const pausedFor = useSecondsSince(rec.paused ? rec.pausedAt : null);

  // Space toggles Pause / Resume on this screen only (it is unmounted
  // elsewhere). Never while typing, and never when a control has focus — the
  // browser already "clicks" a focused button on Space.
  useEffect(() => {
    if (!isRecording) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName))) return;
      e.preventDefault();
      togglePause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isRecording]);

  const tipDismissedForever = (() => {
    try { return localStorage.getItem(IN_PERSON_TIP_KEY) === '1'; } catch { return false; }
  })();
  const showInPersonTip = isRecording && inputMode === 'mic' && !tipHidden && !tipDismissedForever;
  const dismissTipForever = () => {
    try { localStorage.setItem(IN_PERSON_TIP_KEY, '1'); } catch { /* ignore */ }
    setTipHidden(true);
  };

  const timer = Math.floor(rec.capturedMs / 1000);
  const limitSeconds = Math.min(
    STT_SESSION_CEILING_MIN * 60,
    sessionCapMinutes && sessionCapMinutes > 0 ? sessionCapMinutes * 60 : Infinity,
  );
  const remainingTime = Math.max(0, limitSeconds - timer);
  const progressPercent = Math.min(100, (timer / limitSeconds) * 100);
  const silenceSeconds = Math.floor(rec.silenceMs / 1000);

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

  // Show silence warning when silence exceeds 60s
  const showSilenceWarning = isRecording && !rec.paused && !rec.prompt && silenceSeconds >= 60;
  // Show long-recording heads-up after 90 minutes
  const showLongRecordingWarning = isRecording && timer >= 5400;

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-xl mx-auto p-4 animate-fade-in-up h-full md:h-auto">
      {/* Recording Status Badge */}
      {isRecording && (
        <div className="mb-10 animate-fade-in-down">
          <div className="flex items-center gap-3 px-5 py-3 glass-card rounded-2xl">
            {rec.paused ? (
              <div className="w-2.5 h-2.5 bg-amber-500 rounded-full"></div>
            ) : (
              <div className="relative">
                <div className="absolute inset-0 bg-red-500 rounded-full animate-ping opacity-40"></div>
                <div className="relative w-2.5 h-2.5 bg-red-500 rounded-full"></div>
              </div>
            )}
            <span className="text-xs font-semibold text-[var(--text-secondary)] tracking-wide">
              {rec.paused ? 'Paused — nothing is being recorded' : 'High-precision active session'}
            </span>
          </div>
        </div>
      )}

      {/* Prompt / sleep notice (also shown in the indicator on every screen) */}
      {isRecording && rec.prompt && (
        <div className="mb-4 w-full max-w-sm animate-fade-in-down"><RecordingPromptCard prompt={rec.prompt} /></div>
      )}
      {isRecording && rec.paused && (rec.pauseReminder || rec.resumeError) && (
        <div className="mb-4 w-full max-w-sm animate-fade-in-down"><PauseNotice /></div>
      )}
      {/* Virtual recording carrying on with mic only (after "Keep recording") */}
      {isRecording && inputMode === 'meeting' && !rec.shareLive && !rec.prompt && !rec.paused && (
        <div className="mb-4 w-full max-w-sm animate-fade-in-down">
          <div className="glass-card rounded-xl p-4 border border-amber-500/30">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Meeting audio is off</p>
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5 mb-3">
              Only your microphone is being recorded. Rejoined the meeting? Share its tab again.
            </p>
            <ReconnectShareButton />
          </div>
        </div>
      )}
      {isRecording && rec.sleepNotice && (
        <div className="mb-4 w-full max-w-sm animate-fade-in-down"><SleepNotice gapMin={rec.sleepNotice.gapMin} /></div>
      )}

      {/* First in-person recording tip */}
      {showInPersonTip && (
        <div className="mb-4 w-full max-w-sm animate-fade-in-down">
          <div className="glass-card rounded-xl px-4 py-3 border border-[var(--border)]">
            <p className="text-xs font-medium text-[var(--text-secondary)]">
              Keep your laptop plugged in and the lid open. Recording pauses if your laptop sleeps.
            </p>
            <div className="flex gap-3 mt-2">
              <button onClick={() => setTipHidden(true)} className="text-xs font-semibold text-[var(--text-primary)] hover:opacity-80">Got it</button>
              <button onClick={dismissTipForever} className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]">Don't show again</button>
            </div>
          </div>
        </div>
      )}

      {/* Long recording heads-up */}
      {showLongRecordingWarning && (
        <div className="mb-4 animate-fade-in-down">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20">
            <svg className="w-4 h-4 text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 18a6 6 0 100-12 6 6 0 000 12z" />
            </svg>
            <span className="text-xs font-medium text-purple-300">
              Long recording — processing may take several minutes after you stop.
            </span>
          </div>
        </div>
      )}

      {/* Silence Warning */}
      {showSilenceWarning && (
        <div className="mb-4 animate-fade-in-down">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span className="text-xs font-medium text-amber-300">
              No audio detected for {formatRecordingTime(silenceSeconds)}
              {silenceSeconds >= (SILENCE_AUTOSTOP_MIN - 3) * 60 && " — we'll check you're still recording soon"}
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
                onClick={() => {
                  setSelectedMode(mode.id as InputMode);
                  // Ask here, not in "Begin Capture": that click must reach getDisplayMedia with no await.
                  if (mode.id === 'meeting') requestPromptAlertPermission();
                }}
                disabled={isStarting}
                className={`flex items-center gap-2.5 px-5 md:px-6 py-3 rounded-xl text-sm font-semibold transition-all duration-300 ${
                  selectedMode === mode.id
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

        {/* Glow effects for recording — dark mode only; granola uses a quiet terra ring */}
        {isRecording && (
          <>
            <div className="absolute inset-0 bg-purple-500 rounded-full opacity-20 blur-[60px] animate-pulse-glow scale-150 dark-only"></div>
            <div className="absolute inset-4 bg-teal-400 rounded-full opacity-15 blur-[40px] animate-pulse-glow dark-only" style={{ animationDelay: '0.5s' }}></div>
            <div className="absolute -inset-12 border border-purple-500/10 rounded-full animate-rotate-slow dark-only"></div>
          </>
        )}

        <div className="relative z-10">
          {!isRecording ? (
            <button
              onClick={startRecording}
              disabled={isProcessing || isStarting}
              className={`w-56 h-56 rounded-full flex flex-col items-center justify-center transition-all duration-500 group ${
                isProcessing || isStarting
                  ? 'glass cursor-wait'
                  : 'glass-card hover:scale-105 active:scale-95 cursor-pointer'
              }`}
            >
              {isProcessing || isStarting ? (
                <div className="flex flex-col items-center">
                  <div className="flex gap-2 mb-4">
                    {[0, 0.2, 0.4].map(d => (
                      <div key={d} className="w-2.5 h-2.5 rounded-full animate-bounce"
                           style={{ animationDelay: `${d}s`, background: 'var(--accent)' }} />
                    ))}
                  </div>
                  <span className="text-xs font-semibold text-[var(--text-muted)]">{isStarting ? 'Starting' : 'Saving'}</span>
                </div>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-2xl bg-amber-500/15 flex items-center justify-center mb-4 text-amber-400 group-hover:scale-110 transition-transform duration-300">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  </div>
                  <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Begin Capture</span>
                </>
              )}
            </button>
          ) : (
            <div className="w-56 h-56 rounded-full shadow-2xl flex flex-col items-center justify-center relative overflow-hidden"
                 style={{
                   background: 'var(--bg-elevated)',
                   border: '2px solid var(--accent-2, var(--accent))',
                 }}>
              {/* Audio visualizer bars (hidden while paused — nothing is recorded) */}
              {!rec.paused && <div className="absolute inset-0 flex items-center justify-center gap-1.5 opacity-40 px-10">
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
              </div>}

              {/* Timer (captured audio only — it does not move while paused) */}
              <h2 className="text-5xl font-mono text-[var(--text-primary)] tracking-tighter tabular-nums z-10 mb-1 font-semibold">{formatRecordingTime(timer)}</h2>
              {rec.paused ? (
                <div className="text-[10px] font-bold z-10 text-amber-500">
                  Paused {formatRecordingTime(pausedFor)}
                </div>
              ) : (
                <div className={`text-[10px] font-bold z-10 transition-colors duration-500 ${getRemainingColor()}`}>
                  {formatRecordingTime(remainingTime)} remaining
                </div>
              )}

              {/* Phase 3: quiet reassurance that transcription is already
                  running in the background. Deliberately understated — no
                  spinner, no prominence. */}
              {liveProgress && liveProgress.total > 0 && (
                <div className="text-[10px] font-medium text-[var(--text-tertiary)] z-10 mt-1.5">
                  Transcribed {liveProgress.done} of {liveProgress.total} segments
                </div>
              )}

              {/* Pause / Resume + Finish (Space toggles pause on this screen) */}
              <div className="absolute bottom-6 flex gap-2 z-10">
                <button
                  onClick={togglePause}
                  disabled={rec.status !== 'recording'}
                  title={rec.paused ? 'Resume (Space)' : 'Pause (Space)'}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-50 ${
                    rec.paused ? 'bg-amber-500 hover:bg-amber-400 text-black' : 'glass glass-hover text-[var(--text-secondary)]'
                  }`}
                >
                  {rec.paused ? 'Resume' : 'Pause'}
                </button>
                <button
                  onClick={stopRecording}
                  disabled={rec.status !== 'recording'}
                  className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white backdrop-blur-md rounded-xl text-xs font-bold transition-all shadow-lg shadow-purple-500/25 active:scale-95 disabled:opacity-50"
                >
                  Finish
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Discard — the only way to drop a recording; App confirms first. */}
      {isRecording && (
        <button
          onClick={onRequestDiscard}
          className="-mt-10 mb-8 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--accent-signal)] transition-colors"
        >
          Discard recording
        </button>
      )}

      <div className="text-center max-w-sm">
        <h3 className="font-display-tight text-2xl font-semibold text-[var(--text-primary)] mb-3">
          {isRecording ? "Capturing intelligence" : isProcessing ? "Synthesizing insights" : "Structured Intelligence"}
        </h3>
        <p className="text-[var(--text-tertiary)] font-medium text-sm leading-relaxed">
          {isRecording
            ? "Your conversation is being analyzed by Gemini 2.5 for real-time extraction."
            : "Transform any multilingual dialogue into structured documentation with zero effort."
          }
        </p>
        {backgroundProcessing && !isRecording && !isProcessing && (
          <p className="mt-3 text-xs font-medium text-amber-500/80">
            Previous session is still being summarized in the background.
          </p>
        )}
      </div>
    </div>
  );
};

export default AudioRecorder;
