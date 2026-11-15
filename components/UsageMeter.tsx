import React from 'react';
import { TIERS, minutesToHoursLabel } from '../config/tiers';
import type { SubscriptionState } from '../types';

interface UsageMeterProps {
  state: SubscriptionState;
  onUpgrade?: () => void;
  /** Shown as "Need help?" once the limit is reached. */
  onNeedHelp?: () => void;
}

// Compact monthly audio-usage bar for the sidebar. Amber normally, red at
// ≥90%. Uses CSS variables + theme-neutral utility classes only.
const UsageMeter: React.FC<UsageMeterProps> = ({ state, onUpgrade, onNeedHelp }) => {
  if (state.loading) return null;

  // Unlimited-access (admin allowlist) accounts have an Infinity cap — show a
  // simple "Unlimited" state instead of a bar against a finite budget.
  const unlimited = !Number.isFinite(state.caps.minutes);
  const usedHours = (state.usage.minutes / 60).toFixed(1);
  const limitHrs = minutesToHoursLabel(TIERS[state.tier].monthlyMinutes);
  const pct = Math.min(100, Math.round(state.capPercent * 100));
  const danger = !unlimited && state.capPercent >= 0.9;
  const barColor = danger ? 'bg-red-500' : 'bg-amber-500/70';

  if (unlimited) {
    return (
      <div className="px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06]">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Usage
          </span>
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">
            {usedHours} hrs · Unlimited
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06]">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {TIERS[state.tier].label} · usage
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
      {state.isOverCap && onNeedHelp && (
        <button
          onClick={onNeedHelp}
          className="mt-1 w-full text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] text-left underline underline-offset-2"
        >
          Need help?
        </button>
      )}
    </div>
  );
};

export default UsageMeter;
