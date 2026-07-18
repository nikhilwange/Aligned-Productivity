// ─── Feature flags ───────────────────────────────────────────────────────────
// Central home for runtime feature toggles.

// Phase 2: segmented recording + live per-segment upload + segment-wise
// processing. When FALSE, the app behaves byte-for-byte as it did before
// Phase 2 — the monolithic recorder, `handleRecordingComplete`, and
// `runProcessingForSession` are used unchanged. When TRUE, recordings are cut
// into ~5-minute self-contained segments that upload while the meeting is
// still in progress, and processing transcribes segment-by-segment so the full
// file is never decoded at once (removes the long-recording decode ceiling).
//
// This is the safety net: flip to `false` for an instant, complete rollback to
// the pre-Phase-2 path.
export const USE_SEGMENTED_RECORDING = true;

// Billing / paywall (Razorpay subscriptions + usage caps). When FALSE, the app
// ships the billing code but keeps it fully dormant: no usage cap or paywall
// gate on recording, no upgrade modal, no Billing/Pricing views or nav entry.
// Flip to TRUE only once Razorpay is configured in production (RAZORPAY_* env,
// VITE_RAZORPAY_PLAN_ID_*, and the dashboard webhook). Kept off so Phase 1/2
// recording can ship to production without turning on billing.
export const BILLING_ENABLED = false;
