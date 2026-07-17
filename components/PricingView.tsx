import React, { useState } from 'react';
import { PLAN_DISPLAY, PRO_FEATURE_BULLETS } from '../config/plans';
import { createRazorpaySubscription } from '../services/subscriptionService';
import type { PlanCycle, User } from '../types';

// Razorpay Checkout SDK global. We load it via <script> in index.html; the
// constructor signature is shaped by their docs at
// https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => { open: () => void };
  }
}

interface RazorpayCheckoutOptions {
  key: string;
  subscription_id: string;
  name?: string;
  description?: string;
  prefill?: { email?: string; name?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler?: (response: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => void;
  modal?: { ondismiss?: () => void };
}

interface PricingViewProps {
  user: User;
  variant?: 'page' | 'modal';
  onClose?: () => void;
  onSubscribed?: () => void;
}

const PricingView: React.FC<PricingViewProps> = ({ user, variant = 'page', onClose, onSubscribed }) => {
  const [busy, setBusy] = useState<PlanCycle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubscribe = async (cycle: PlanCycle) => {
    setError(null);
    if (!window.Razorpay) {
      setError('Payment widget is loading. Please try again in a moment.');
      return;
    }
    setBusy(cycle);
    try {
      const { subscription_id, key_id } = await createRazorpaySubscription(cycle);
      const rzp = new window.Razorpay({
        key: key_id,
        subscription_id,
        name: 'Aligned',
        description: `Pro · ${cycle === 'monthly' ? 'Monthly' : 'Annual'}`,
        prefill: { email: user.email, name: user.name },
        notes: { user_id: user.id, cycle },
        theme: { color: '#f59e0b' },
        handler: () => {
          // Source of truth is the webhook; this only fires as a UX nicety.
          onSubscribed?.();
        },
        modal: { ondismiss: () => setBusy(null) },
      });
      rzp.open();
    } catch (err: any) {
      setError(err?.message ?? 'Could not start the payment flow.');
      setBusy(null);
    }
  };

  const isModal = variant === 'modal';

  return (
    <div className={isModal ? 'p-6 md:p-8' : 'p-6 md:p-12 max-w-4xl mx-auto'}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold text-[var(--text-primary)] tracking-tight">
            {isModal ? 'Upgrade to Pro' : 'Pricing'}
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1.5">
            Free includes 10 meetings or 120 minutes of audio per month. Pro removes every limit.
          </p>
        </div>
        {isModal && onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 -m-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        {(['monthly', 'annual'] as const).map((cycle) => {
          const p = PLAN_DISPLAY[cycle];
          const isBusy = busy === cycle;
          return (
            <div
              key={cycle}
              className="relative rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 flex flex-col"
            >
              {p.pillLabel && (
                <span className="absolute -top-2.5 right-5 px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-semibold tracking-wide">
                  {p.pillLabel}
                </span>
              )}
              <div className="text-[11px] uppercase tracking-[0.14em] text-amber-400/80 font-mono">
                Aligned Pro
              </div>
              <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{p.label}</div>
              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
                  ₹{p.priceInr.toLocaleString('en-IN')}
                </span>
                <span className="text-sm text-[var(--text-muted)]">{p.perPeriodLabel}</span>
              </div>
              <ul className="mt-5 space-y-2.5 text-sm text-[var(--text-primary)]/85">
                {PRO_FEATURE_BULLETS.map((b) => (
                  <li key={b} className="flex items-start gap-2.5">
                    <svg className="w-4 h-4 mt-0.5 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => handleSubscribe(cycle)}
                disabled={isBusy || busy !== null}
                className="mt-6 w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/40 text-black font-semibold transition-colors"
              >
                {isBusy ? 'Opening checkout…' : `Subscribe — ₹${p.priceInr.toLocaleString('en-IN')}/${cycle === 'monthly' ? 'mo' : 'yr'}`}
              </button>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-[var(--text-muted)] text-center">
        Payments processed by Razorpay · Cancel anytime · You keep Pro until the period ends
      </p>
    </div>
  );
};

export default PricingView;
