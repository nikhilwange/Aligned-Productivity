import React from 'react';
import type { SegmentManifest } from '../services/recordingRecovery';
import { formatRecordingTime } from './RecordingIndicator';

interface LeftoverRecordingNoticeProps {
  manifest: SegmentManifest;
  /** How many more are waiting after this one. */
  remaining: number;
  onSave: () => void;
  /** Opens the destructive confirm — nothing is deleted from here directly. */
  onDiscard: () => void;
  /** Close for now; the recording stays on this device and is offered again next time. */
  onLater: () => void;
}

/**
 * "Found an unfinished recording from <date>: Save / Discard" — for leftovers
 * that are never auto-processed (older than a day, longer than the ceiling,
 * or not the one auto-saved this load).
 */
const LeftoverRecordingNotice: React.FC<LeftoverRecordingNoticeProps> = ({ manifest, remaining, onSave, onDiscard, onLater }) => {
  const when = new Date(manifest.startedAt);
  const dateLabel = `${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  const capturedSec = manifest.segments.reduce((s, seg) => s + (seg.durationMs || 0), 0) / 1000;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button aria-label="Decide later" onClick={onLater} className="absolute inset-0 bg-black/40 backdrop-blur-sm cursor-default" />
      <div
        className="relative w-full max-w-sm rounded-[22px] overflow-hidden animate-fade-in p-7"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        role="dialog"
        aria-modal="true"
      >
        <h3 className="font-display-tight text-lg font-semibold text-[var(--text-primary)] text-center">
          Found an unfinished recording
        </h3>
        <p className="text-sm text-[var(--text-tertiary)] text-center mt-2">
          From {dateLabel} · {formatRecordingTime(capturedSec)} of audio. It was never processed.
          {remaining > 0 && ` (${remaining} more after this one.)`}
        </p>
        <div className="flex gap-2 mt-6">
          <button
            onClick={onDiscard}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold glass glass-hover text-[var(--text-secondary)] transition-all active:scale-95"
          >
            Discard
          </button>
          <button
            onClick={onSave}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 hover:opacity-90"
            style={{ background: 'var(--cta-bg)', color: 'var(--cta-fg)' }}
          >
            Save
          </button>
        </div>
        <button onClick={onLater} className="w-full mt-3 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          Decide later
        </button>
      </div>
    </div>
  );
};

export default LeftoverRecordingNotice;
