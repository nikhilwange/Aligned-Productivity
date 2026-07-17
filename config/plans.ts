// Single source of truth for plan limits and presentation. Server and client
// both import from here so the Free cap shown in the UI never drifts from
// the cap actually enforced by the paywall hook.

import type { PlanCycle } from '../types';

export const FREE_CAP_MEETINGS = 10;
export const FREE_CAP_MINUTES = 120;

// Razorpay plan IDs. Created in the Razorpay dashboard once (step 0 in the
// rollout plan); pulled from env so test-mode vs live-mode are swappable
// without code changes. The Vite-prefixed names are intentional — the
// frontend needs the plan IDs too (for the pricing page display + the
// create-subscription POST body), and they aren't secret.
export const PLAN_IDS: Record<PlanCycle, string> = {
  monthly: import.meta.env.VITE_RAZORPAY_PLAN_ID_MONTHLY ?? '',
  annual:  import.meta.env.VITE_RAZORPAY_PLAN_ID_ANNUAL  ?? '',
};

// Display copy for the Pricing UI. Amount in INR (no paise) for human
// rendering. The amount that's actually charged comes from Razorpay's Plan
// row, NOT from here — keep these in sync with the dashboard manually.
export interface PlanDisplay {
  cycle: PlanCycle;
  label: string;
  priceInr: number;
  perPeriodLabel: string;
  pillLabel?: string;
}

export const PLAN_DISPLAY: Record<PlanCycle, PlanDisplay> = {
  monthly: {
    cycle: 'monthly',
    label: 'Monthly',
    priceInr: 499,
    perPeriodLabel: 'per month',
  },
  annual: {
    cycle: 'annual',
    label: 'Annual',
    priceInr: 4999,
    perPeriodLabel: 'per year',
    pillLabel: 'Save 17%',
  },
};

export const PRO_FEATURE_BULLETS = [
  'Unlimited meetings every month',
  'Unlimited audio minutes',
  'Strategist analysis across all your meetings',
  'Intelligence chat with citations',
  'Cancel anytime — keep access until period ends',
];
