// Pricing / presentation for the billing UI. The ENFORCED numbers (monthly
// audio-minute budgets, per-session caps, plan-ID→tier mapping) live in
// config/tiers.ts — this file only describes how plans are shown and which
// Razorpay plan a checkout button maps to. Keep the displayed price in sync
// with the amount on the Razorpay Plan row manually (Razorpay is the source
// of truth for what's actually charged).

import type { PlanCycle, PlanTier } from '../types';
import { TIERS, minutesToHoursLabel } from './tiers';

// Legacy exports kept for any older imports. Gating is now minutes-only and
// tier-driven (config/tiers.ts); the meetings cap is no longer enforced.
export const FREE_CAP_MINUTES = TIERS.free.monthlyMinutes; // 300 (5 hrs)
export const FREE_CAP_MEETINGS = 10;

// A checkout "plan" the user can pick. Pro has two billing cycles; Max is
// monthly-only. All three are passed to /api/razorpay/create-subscription.
export type CheckoutPlan = 'monthly' | 'annual' | 'max';

// Razorpay plan IDs, pulled from env so test-mode vs live-mode are swappable
// without code changes. Not secret — the frontend needs them for the pricing
// display + the create-subscription POST body.
export const PLAN_IDS: Record<CheckoutPlan, string> = {
  monthly: import.meta.env.VITE_RAZORPAY_PLAN_ID_MONTHLY ?? '',
  annual:  import.meta.env.VITE_RAZORPAY_PLAN_ID_ANNUAL  ?? '',
  max:     import.meta.env.VITE_RAZORPAY_PLAN_ID_MAX      ?? '',
};

export interface PlanDisplay {
  cycle: PlanCycle;
  label: string;
  priceInr: number;
  perPeriodLabel: string;
  pillLabel?: string;
}

// Pro cycles (retained shape for existing consumers).
export const PLAN_DISPLAY: Record<PlanCycle, PlanDisplay> = {
  monthly: {
    cycle: 'monthly',
    label: 'Monthly',
    priceInr: 799,
    perPeriodLabel: 'per month',
  },
  annual: {
    cycle: 'annual',
    label: 'Annual',
    priceInr: 7999,
    perPeriodLabel: 'per year',
    pillLabel: '2 months free',
  },
};

// ─── Tier cards for the pricing UI / upgrade modal ───────────────────────────
export interface TierCard {
  tier: PlanTier;
  name: string;
  hoursLabel: string;          // e.g. "20 hrs / month"
  monthlyPriceInr: number;
  annualPriceInr: number | null; // null = no annual option (Max)
  checkoutPlan: CheckoutPlan;  // which plan the primary CTA subscribes to
  mostPopular?: boolean;
  bullets: string[];
}

const proHours = minutesToHoursLabel(TIERS.pro.monthlyMinutes); // 20 hrs
const maxHours = minutesToHoursLabel(TIERS.max.monthlyMinutes); // 60 hrs

export const TIER_CARDS: Record<'pro' | 'max', TierCard> = {
  pro: {
    tier: 'pro',
    name: 'Pro',
    hoursLabel: `${proHours} / month`,
    monthlyPriceInr: 799,
    annualPriceInr: 7999,
    checkoutPlan: 'monthly',
    mostPopular: true,
    bullets: [
      `${proHours} of audio every month`,
      'Unlimited meetings',
      'Strategist analysis across all your meetings',
      'Intelligence chat with citations',
      'Cancel anytime — keep access until period ends',
    ],
  },
  max: {
    tier: 'max',
    name: 'Max',
    hoursLabel: `${maxHours} / month`,
    monthlyPriceInr: 1999,
    annualPriceInr: null,
    checkoutPlan: 'max',
    bullets: [
      `${maxHours} of audio every month`,
      'Everything in Pro',
      'Best for daily, back-to-back recording',
      'Priority support',
    ],
  },
};

export const PRO_FEATURE_BULLETS = TIER_CARDS.pro.bullets;
