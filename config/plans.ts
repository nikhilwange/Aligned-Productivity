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
export const FREE_CAP_MINUTES = TIERS.free.monthlyMinutes; // 120 (2 hrs)
export const FREE_CAP_MEETINGS = 10;

// A checkout "plan" the user can pick. Pro has two billing cycles ('monthly'
// and 'annual'); Lite, Plus and Max are monthly-only. All are passed to
// /api/razorpay/create-subscription, which maps the name to the Razorpay plan
// ID from server env (RAZORPAY_PLAN_ID_*) — the client never needs the IDs.
export type CheckoutPlan = 'lite' | 'plus' | 'monthly' | 'annual' | 'max';

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
  tagline?: string;            // one short line under the price
  bullets: string[];
}

export type PaidTier = Exclude<PlanTier, 'free'>;

/** Paid tiers in display order (cheapest first). */
export const PAID_TIERS: PaidTier[] = ['lite', 'plus', 'pro', 'max'];

const liteHours = minutesToHoursLabel(TIERS.lite.monthlyMinutes); // 4 hrs
const plusHours = minutesToHoursLabel(TIERS.plus.monthlyMinutes); // 8 hrs
const proHours = minutesToHoursLabel(TIERS.pro.monthlyMinutes); // 20 hrs
const maxHours = minutesToHoursLabel(TIERS.max.monthlyMinutes); // 60 hrs

export const TIER_CARDS: Record<PaidTier, TierCard> = {
  lite: {
    tier: 'lite',
    name: 'Lite',
    hoursLabel: `${liteHours} / month`,
    monthlyPriceInr: 199,
    annualPriceInr: null,
    checkoutPlan: 'lite',
    tagline: 'For a few meetings a month',
    bullets: [
      `${liteHours} of audio every month`,
      'Cancel anytime — keep access until period ends',
    ],
  },
  plus: {
    tier: 'plus',
    name: 'Plus',
    hoursLabel: `${plusHours} / month`,
    monthlyPriceInr: 399,
    annualPriceInr: null,
    checkoutPlan: 'plus',
    tagline: 'For weekly meetings',
    bullets: [
      `${plusHours} of audio every month`,
      'Cancel anytime — keep access until period ends',
    ],
  },
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
