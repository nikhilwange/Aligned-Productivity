import React, { useEffect, useState } from 'react';
import { useRecording } from '../hooks/useRecording';
import { recordingController, type RecorderPrompt } from '../services/recordingController';

// MM:SS under an hour, H:MM:SS at or above it.
export const formatRecordingTime = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const mm = mins.toString().padStart(2, '0');
  const ss = secs.toString().padStart(2, '0');
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
};

const SOURCE_LABEL: Record<string, string> = {
  'in-person': 'In person',
  'virtual-meeting': 'Virtual',
  'phone-call': 'Call',
};

/** Seconds left on a prompt, ticking locally so the countdown stays smooth. */
function useCountdown(deadline: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
}

/**
 * Re-share the meeting tab into the SAME recording. The click calls
 * reconnectShare() directly — no await before it — because the browser only
 * allows getDisplayMedia straight from a click.
 */
export const ReconnectShareButton: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const [message, setMessage] = useState<string | null>(null);
  const reconnect = () => {
    setMessage(null);
    void recordingController.reconnectShare().then(setMessage);
  };
  return (
    <div className="w-full">
      <button
        onClick={reconnect}
        className={`w-full px-3 ${compact ? 'py-1.5' : 'py-2'} rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-black transition-all active:scale-95`}
      >
        Reconnect meeting audio
      </button>
      {message && <p className="text-xs text-amber-500 mt-1.5" role="status">{message}</p>}
    </div>
  );
};

const PROMPT_COPY: Record<RecorderPrompt['kind'], { title: string; body: string }> = {
  silence: { title: 'Still recording?', body: "We haven't heard anything for a while." },
  share_ended: { title: 'Screen audio sharing ended', body: 'Reconnect the meeting, or continue with mic only?' },
  share_silent: { title: 'Did your meeting end?', body: 'The meeting audio has been silent for a while.' },
};

/** A recorder prompt — Keep / Stop (+ Reconnect when sharing ended), auto-saves on timeout. */
export const RecordingPromptCard: React.FC<{ prompt: RecorderPrompt; compact?: boolean }> = ({ prompt, compact }) => {
  const secondsLeft = useCountdown(prompt.deadline);
  const shareEnded = prompt.kind === 'share_ended';
  const { title, body } = PROMPT_COPY[prompt.kind];
  return (
    <div className={`glass-card rounded-xl ${compact ? 'p-3' : 'p-4'} border border-[var(--border)]`} role="alertdialog" aria-live="assertive">
      <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
      <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
        {body} The recording will be saved automatically in {formatRecordingTime(secondsLeft)}.
      </p>
      {shareEnded && <div className="mt-3"><ReconnectShareButton compact={compact} /></div>}
      <div className={`flex gap-2 ${shareEnded ? 'mt-2' : 'mt-3'}`}>
        <button
          onClick={() => recordingController.respondToPrompt('keep')}
          className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 ${shareEnded ? 'glass glass-hover text-[var(--text-secondary)]' : 'hover:opacity-90'}`}
          style={shareEnded ? undefined : { background: 'var(--cta-bg)', color: 'var(--cta-fg)' }}
        >
          Keep recording
        </button>
        <button
          onClick={() => recordingController.respondToPrompt('stop')}
          className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold glass glass-hover text-[var(--text-secondary)] transition-all active:scale-95"
        >
          Stop &amp; save
        </button>
      </div>
    </div>
  );
};

/** Non-blocking notice after the recording resumed from a short sleep. */
export const SleepNotice: React.FC<{ gapMin: number }> = ({ gapMin }) => (
  <div className="glass-card rounded-xl px-3 py-2.5 flex items-start gap-2 border border-[var(--border)]" role="status">
    <p className="flex-1 text-xs text-[var(--text-secondary)]">
      Recording resumed. About {gapMin} min was not captured while your device slept.
    </p>
    <button
      onClick={() => recordingController.dismissSleepNotice()}
      className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs font-semibold"
      aria-label="Dismiss"
    >
      ✕
    </button>
  </div>
);

interface RecordingIndicatorProps {
  /** Go to the recording screen. */
  onOpen: () => void;
  /** 'sidebar' on desktop, 'bar' as the mobile top bar. */
  variant: 'sidebar' | 'bar';
}

/**
 * Persistent "recording in progress" indicator, shown on every screen while a
 * recording runs: pulsing dot, elapsed captured time, source, Stop, and tap to
 * return to the recorder. Also surfaces any prompt so it can be answered from
 * wherever the user is.
 */
const RecordingIndicator: React.FC<RecordingIndicatorProps> = ({ onOpen, variant }) => {
  const rec = useRecording();
  if (rec.status !== 'recording' && rec.status !== 'finalizing') return null;
  const finalizing = rec.status === 'finalizing';
  const label = SOURCE_LABEL[rec.source ?? ''] ?? 'Recording';

  const row = (
    <div className="flex items-center gap-3">
      <button onClick={onOpen} className="flex items-center gap-3 flex-1 min-w-0 text-left" title="Return to the recording">
        <span className="relative flex w-2.5 h-2.5 shrink-0">
          {!finalizing && <span className="absolute inset-0 rounded-full animate-ping opacity-50" style={{ background: 'var(--accent-signal)' }} />}
          <span className="relative w-2.5 h-2.5 rounded-full" style={{ background: finalizing ? 'var(--text-muted)' : 'var(--accent-signal)' }} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold font-mono tabular-nums text-[var(--text-primary)]">
            {finalizing ? 'Saving…' : formatRecordingTime(rec.capturedMs / 1000)}
          </span>
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] truncate">
            {label} recording
          </span>
        </span>
      </button>
      {!finalizing && (
        <button
          onClick={() => void recordingController.finalizeRecording('user_stop')}
          className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 hover:opacity-90"
          style={{ background: 'var(--cta-bg)', color: 'var(--cta-fg)' }}
        >
          Stop
        </button>
      )}
    </div>
  );

  if (variant === 'bar') {
    return (
      <div className="md:hidden px-4 py-2 border-b border-[var(--border)] bg-[var(--surface-900)]/80 backdrop-blur-xl space-y-2 shrink-0">
        {row}
        {rec.prompt && <RecordingPromptCard prompt={rec.prompt} compact />}
        {rec.sleepNotice && <SleepNotice gapMin={rec.sleepNotice.gapMin} />}
      </div>
    );
  }
  return (
    <div className="glass-card rounded-2xl p-3 mb-5 space-y-2">
      {row}
      {rec.prompt && <RecordingPromptCard prompt={rec.prompt} compact />}
      {rec.sleepNotice && <SleepNotice gapMin={rec.sleepNotice.gapMin} />}
    </div>
  );
};

export default RecordingIndicator;
