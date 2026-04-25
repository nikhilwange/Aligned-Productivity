import React from 'react';

interface RecoveryModalProps {
  durationStr: string;
  timeAgo: number;
  onRecover: () => void;
  onDiscard: () => void;
}

const RecoveryModal: React.FC<RecoveryModalProps> = ({ durationStr, timeAgo, onRecover, onDiscard }) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative w-full max-w-sm rounded-2xl bg-[var(--surface-900)] border border-white/[0.08] shadow-2xl overflow-hidden animate-fade-in">
        {/* Glow accent */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-amber-500" />

        <div className="p-6">
          {/* Icon */}
          <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-amber-500/15 border border-white/[0.08] flex items-center justify-center">
            <svg className="w-7 h-7 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>

          {/* Content */}
          <h3 className="text-lg font-bold text-[var(--text-primary)] text-center mb-2">
            Recording Found
          </h3>
          <p className="text-sm text-[var(--text-secondary)] text-center mb-6 leading-relaxed">
            Found an unsaved recording from{' '}
            <span className="text-[var(--text-primary)] font-semibold">
              {timeAgo} minute{timeAgo !== 1 ? 's' : ''} ago
            </span>
            {durationStr !== 'unknown duration' && (
              <> ({durationStr})</>
            )}
            . Would you like to recover and process it?
          </p>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onDiscard}
              className="flex-1 px-4 py-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] text-sm font-semibold text-[var(--text-secondary)] transition-all active:scale-95"
            >
              Discard
            </button>
            <button
              onClick={onRecover}
              className="flex-1 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-sm font-bold text-black transition-all active:scale-95 shadow-lg"
            >
              Recover
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecoveryModal;
