import React from 'react';
import { RecordingSession } from '../types';

interface ProcessingBannerProps {
  session: RecordingSession;
  onTap: () => void;
}

const ProcessingBanner: React.FC<ProcessingBannerProps> = ({ session, onTap }) => {
  const step = session.processingStep || 'transcribing';
  const stepLabel =
    step === 'transcribing' ? 'Transcribing audio...' :
    step === 'analyzing' ? 'Generating notes...' :
    'Finalizing...';

  return (
    <button
      onClick={onTap}
      className="w-full flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-purple-500/15 via-teal-500/10 to-amber-500/15 border-b border-white/[0.06] hover:from-purple-500/20 hover:via-teal-500/15 hover:to-amber-500/20 transition-all group cursor-pointer"
    >
      {/* Spinner */}
      <div className="relative w-5 h-5 shrink-0">
        <div className="absolute inset-0 rounded-full border-2 border-white/10"></div>
        <div className="absolute inset-0 rounded-full border-2 border-t-purple-400 border-r-teal-400 border-b-amber-400 border-l-transparent animate-spin"></div>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
            {session.title}
          </span>
          <span className="text-xs text-[var(--text-secondary)] opacity-60 hidden sm:inline">
            — {stepLabel}
          </span>
          <span className="text-xs text-[var(--text-secondary)] opacity-60 sm:hidden">
            {stepLabel}
          </span>
        </div>
      </div>

      {/* Step pills */}
      <div className="hidden sm:flex items-center gap-1.5 shrink-0">
        {(['transcribing', 'analyzing', 'finalizing'] as const).map((s) => {
          const isCurrent = s === step;
          const isDone =
            (s === 'transcribing' && (step === 'analyzing' || step === 'finalizing')) ||
            (s === 'analyzing' && step === 'finalizing');
          return (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                isDone ? 'w-6 bg-teal-400/60' :
                isCurrent ? 'w-8 bg-amber-400 animate-pulse' :
                'w-4 bg-white/10'
              }`}
            />
          );
        })}
      </div>

      {/* Tap hint */}
      <svg className="w-4 h-4 text-[var(--text-secondary)] opacity-40 group-hover:opacity-80 group-hover:translate-x-0.5 transition-all shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
};

export default ProcessingBanner;
