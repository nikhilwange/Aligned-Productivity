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
