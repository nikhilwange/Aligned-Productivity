// ─── Usage tiers — single source of truth ────────────────────────────────────
//
// This file defines the metered tiers (Free / Lite / Plus / Pro / Max) and the mapping from
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
// places: here, api/_lib/tiers.ts, and the Edge Function.

import type { PlanTier, PlanCycle } from '../types';

export interface TierConfig {
  /** Monthly audio-minutes budget. */
  monthlyMinutes: number;
  /** Per-session cap in minutes; null = no per-session limit. */
  sessionCapMinutes: number | null;
  /**
   * hard  — Free: blocked even mid-recording once the budget is used.
   * grace — Lite/Plus: new recordings blocked at the budget; one in progress
   *         may run up to GRACE_MINUTES past it (enforced server-side).
   * soft  — Pro/Max: new recordings blocked; one in progress always finishes.
   */
  enforcement: 'hard' | 'grace' | 'soft';
  label: string;
}

export const TIERS: Record<PlanTier, TierConfig> = {
  free: { monthlyMinutes: 120,  sessionCapMinutes: 60,   enforcement: 'hard',  label: 'Free' },
  lite: { monthlyMinutes: 240,  sessionCapMinutes: null, enforcement: 'grace', label: 'Lite' },
  plus: { monthlyMinutes: 480,  sessionCapMinutes: null, enforcement: 'grace', label: 'Plus' },
  pro:  { monthlyMinutes: 1200, sessionCapMinutes: null, enforcement: 'soft',  label: 'Pro'  },
  max:  { monthlyMinutes: 3600, sessionCapMinutes: null, enforcement: 'soft',  label: 'Max'  },
} as const;

/** Lite/Plus: how far past the monthly budget an in-progress recording may run. */
export const GRACE_MINUTES = 30;

export const ALL_TIERS: PlanTier[] = ['free', 'lite', 'plus', 'pro', 'max'];

// ─── Admin / unlimited-access allowlist ──────────────────────────────────────
//
// Accounts listed here bypass ALL usage caps and paywalls — no monthly-minutes
// budget, no per-session cap, never blocked. Kept as an explicit code allowlist
// so it needs no env var or DB row to take effect. This is the CLIENT copy;
// it MUST be mirrored server-side in api/_lib/tiers.ts and inline in the
// gemini-transcribe-audio Edge Function (the two authoritative gates).
const UNLIMITED_ACCESS_EMAILS = new Set<string>([
  'nikhil.wange2011@gmail.com',
]);

/** True when the given email has unlimited (uncapped) access. */
export function hasUnlimitedAccess(email: string | null | undefined): boolean {
  return !!email && UNLIMITED_ACCESS_EMAILS.has(email.trim().toLowerCase());
}

// Warn the user once they cross this fraction of their monthly budget.
export const USAGE_WARN_THRESHOLD = 0.8;

// Razorpay plan-ID → tier mapping lives server-side only (api/_lib/tiers.ts,
// RAZORPAY_PLAN_ID_* env on Vercel). The client sends a plan name ('lite',
// 'monthly', …) to checkout and reads the resulting tier from `subscriptions`.

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
