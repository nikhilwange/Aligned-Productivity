// ─── Usage tiers — single source of truth ────────────────────────────────────
//
// This file defines the metered tiers (Free / Pro / Max) and the mapping from
// Razorpay plan IDs to a tier. Unit economics: transcription + analysis costs
// ~₹35 per audio-hour (Sarvam ₹30/hr + Gemini ~₹5/hr), so every tier is a
// monthly audio-minutes budget.
//
// Limits are always MONTHLY (reset on the 1st, IST) and are billing-cycle
// agnostic — a monthly-Pro and an annual-Pro subscriber get the identical
// 1,200-minute budget; only how they pay differs.
//
// ⚠️ The server side (Sarvam Vercel route + gemini-transcribe-audio Edge
// Function) cannot import this file. It DUPLICATES the same numbers with a
// comment pointing back here. If you change a limit, change it in all three
// places: here, api/sarvam/transcribe.ts, and the Edge Function.

import type { PlanTier, PlanCycle } from '../types';

export interface TierConfig {
  /** Monthly audio-minutes budget. */
  monthlyMinutes: number;
  /** Per-session cap in minutes; null = no per-session limit. */
  sessionCapMinutes: number | null;
  /** Hard block (Free) vs soft cap (Pro/Max — finish the current session). */
  enforcement: 'hard' | 'soft';
  label: string;
}

export const TIERS: Record<PlanTier, TierConfig> = {
  free: { monthlyMinutes: 300,  sessionCapMinutes: 90,   enforcement: 'hard', label: 'Free' },
  pro:  { monthlyMinutes: 1200, sessionCapMinutes: null, enforcement: 'soft', label: 'Pro'  },
  max:  { monthlyMinutes: 3600, sessionCapMinutes: null, enforcement: 'soft', label: 'Max'  },
} as const;

export const ALL_TIERS: PlanTier[] = ['free', 'pro', 'max'];

// Warn the user once they cross this fraction of their monthly budget.
export const USAGE_WARN_THRESHOLD = 0.8;

// ─── Razorpay plan-ID → tier mapping ─────────────────────────────────────────
//
// Plan IDs are mode-specific (test vs live) and come from env so they can be
// swapped without a code change. Monthly and Annual Pro map to the SAME `pro`
// tier. Max is its own tier. An empty string means "not configured" and is
// simply never matched.
const RAZORPAY_PLAN_TIER_MAP: Record<string, PlanTier> = {
  [import.meta.env.VITE_RAZORPAY_PLAN_ID_MONTHLY ?? '']: 'pro',
  [import.meta.env.VITE_RAZORPAY_PLAN_ID_ANNUAL  ?? '']: 'pro',
  [import.meta.env.VITE_RAZORPAY_PLAN_ID_MAX     ?? '']: 'max',
};
// Never let an empty env var accidentally map '' → a paid tier.
delete RAZORPAY_PLAN_TIER_MAP[''];

/** Resolve a Razorpay plan ID to a tier. Unknown IDs fall back to 'free'. */
export function tierFromPlanId(planId: string | null | undefined): PlanTier {
  if (!planId) return 'free';
  return RAZORPAY_PLAN_TIER_MAP[planId] ?? 'free';
}

// ─── Access / tier resolution from a stored subscription ─────────────────────
//
// A subscription grants its paid tier while access is live. We keep access
// through payment trouble (halted / pending) and until period-end after a
// cancellation — matching the webhook's semantics and the UI copy
// ("You keep access until the period ends").
export interface SubscriptionAccessInput {
  planTier: PlanTier | null;
  status: string | null;
  currentPeriodEnd: number | null; // ms epoch
}

export function hasLiveAccess(sub: SubscriptionAccessInput | null): boolean {
  if (!sub || !sub.planTier || sub.planTier === 'free') return false;
  const s = sub.status;
  if (s === 'active' || s === 'halted' || s === 'pending') return true;
  if (s === 'cancelled' && sub.currentPeriodEnd != null && sub.currentPeriodEnd > Date.now()) {
    return true;
  }
  return false;
}

/** The effective tier a subscription grants right now (free if no live access). */
export function effectiveTier(sub: SubscriptionAccessInput | null): PlanTier {
  return hasLiveAccess(sub) ? (sub!.planTier as PlanTier) : 'free';
}

/** Human hours label, e.g. 300 → "5 hrs", 90 → "1.5 hrs". */
export function minutesToHoursLabel(minutes: number): string {
  const hrs = minutes / 60;
  const rounded = Math.round(hrs * 10) / 10;
  const clean = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${clean} hr${rounded === 1 ? '' : 's'}`;
}

// Convenience re-exports so callers can grab a single tier's numbers.
export const FREE_MONTHLY_MINUTES = TIERS.free.monthlyMinutes;
export const FREE_SESSION_CAP_MINUTES = TIERS.free.sessionCapMinutes;

export type { PlanCycle };
