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

// Capacity ring geometry, in the SVG's 100×100 viewBox.
const RING_R = 48;
const RING_C = 2 * Math.PI * RING_R;

// Fixed waveform shape so the bars don't jump on every re-render; the CSS
// `wave` animation supplies the motion.
const WAVE_BARS = Array.from({ length: 36 }, (_, i) =>
  Math.round(6 + 30 * Math.abs(Math.sin(i * 1.9) * 0.6 + Math.sin(i * 0.37 + 1) * 0.4)),
);

const AudioRecorder: React.FC<AudioRecorderProps> = ({ sessionCapMinutes, backgroundProcessing, onNotice, onRequestDiscard }) => {
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
    { id: 'mic', label: 'In Person', hint: 'Records the room through your microphone', icon: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z', color: 'purple' },
    { id: 'meeting', label: 'Virtual', hint: 'Captures a meeting tab plus your microphone', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', color: 'teal' },
    { id: 'call', label: 'Call', hint: 'Records a call on speaker through your microphone', icon: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z', color: 'amber' }
  ];

  // Show silence warning when silence exceeds 60s
  const showSilenceWarning = isRecording && !rec.paused && !rec.prompt && silenceSeconds >= 60;
  // Show long-recording heads-up after 90 minutes
  const showLongRecordingWarning = isRecording && timer >= 5400;

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-xl mx-auto p-4 animate-fade-in-up h-full md:h-auto">
      {/* Recording Status Badge */}
      {isRecording && (
        <div className="mb-6 animate-fade-in-down">
          <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-full border border-[var(--border)] bg-[var(--bg-sunken)]">
            {rec.paused ? (
              <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
            ) : (
              <div className="w-2 h-2 rounded-full" style={{ background: 'var(--rec-signal)', boxShadow: '0 0 0 4px var(--rec-signal-soft)' }}></div>
            )}
            <span className="text-[13px] font-medium text-[var(--text-secondary)]">
              {rec.paused
                ? 'Paused — nothing is being recorded'
                : `Recording · ${inputModes.find(m => m.id === inputMode)?.label ?? 'In Person'}`}
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
          <div className="flex items-start gap-3 rounded-2xl px-3.5 py-3 border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
            <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />
            </svg>
            <div className="flex-1">
              <p className="text-[13px] leading-snug text-[var(--text-secondary)]">
                Keep your laptop plugged in and the lid open. Recording pauses if your laptop sleeps.
              </p>
              <div className="flex gap-4 mt-2">
                <button onClick={() => setTipHidden(true)} className="text-[13px] font-semibold text-[var(--text-primary)] hover:opacity-80">Got it</button>
                <button onClick={dismissTipForever} className="text-[13px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]">Don't show again</button>
              </div>
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

      {/* Input Mode Selector */}
      {!isRecording && !isProcessing && (
        <div className="flex flex-col items-center gap-2.5 mb-8 max-w-full">
          <div role="tablist" aria-label="Recording source" className="flex flex-wrap justify-center gap-1 p-1 rounded-2xl border border-[var(--border)] bg-[var(--bg-sunken)]">
            {inputModes.map(mode => (
              (mode.id !== 'meeting' || isScreenCaptureSupported) && (
                <button
                  key={mode.id}
                  role="tab"
                  aria-selected={selectedMode === mode.id}
                  onClick={() => {
                    setSelectedMode(mode.id as InputMode);
                    // Ask here, not in "Start recording": that click must reach getDisplayMedia with no await.
                    if (mode.id === 'meeting') requestPromptAlertPermission();
                  }}
                  disabled={isStarting}
                  className={`flex items-center gap-2 h-10 px-4 rounded-xl text-sm transition-all duration-200 ${
                    selectedMode === mode.id
                      ? 'font-semibold text-[var(--text-primary)]'
                      : 'font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  }`}
                  style={selectedMode === mode.id ? { background: 'var(--rec-seg-on)', boxShadow: 'var(--rec-seg-shadow)' } : undefined}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={mode.icon} />
                  </svg>
                  {mode.label}
                </button>
              )
            ))}
          </div>
          <span className="text-xs text-[var(--text-muted)]">
            {inputModes.find(m => m.id === selectedMode)?.hint}
          </span>
        </div>
      )}

      {/* Start recording / Starting / Saving — same dial as the recording screen */}
      {!isRecording && (
        <div className="flex flex-col items-center gap-6 mb-10">
          <div className="relative w-[272px] h-[272px] flex items-center justify-center">
            <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
              <circle cx="50" cy="50" r={RING_R} fill="none" stroke="var(--rec-track)" strokeWidth="0.9" />
            </svg>
            <button
              onClick={startRecording}
              disabled={isProcessing || isStarting}
              aria-label={isStarting ? 'Starting' : isProcessing ? 'Saving' : 'Start recording'}
              className={`group w-[232px] h-[232px] rounded-full flex flex-col items-center justify-center gap-4 transition-transform duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)] ${
                isProcessing || isStarting ? 'cursor-wait' : 'hover:scale-[1.02] active:scale-[0.98] cursor-pointer'
              }`}
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--rec-dial-shadow)' }}
            >
              {isProcessing || isStarting ? (
                <>
                  <div className="flex gap-2">
                    {[0, 0.2, 0.4].map(d => (
                      <div key={d} className="w-2.5 h-2.5 rounded-full animate-bounce"
                           style={{ animationDelay: `${d}s`, background: 'var(--rec-signal)' }} />
                    ))}
                  </div>
                  <span className="text-sm font-semibold text-[var(--text-muted)]">{isStarting ? 'Starting' : 'Saving'}</span>
                </>
              ) : (
                <>
                  <span
                    className="w-20 h-20 rounded-full flex items-center justify-center text-white transition-transform duration-300 group-hover:scale-105"
                    style={{ background: 'var(--rec-signal)', boxShadow: '0 0 0 8px var(--rec-signal-soft)' }}
                  >
                    <svg className="w-[30px] h-[30px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3" />
                    </svg>
                  </span>
                  <span className="text-sm font-semibold text-[var(--text-primary)]">Start recording</span>
                </>
              )}
            </button>
          </div>

          {/* Resting waveform — where the live one appears once recording starts */}
          <div className="flex items-center gap-[3px] h-10" aria-hidden="true">
            {WAVE_BARS.map((_, i) => (
              <span key={i} className="block w-[3px] h-1 rounded-full" style={{ background: 'var(--rec-wave-dim)' }} />
            ))}
          </div>
        </div>
      )}

      {/* Recording — "Studio": dial with timer, waveform, labelled controls */}
      {isRecording && (
        <div className="flex flex-col items-center gap-6 mb-10">
          {/* Dial: capacity ring around the timer */}
          <div className="relative w-[272px] h-[272px] flex items-center justify-center">
            <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" aria-hidden="true">
              <circle cx="50" cy="50" r={RING_R} fill="none" stroke="var(--rec-track)" strokeWidth="0.9" />
              <circle
                cx="50" cy="50" r={RING_R}
                fill="none"
                stroke="var(--rec-signal)"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - progressPercent / 100)}
                className="transition-[stroke-dashoffset] duration-1000"
              />
            </svg>
            <div
              className="w-[232px] h-[232px] rounded-full flex flex-col items-center justify-center gap-1.5"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--rec-dial-shadow)' }}
            >
              {/* Timer (captured audio only — it does not move while paused) */}
              <h2 className="text-[54px] leading-none font-mono font-medium tracking-tighter tabular-nums text-[var(--text-primary)]">
                {formatRecordingTime(timer)}
              </h2>
              {rec.paused ? (
                <div className="text-xs font-semibold text-amber-500">
                  Paused {formatRecordingTime(pausedFor)}
                </div>
              ) : (
                <div className={`text-xs font-medium transition-colors duration-500 ${getRemainingColor()}`}>
                  {formatRecordingTime(remainingTime)} remaining
                </div>
              )}
            </div>
          </div>

          {/* Waveform (flat while paused — nothing is recorded) */}
          <div className="flex items-center gap-[3px] h-10" aria-hidden="true">
            {WAVE_BARS.map((h, i) => (
              <span
                key={i}
                className="block w-[3px] rounded-full"
                style={{
                  height: rec.paused ? 4 : h,
                  background: i < WAVE_BARS.length * 0.45 ? 'var(--rec-wave-dim)' : 'var(--rec-wave)',
                  animation: rec.paused ? 'none' : `wave ${0.6 + (i % 5) * 0.12}s ease-in-out ${i * 0.05}s infinite`,
                  transition: 'height 300ms ease',
                }}
              />
            ))}
          </div>

          {/* Pause / Resume · Finish · Discard (Space toggles pause on this screen) */}
          <div className="flex items-start gap-8">
            <div className="flex flex-col items-center gap-2 pt-2">
              <button
                onClick={togglePause}
                disabled={rec.status !== 'recording'}
                aria-label={rec.paused ? 'Resume (Space)' : 'Pause (Space)'}
                title={rec.paused ? 'Resume (Space)' : 'Pause (Space)'}
                className="w-14 h-14 rounded-full flex items-center justify-center transition-all hover:brightness-95 active:scale-95 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                style={rec.paused
                  ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                  : { background: 'var(--rec-btn)', border: '1px solid var(--rec-btn-border)', color: 'var(--text-primary)' }}
              >
                {rec.paused ? (
                  <svg className="w-5 h-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5.5v13a1 1 0 001.5.86l11-6.5a1 1 0 000-1.72l-11-6.5A1 1 0 007 5.5z" /></svg>
                ) : (
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></svg>
                )}
              </button>
              <span className="text-xs font-medium text-[var(--text-secondary)]">{rec.paused ? 'Resume' : 'Pause'}</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <button
                onClick={stopRecording}
                disabled={rec.status !== 'recording'}
                aria-label="Finish recording"
                className="w-[72px] h-[72px] rounded-full flex items-center justify-center transition-all hover:brightness-110 active:scale-95 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]"
                style={{ background: 'var(--rec-signal)', boxShadow: '0 0 0 6px var(--rec-signal-soft)' }}
              >
                <span className="block w-[22px] h-[22px] rounded-md bg-white" />
              </button>
              <span className="text-xs font-semibold text-[var(--text-primary)]">Finish</span>
            </div>

            {/* Discard — the only way to drop a recording; App confirms first. */}
            <div className="flex flex-col items-center gap-2 pt-2">
              <button
                onClick={onRequestDiscard}
                aria-label="Discard recording"
                className="w-14 h-14 rounded-full flex items-center justify-center border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent-signal)] hover:border-[var(--border-strong)] transition-colors active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" />
                </svg>
              </button>
              <span className="text-xs font-medium text-[var(--text-muted)]">Discard</span>
            </div>
          </div>
        </div>
      )}

      <div className="text-center max-w-sm">
        <h3 className="font-display-tight text-2xl font-semibold text-[var(--text-primary)] mb-3">
          {isRecording ? "Capturing intelligence" : isProcessing ? "Synthesizing insights" : "Structured Intelligence"}
        </h3>
        <p className="text-[var(--text-tertiary)] font-medium text-sm leading-relaxed">
          {isRecording
            ? (liveProgress && liveProgress.total > 0
                ? `Transcribing live · ${liveProgress.done} of ${liveProgress.total} segments done`
                : 'Transcribing live')
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
