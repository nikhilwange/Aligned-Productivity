// ─── Per-session pipeline run tokens ────────────────────────────────────────
//
// A hung-but-alive pipeline must not interleave with a Retry/auto-resume of the
// same session (double progress writes, shared chunk-storage paths, one run
// cleaning up files the other needs). Each key gets at most one live
// AbortController; starting a new run aborts the previous one, whose awaits then
// unwind and exit silently (guarded on `signal.aborted` before any state write).
//
// Phase 3 note: this map used to live inside App.tsx. It moved here so the live
// transcription worker (services/liveTranscription.ts) can register its own
// controller in the SAME map — keeping one authority for "who is allowed to do
// Sarvam work right now".
//
// Two different key spaces share this map, and that is intentional:
//   - `session.id`   — the recordings-row UUID, used by the post-Finish pipeline
//                      (runProcessingForSession / runSegmentedProcessingForSession).
//   - `recoveryId`   — the `rec-{ts}` segment-recorder session id, used by the
//                      live worker while the meeting is still being recorded.
// They never collide, and the finisher explicitly aborts the recoveryId key when
// it takes over (see abortPipelineRun).

const pipelineControllers = new Map<string, AbortController>();

/** Abort any in-flight run for this key and register a fresh controller. */
export const beginPipelineRun = (key: string): AbortController => {
  const prev = pipelineControllers.get(key);
  if (prev) prev.abort(new DOMException('Superseded by a newer run', 'AbortError'));
  const controller = new AbortController();
  pipelineControllers.set(key, controller);
  return controller;
};

/** Abort the in-flight run for this key, if any, and forget it. */
export const abortPipelineRun = (key: string): void => {
  const prev = pipelineControllers.get(key);
  if (!prev) return;
  prev.abort(new DOMException('Superseded by a newer run', 'AbortError'));
  pipelineControllers.delete(key);
};

/** True when `controller` is still the registered run for this key. */
export const isCurrentPipelineRun = (key: string, controller: AbortController): boolean =>
  pipelineControllers.get(key) === controller;

/** Drop the registration for this key when `controller` still owns it. */
export const endPipelineRun = (key: string, controller: AbortController): boolean => {
  if (pipelineControllers.get(key) !== controller) return false;
  pipelineControllers.delete(key);
  return true;
};
