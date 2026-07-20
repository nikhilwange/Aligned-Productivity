import React, { useState } from 'react';
import { cancelRazorpaySubscription } from '../services/subscriptionService';
import { TIERS, minutesToHoursLabel } from '../config/tiers';
import type { SubscriptionState } from '../types';

interface BillingSectionProps {
  state: SubscriptionState;
  onUpgradeClick: () => void;
  onCancelled?: () => void;
}

function fmtDate(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const TIER_LABEL: Record<string, string> = { free: 'Free', pro: 'Pro', max: 'Max' };

const BillingSection: React.FC<BillingSectionProps> = ({ state, onUpgradeClick, onCancelled }) => {
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCancel = async () => {
    setError(null);
    setCancelling(true);
    try {
      await cancelRazorpaySubscription();
      setConfirmCancel(false);
      onCancelled?.();
    } catch (err: any) {
      setError(err?.message ?? 'Cancel failed.');
    } finally {
      setCancelling(false);
    }
  };

  const sub = state.subscription;
  const isPro = state.isPro;
  const tierLabel = TIER_LABEL[state.tier] ?? 'Free';
  const limitMinutes = TIERS[state.tier].monthlyMinutes;
  const usedHours = (state.usage.minutes / 60).toFixed(1);

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-amber-400/80 font-mono">Billing</div>
          <div className="mt-0.5 text-base font-semibold text-[var(--text-primary)]">
            {isPro ? `${tierLabel} · ${sub?.planCycle === 'annual' ? 'Annual' : 'Monthly'}` : 'Free'}
          </div>
        </div>
        {/* Free → Upgrade; Pro → Upgrade to Max; Max → nothing to sell. */}
        {state.tier !== 'max' && (
          <button
            onClick={onUpgradeClick}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-sm font-semibold"
          >
            {state.tier === 'pro' ? 'Upgrade to Max' : 'Upgrade'}
          </button>
        )}
      </div>

      {/* Usage meter — every tier has a monthly audio-hours budget now. */}
      <div className="text-sm text-[var(--text-muted)] space-y-2">
        <div>
          <span className="text-[var(--text-primary)]/85 font-medium">{usedHours}</span>
          <span> of {minutesToHoursLabel(limitMinutes)}</span>
          <span className="opacity-70"> of audio this month</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            className={`h-full ${state.capPercent >= 1 ? 'bg-red-500' : state.capPercent >= 0.8 ? 'bg-amber-500' : 'bg-amber-500/60'}`}
            style={{ width: `${Math.min(100, Math.round(state.capPercent * 100))}%` }}
          />
        </div>
      </div>

      {isPro && (
        <div className="mt-3 text-sm text-[var(--text-muted)] space-y-1.5">
          {sub?.cancelAtPeriodEnd ? (
            <div className="text-amber-300">
              Cancels on {fmtDate(sub.currentPeriodEnd)}. You'll keep access until then.
            </div>
          ) : (
            <div>Renews on {fmtDate(sub?.currentPeriodEnd ?? null)}.</div>
          )}
          {sub?.status === 'halted' && (
            <div className="text-red-300">Payment failed — please update your payment method via Razorpay.</div>
          )}
          {!sub?.cancelAtPeriodEnd && (
            <button
              onClick={() => setConfirmCancel(true)}
              className="mt-1 text-xs underline text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Cancel subscription
            </button>
          )}
        </div>
      )}

      {confirmCancel && (
        <div className="mt-4 p-3 rounded-lg bg-white/[0.03] border border-white/[0.08]">
          <div className="text-sm text-[var(--text-primary)]">
            Cancel your {tierLabel} subscription? You'll keep access until {fmtDate(sub?.currentPeriodEnd ?? null)}.
          </div>
          {error && <div className="mt-2 text-xs text-red-300">{error}</div>}
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 text-sm font-medium disabled:opacity-50"
            >
              {cancelling ? 'Cancelling…' : 'Yes, cancel'}
            </button>
            <button
              onClick={() => { setConfirmCancel(false); setError(null); }}
              disabled={cancelling}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[var(--text-primary)] text-sm"
            >
              Keep {tierLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillingSection;
