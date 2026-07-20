import React from 'react';
import { TIERS, minutesToHoursLabel } from '../config/tiers';
import type { SubscriptionState } from '../types';

interface UsageMeterProps {
  state: SubscriptionState;
  onUpgrade?: () => void;
}

const TIER_LABEL: Record<string, string> = { free: 'Free', pro: 'Pro', max: 'Max' };

// Compact monthly audio-usage bar for the sidebar. Amber normally, red at
// ≥90%. Uses CSS variables + theme-neutral utility classes only.
const UsageMeter: React.FC<UsageMeterProps> = ({ state, onUpgrade }) => {
  if (state.loading) return null;

  const limitMinutes = TIERS[state.tier].monthlyMinutes;
  const usedHours = (state.usage.minutes / 60).toFixed(1);
  const limitHrs = minutesToHoursLabel(limitMinutes);
  const pct = Math.min(100, Math.round(state.capPercent * 100));
  const danger = state.capPercent >= 0.9;
  const barColor = danger ? 'bg-red-500' : 'bg-amber-500/70';

  return (
    <div className="px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06]">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {TIER_LABEL[state.tier]} · usage
        </span>
        <span className={`text-[11px] font-medium ${danger ? 'text-red-300' : 'text-[var(--text-secondary)]'}`}>
          {usedHours} / {limitHrs}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      {state.tier !== 'max' && state.capPercent >= 0.8 && onUpgrade && (
        <button
          onClick={onUpgrade}
          className="mt-2 w-full text-[11px] font-semibold text-amber-300 hover:text-amber-200 text-left"
        >
          {state.isOverCap ? 'Limit reached — upgrade →' : 'Running low — upgrade →'}
        </button>
      )}
    </div>
  );
};

export default UsageMeter;
