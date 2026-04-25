import React from 'react';

type Tone = 'amber' | 'teal' | 'purple' | 'neutral';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  tone?: Tone;
  action?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  compact?: boolean;
}

const TONE_STYLES: Record<Tone, { iconBg: string; iconColor: string; button: string }> = {
  amber:   { iconBg: 'bg-amber-500/15',  iconColor: 'text-amber-400',  button: 'bg-amber-500 hover:bg-amber-400 text-black' },
  teal:    { iconBg: 'bg-teal-500/15',   iconColor: 'text-teal-400',   button: 'bg-teal-500 hover:bg-teal-400 text-black' },
  purple:  { iconBg: 'bg-purple-500/15', iconColor: 'text-purple-400', button: 'bg-purple-500 hover:bg-purple-400 text-white' },
  neutral: { iconBg: 'bg-white/[0.05]',  iconColor: 'text-[var(--text-tertiary)]', button: 'bg-white/[0.08] hover:bg-white/[0.12] text-[var(--text-primary)]' },
};

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  tone = 'neutral',
  action,
  secondaryAction,
  compact,
}) => {
  const styles = TONE_STYLES[tone];
  const padY = compact ? 'py-12' : 'py-20';

  return (
    <div className={`flex flex-col items-center justify-center ${padY} px-6 text-center animate-fade-in`}>
      <div className={`w-16 h-16 rounded-2xl ${styles.iconBg} flex items-center justify-center border border-white/[0.08] mb-5`}>
        <div className={`w-8 h-8 ${styles.iconColor}`}>{icon}</div>
      </div>
      <h3 className="font-display-tight text-lg font-semibold text-[var(--text-primary)] mb-1.5">
        {title}
      </h3>
      {description && (
        <p className="text-xs text-[var(--text-muted)] max-w-sm leading-relaxed">
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-3 mt-6">
          {action && (
            <button
              onClick={action.onClick}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.98] ${styles.button}`}
            >
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default EmptyState;
