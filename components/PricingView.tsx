import React, { useState } from 'react';
import { TIER_CARDS, type CheckoutPlan, type TierCard } from '../config/plans';
import { createRazorpaySubscription } from '../services/subscriptionService';
import type { PlanTier, User } from '../types';

// Razorpay Checkout SDK global. Loaded lazily by loadCheckoutScript() the
// first time the user starts a subscription — visitors who never open billing
// load no third-party script. Constructor signature shaped by their docs at
// https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => { open: () => void };
  }
}

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let checkoutScriptPromise: Promise<void> | null = null;

// Inject checkout.js once and resolve when window.Razorpay is available.
function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (checkoutScriptPromise) return checkoutScriptPromise;
  checkoutScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => {
      if (window.Razorpay) resolve();
      else reject(new Error('Payment widget failed to initialise.'));
    };
    script.onerror = () => {
      checkoutScriptPromise = null;
      reject(new Error('Could not load the payment widget. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return checkoutScriptPromise;
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
  // When set, show only these tiers (e.g. ['max'] for the Pro→Max upsell).
  onlyTiers?: PlanTier[];
  onClose?: () => void;
  onSubscribed?: () => void;
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

const PricingView: React.FC<PricingViewProps> = ({
  user,
  variant = 'page',
  onlyTiers,
  onClose,
  onSubscribed,
}) => {
  const [busy, setBusy] = useState<CheckoutPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubscribe = async (plan: CheckoutPlan, description: string) => {
    setError(null);
    setBusy(plan);
    try {
      const [{ subscription_id, key_id }] = await Promise.all([
        createRazorpaySubscription(plan),
        loadCheckoutScript(),
      ]);
      const rzp = new window.Razorpay!({
        key: key_id,
        subscription_id,
        name: 'Aligned',
        description,
        prefill: { email: user.email, name: user.name },
        notes: { user_id: user.id, plan },
        theme: { color: '#f59e0b' },
        handler: () => onSubscribed?.(),
        modal: { ondismiss: () => setBusy(null) },
      });
      rzp.open();
    } catch (err: any) {
      setError(err?.message ?? 'Could not start the payment flow.');
      setBusy(null);
    }
  };

  const isModal = variant === 'modal';
  const cards: TierCard[] = (['pro', 'max'] as const)
    .map((t) => TIER_CARDS[t])
    .filter((c) => !onlyTiers || onlyTiers.includes(c.tier));

  const heading = onlyTiers?.length === 1 && onlyTiers[0] === 'max'
    ? 'Upgrade to Max'
    : isModal ? 'Upgrade your plan' : 'Pricing';

  return (
    <div className={isModal ? 'p-6 md:p-8' : 'p-6 md:p-12 max-w-4xl mx-auto'}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold text-[var(--text-primary)] tracking-tight">
            {heading}
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1.5">
            Free includes 5 hours of audio per month. Paid plans give you far more headroom.
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

      <div className={`grid grid-cols-1 ${cards.length > 1 ? 'md:grid-cols-2' : ''} gap-4 mt-6`}>
        {cards.map((card) => {
          const monthlyBusy = busy === card.checkoutPlan;
          const annualBusy = busy === 'annual';
          const anyBusy = busy !== null;
          return (
            <div
              key={card.tier}
              className={`relative rounded-2xl border p-6 flex flex-col ${
                card.mostPopular
                  ? 'border-amber-500/40 bg-amber-500/[0.04]'
                  : 'border-white/[0.08] bg-white/[0.02]'
              }`}
            >
              {card.mostPopular && (
                <span className="absolute -top-2.5 right-5 px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-semibold tracking-wide">
                  Most popular
                </span>
              )}
              <div className="text-[11px] uppercase tracking-[0.14em] text-amber-400/80 font-mono">
                Aligned {card.name}
              </div>
              <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{card.hoursLabel}</div>
              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
                  {inr(card.monthlyPriceInr)}
                </span>
                <span className="text-sm text-[var(--text-muted)]">per month</span>
              </div>

              <ul className="mt-5 space-y-2.5 text-sm text-[var(--text-primary)]/85">
                {card.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2.5">
                    <svg className="w-4 h-4 mt-0.5 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleSubscribe(card.checkoutPlan, `${card.name} · Monthly`)}
                disabled={anyBusy}
                className="mt-6 w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/40 text-black font-semibold transition-colors"
              >
                {monthlyBusy ? 'Opening checkout…' : `Subscribe — ${inr(card.monthlyPriceInr)}/mo`}
              </button>

              {/* Secondary annual option (Pro only). */}
              {card.annualPriceInr != null && (
                <button
                  onClick={() => handleSubscribe('annual', `${card.name} · Annual`)}
                  disabled={anyBusy}
                  className="mt-2 w-full py-2 px-4 rounded-xl border border-amber-500/30 text-amber-300 hover:bg-amber-500/[0.06] text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {annualBusy
                    ? 'Opening checkout…'
                    : `or ${inr(card.annualPriceInr)}/yr — 2 months free`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-[var(--text-muted)] text-center">
        Payments processed by Razorpay · Cancel anytime · You keep access until the period ends
      </p>
    </div>
  );
};

export default PricingView;
