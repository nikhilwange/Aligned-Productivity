import React from 'react';

interface RetranscribeBannerProps {
  /** Segments still unclear or failed. */
  problems: number;
  /** All segments of the recording. */
  total: number;
  /** Set while a re-transcription runs. */
  progress: { done: number; total: number } | null;
  onRetranscribe: () => void;
}

/**
 * Shown above a completed session whose recording had segments that couldn't
 * be transcribed. The audio for those is kept (7 days) so they can be re-sent
 * on their own; the transcript is patched in place and the notes re-generated.
 */
const RetranscribeBanner: React.FC<RetranscribeBannerProps> = ({ problems, total, progress, onRetranscribe }) => (
  <div className="w-full flex items-center gap-3 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/15" role="status">
    <p className="flex-1 min-w-0 text-xs font-medium text-[var(--text-secondary)]">
      {progress
        ? `Re-transcribing unclear parts… ${progress.done} of ${progress.total}`
        : `Part of this recording couldn't be transcribed (${problems} of ${total} segment${total !== 1 ? 's' : ''}).`}
    </p>
    {!progress && (
      <button
        onClick={onRetranscribe}
        className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 hover:opacity-90"
        style={{ background: 'var(--cta-bg)', color: 'var(--cta-fg)' }}
      >
        Re-transcribe unclear parts
      </button>
    )}
  </div>
);

export default RetranscribeBanner;
