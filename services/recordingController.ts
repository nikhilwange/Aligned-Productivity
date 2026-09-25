// ─── App-level recording controller ─────────────────────────────────────────
//
// Owns the WHOLE lifetime of a recording: mic / screen streams, the capture
// AudioContext graph, the SegmentRecorder (MediaRecorder + rotation), the
// level meter, wake lock, Electron power blocker, Web Locks, prompts and the
// tick. It is a module-level singleton — no React component owns any of it —
// so navigating anywhere in the app (which unmounts the recorder screen) can
// never stop, orphan or duplicate a recording. Screens are views of this
// controller via `useRecording()`.
//
// Guiding rule: every way a recording ends goes through finalizeRecording(),
// which saves whatever was captured. Only an explicit, confirmed discard()
// drops audio.
//
// Capture graph (both modes):
//   mic / screen-audio sources ─┬─> MediaStreamDestination ─> SegmentRecorder
//                               └─> level meter (AudioWorklet, analyser fallback)
// Recording the destination's stream (not the raw mic) means a source that
// dies and is re-acquired is just re-wired into the graph; the recorder never
// sees its stream end. The context's clock is the "captured audio" clock: it
// stops while the device sleeps, which is how real sleep is told apart from
// mere timer throttling.

import { SegmentRecorder, deleteSegmentedRecording, manifestSavedMs } from './segmentRecorder';
import { clearLiveSession, subscribeLiveCeiling } from './liveTranscription';
import { getSegmentManifest } from './recordingRecovery';
import {
  STT_SESSION_CEILING_MIN,
  STT_CEILING_WARNING_MIN,
  SLEEP_RESUME_MAX_MIN,
  SLEEP_GAP_THRESHOLD_MIN,
  SLEEP_MAX_AUDIO_ADVANCE_SEC,
  SILENCE_AUTOSTOP_MIN,
  SILENCE_PROMPT_TIMEOUT_MIN,
  SILENCE_RMS_THRESHOLD,
  SHARE_ENDED_PROMPT_TIMEOUT_MIN,
  MIC_ONLY_REPROMPT_MIN,
  SHARE_SILENCE_RMS_THRESHOLD,
  SHARE_SILENCE_PROMPT_MIN,
  SHARE_SILENCE_PROMPT_TIMEOUT_MIN,
  MAX_PAUSE_MIN,
  PAUSE_REMINDER_MIN,
  CHECKPOINT_INTERVAL_SEC,
} from '../config/sttLimits';

export type InputMode = 'mic' | 'meeting' | 'call';

export type FinalizeReason =
  | 'user_stop'
  | 'session_ceiling'
  | 'long_sleep'
  | 'silence'
  | 'share_ended'
  | 'share_silent'
  | 'mic_ended'
  | 'pause_timeout'
  | 'tier_cap';

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'finalizing';

export interface RecorderPrompt {
  kind: 'silence' | 'share_ended' | 'share_silent';
  deadline: number; // ms epoch; no answer by then → finalize and save
}

export interface RecorderSnapshot {
  status: RecorderStatus;
  recoveryId: string | null;
  inputMode: InputMode | null;
  source: string | null;
  /** Audio actually captured, excluding sleep gaps. Drives the timer. */
  capturedMs: number;
  /** Continuous silence so far, in captured-audio time. */
  silenceMs: number;
  prompt: RecorderPrompt | null;
  /** Meeting mode only: screen/tab audio is currently feeding the recording. */
  shareLive: boolean;
  /** Paused by the user: nothing is captured, every clock/sound check is off. */
  paused: boolean;
  /** ms epoch when the current pause began (null while not paused). */
  pausedAt: number | null;
  /** Paused for PAUSE_REMINDER_MIN: "Recording still paused — it will be saved in …". */
  pauseReminder: boolean;
  /** Resume failed (microphone could not be re-acquired); still paused. */
  resumeError: string | null;
  /** Non-blocking notice after resuming from a short sleep. */
  sleepNotice: { gapMin: number } | null;
}

export interface RecordingResult {
  recoveryId: string;
  source: string;
  /** Seconds — sum of the manifest's segment durations (sleep excluded). */
  durationSec: number;
  reason: FinalizeReason;
  /**
   * Releases the per-recording lock. It is handed over still HELD so no other
   * tab can rescue this recording between "capture ended" and "processing
   * started"; the app calls this when processing is done (idempotent).
   */
  releaseRecordingLock: () => void;
}

/** Why a recording could not start. `start()` resolves to null on success. */
export interface StartFailure {
  code: 'busy' | 'other_tab' | 'no_share_audio' | 'denied' | 'no_device' | 'failed';
  message: string;
}

export interface RecorderHandlers {
  /** The recording ended and was flushed; process it (never called for discard). */
  onFinalized?: (result: RecordingResult) => void;
  /** Heads-up before an automatic stop (ceiling / free-tier cap). */
  onWarning?: (kind: 'session_ceiling' | 'tier_cap', minutesLeft: number) => void;
}

const GLOBAL_LOCK = 'aligned-recorder';
const recordingLockName = (recoveryId: string) => `aligned-recorder:${recoveryId}`;

export const sourceForMode = (mode: InputMode): string =>
  mode === 'meeting' ? 'virtual-meeting' : mode === 'call' ? 'phone-call' : 'in-person';

// Used by start() and reconnectShare() alike.
const DISPLAY_MEDIA_OPTIONS = {
  video: true,
  audio: { echoCancellation: true },
  systemAudio: 'include',
};

const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

const IS_DEV = !!(import.meta as any).env?.DEV;

// ─── Web Locks ──────────────────────────────────────────────────────────────

type LockHandle = { release: () => void } | null | 'unsupported';

/** Try to take `name` without waiting; hold it until release() is called. */
function holdLock(name: string): Promise<LockHandle> {
  const locks = (navigator as any)?.locks;
  if (!locks?.request) return Promise.resolve('unsupported');
  return new Promise((resolve) => {
    locks
      .request(name, { ifAvailable: true }, (lock: unknown) => {
        if (!lock) { resolve(null); return undefined; }
        return new Promise<void>((release) => resolve({ release: () => release() }));
      })
      .catch(() => resolve('unsupported'));
  });
}

/**
 * Is this recording being captured right now in another tab (or this one)?
 * The recorder holds a per-recording lock for its whole life, and the browser
 * drops it the moment that tab closes or crashes. Returns null when the
 * browser has no Web Locks, so callers fall back to their older heuristics.
 */
export async function isRecordingLive(recoveryId: string): Promise<boolean | null> {
  const handle = await holdLock(recordingLockName(recoveryId));
  if (handle === 'unsupported') return null;
  if (handle === null) return true;
  handle.release();
  return false;
}

/**
 * Claim a recording for rescue / resume processing. Returns a release
 * function, `null` when another tab holds it (live or already being
 * processed there — never rescue), or a no-op release when the browser has
 * no Web Locks.
 */
export async function claimRecording(recoveryId: string): Promise<(() => void) | null> {
  const handle = await holdLock(recordingLockName(recoveryId));
  if (handle === 'unsupported') return () => {};
  if (handle === null) return null;
  return handle.release;
}

// ─── Level meter worklet ────────────────────────────────────────────────────
// Runs on the audio thread, which is NOT throttled when the tab is hidden or
// the screen is locked, so silence is measured on real audio, not on the
// ~1/min timer ticks a background tab gets. Posts the peak RMS every ~0.5 s.
const LEVEL_WORKLET_SOURCE = `
class AlignedLevel extends AudioWorkletProcessor {
  constructor() { super(); this.peak = 0; this.frames = 0; }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const ch = input[0];
      let sum = 0;
      for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
      const rms = Math.sqrt(sum / (ch.length || 1));
      if (rms > this.peak) this.peak = rms;
    }
    this.frames += 128;
    if (this.frames >= sampleRate / 2) {
      this.port.postMessage({ t: currentTime, rms: this.peak });
      this.peak = 0;
      this.frames = 0;
    }
    return true;
  }
}
registerProcessor('aligned-level', AlignedLevel);
`;

// ─── Screen wake lock (the tab-hidden release is handled via visibilitychange) ──
class WakeLockHolder {
  private sentinel: any = null;
  private active = false;
  private onVisibility = () => {
    if (document.visibilityState === 'visible') this.acquire();
  };

  start(): void {
    this.active = true;
    this.acquire();
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  stop(): void {
    this.active = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    const s = this.sentinel;
    this.sentinel = null;
    if (s) { try { s.release(); } catch { /* ignore */ } }
  }

  private async acquire(): Promise<void> {
    const wakeLock: any = (navigator as any)?.wakeLock;
    if (!wakeLock || !this.active || this.sentinel) return;
    if (document.visibilityState !== 'visible') return;
    try {
      const s = await wakeLock.request('screen');
      if (!this.active) { try { await s.release(); } catch { /* ignore */ } return; }
      this.sentinel = s;
      s.addEventListener('release', () => { if (this.sentinel === s) this.sentinel = null; });
    } catch (err) {
      console.warn('[Recorder] wake lock request failed:', (err as Error)?.message);
    }
  }
}

/** Electron only: keep the app from being suspended while recording. */
function electronPowerBlocker(action: 'start' | 'stop'): void {
  try { (window as any).ipcRenderer?.send?.('power-blocker', action); } catch { /* not Electron */ }
}

// ─── The controller ─────────────────────────────────────────────────────────

type LevelStats = { min: number; max: number; sum: number; n: number; since: number };
const freshLevelStats = (): LevelStats => ({ min: Infinity, max: 0, sum: 0, n: 0, since: Date.now() });

// A prompt left unanswered past its deadline saves the recording for this reason.
const PROMPT_TIMEOUT_REASON: Record<RecorderPrompt['kind'], FinalizeReason> = {
  silence: 'silence',
  share_ended: 'share_ended',
  share_silent: 'share_silent',
};

const rmsOf = (analyser: AnalyserNode): number => {
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
};

interface ActiveRecording {
  recoveryId: string;
  inputMode: InputMode;
  source: string;
  sessionCapMinutes: number | null;
  ctx: AudioContext;
  dest: MediaStreamAudioDestinationNode;
  meterInputs: AudioNode[]; // worklet node and/or analyser — every source connects to these
  analyser: AnalyserNode;
  worklet: AudioWorkletNode | null;
  micStream: MediaStream | null;
  micSource: MediaStreamAudioSourceNode | null;
  unwatchMic: (() => void) | null; // detaches the current mic 'ended' watcher
  displayStream: MediaStream | null;
  displaySource: MediaStreamAudioSourceNode | null;
  // Level meter on the meeting audio ALONE: a worklet, or an analyser read per tick as fallback.
  shareMeter: AudioWorkletNode | AnalyserNode | null;
  seg: SegmentRecorder;
  locks: Array<{ release: () => void }>; // the global single-recorder lock
  recordingLock: { release: () => void } | null; // per-recording; handed to processing
  wakeLock: WakeLockHolder;
  tick: number | null;
  lastWall: number;
  lastAudio: number; // ctx.currentTime (s)
  lastSpeechAudio: number; // ctx.currentTime (s) of the last non-silent level
  lastShareSoundAudio: number; // ctx.currentTime (s) of the last non-silent MEETING-audio level
  micOnlySinceMs: number | null; // capturedMs when the user chose to carry on mic-only
  shareEndedWhilePaused: boolean; // → the share_ended prompt on Resume, not during the pause
  lastCheckpointWall: number;
  warned: Set<'session_ceiling' | 'tier_cap'>;
  levelStats: LevelStats;
  shareLevelStats: LevelStats;
  cleanup: Array<() => void>;
}

const IDLE_SNAPSHOT: RecorderSnapshot = {
  status: 'idle',
  recoveryId: null,
  inputMode: null,
  source: null,
  capturedMs: 0,
  silenceMs: 0,
  prompt: null,
  shareLive: false,
  paused: false,
  pausedAt: null,
  pauseReminder: false,
  resumeError: null,
  sleepNotice: null,
};

class RecordingController {
  private snapshot: RecorderSnapshot = IDLE_SNAPSHOT;
  private listeners = new Set<() => void>();
  private handlers: RecorderHandlers = {};
  private rec: ActiveRecording | null = null;
  private finalizing: Promise<void> | null = null;
  private reconnecting = false;
  private resuming = false;

  // ── store plumbing (useSyncExternalStore) ──
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): RecorderSnapshot => this.snapshot;

  private set(patch: Partial<RecorderSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
  }

  setHandlers(handlers: RecorderHandlers): () => void {
    this.handlers = handlers;
    return () => { if (this.handlers === handlers) this.handlers = {}; };
  }

  isActive(): boolean {
    return this.snapshot.status !== 'idle';
  }

  // ── start ──────────────────────────────────────────────────────────────
  async start(opts: { inputMode: InputMode; sessionCapMinutes?: number | null }): Promise<StartFailure | null> {
    if (this.snapshot.status !== 'idle') {
      return { code: 'busy', message: 'A recording is already in progress.' };
    }
    // Claim the slot synchronously so a double click can't start two.
    this.set({ ...IDLE_SNAPSHOT, status: 'starting', inputMode: opts.inputMode, source: sourceForMode(opts.inputMode) });

    const locks: Array<{ release: () => void }> = [];
    const locksToReleaseOnFailure: Array<{ release: () => void }> = [];
    const streams: MediaStream[] = [];
    // Created synchronously, inside the user's click, BEFORE any await: some
    // browsers (Safari) only let an AudioContext start during the gesture, and
    // every recording is captured through this context's graph.
    let ctx: AudioContext | null = null;
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      void ctx.resume().catch(() => {});
    } catch (err) {
      console.error('[Recorder] AudioContext unavailable:', err);
    }
    let step: 'share' | 'mic' | 'graph' = 'mic';
    const fail =(code: StartFailure['code'], message: string): StartFailure => {
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      if (ctx) ctx.close().catch(() => {});
      [...locks, ...locksToReleaseOnFailure].forEach((l) => l.release());
      this.set(IDLE_SNAPSHOT);
      return { code, message };
    };

    // One recording across all tabs.
    const global = await holdLock(GLOBAL_LOCK);
    if (global === null) {
      return fail('other_tab', 'A recording is already running in another tab.');
    }
    if (global === 'unsupported') {
      console.warn('[Recorder] Web Locks unavailable — cross-tab single-recorder guard is off');
    } else {
      locks.push(global);
    }

    // Random suffix: two recorders can never share an id, even if started in
    // the same millisecond (the old `rec-<ms>` form could collide on a double
    // click, which let an orphaned recorder keep writing to a finished
    // recording). Old `rec-<ms>` ids stay valid everywhere — ids are only ever
    // matched whole or split on ":seg", never parsed for the time.
    const recoveryId = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
    const mode = opts.inputMode;
    try {
      let micStream: MediaStream | null = null;
      let displayStream: MediaStream | null = null;
      if (mode === 'meeting') {
        step = 'share';
        displayStream = await (navigator.mediaDevices as any).getDisplayMedia(DISPLAY_MEDIA_OPTIONS);
        streams.push(displayStream!);
        if (displayStream!.getAudioTracks().length === 0) {
          return fail('no_share_audio', 'Share audio was not selected.');
        }
        step = 'mic';
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streams.push(micStream);
      } else {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
        streams.push(micStream);
      }

      step = 'graph';
      if (!ctx) throw new Error('AudioContext unavailable');
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      if (ctx.state !== 'running') {
        console.warn(`[Recorder] AudioContext is "${ctx.state}" after start — will keep trying to resume on each tick`);
      }
      const dest = ctx.createMediaStreamDestination();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      let worklet: AudioWorkletNode | null = null;
      if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        try {
          const url = URL.createObjectURL(new Blob([LEVEL_WORKLET_SOURCE], { type: 'application/javascript' }));
          await ctx.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);
          worklet = new AudioWorkletNode(ctx, 'aligned-level', { numberOfInputs: 1, numberOfOutputs: 1 });
          // The worklet writes nothing to its output; connecting it keeps it
          // in the rendered graph so it is always processed.
          worklet.connect(dest);
        } catch (err) {
          console.warn('[Recorder] level worklet unavailable, using analyser fallback:', (err as Error)?.message);
          worklet = null;
        }
      }
      const meterInputs: AudioNode[] = worklet ? [worklet, analyser] : [analyser];

      const connect = (stream: MediaStream): MediaStreamAudioSourceNode => {
        const node = ctx!.createMediaStreamSource(stream);
        node.connect(dest);
        meterInputs.forEach((m) => node.connect(m));
        return node;
      };
      const displaySource = displayStream ? connect(displayStream) : null;
      const micSource = micStream ? connect(micStream) : null;

      // Per-recording lock: another tab may rescue this manifest only once it's gone.
      const own = await holdLock(recordingLockName(recoveryId));
      const recordingLock = own && own !== 'unsupported' ? own : null;
      if (recordingLock) locksToReleaseOnFailure.push(recordingLock);

      const clockCtx = ctx;
      const seg = new SegmentRecorder({
        stream: dest.stream,
        sessionId: recoveryId,
        source: sourceForMode(mode),
        clock: () => clockCtx.currentTime * 1000,
      });

      const now = Date.now();
      const rec: ActiveRecording = {
        recoveryId,
        inputMode: mode,
        source: sourceForMode(mode),
        sessionCapMinutes: opts.sessionCapMinutes && opts.sessionCapMinutes > 0 ? opts.sessionCapMinutes : null,
        ctx,
        dest,
        meterInputs,
        analyser,
        worklet,
        micStream,
        micSource,
        unwatchMic: null,
        displayStream,
        displaySource,
        shareMeter: null,
        seg,
        locks,
        recordingLock,
        wakeLock: new WakeLockHolder(),
        tick: null,
        lastWall: now,
        lastAudio: ctx.currentTime,
        lastSpeechAudio: ctx.currentTime,
        lastShareSoundAudio: ctx.currentTime,
        micOnlySinceMs: null,
        shareEndedWhilePaused: false,
        lastCheckpointWall: now,
        warned: new Set(),
        levelStats: freshLevelStats(),
        shareLevelStats: freshLevelStats(),
        cleanup: [],
      };
      this.rec = rec;
      this.wireRecording(rec);
      seg.start();

      this.set({
        status: 'recording',
        recoveryId,
        inputMode: mode,
        source: rec.source,
        capturedMs: 0,
        silenceMs: 0,
        prompt: null,
        shareLive: !!displayStream,
        sleepNotice: null,
      });
      console.log(`[Recorder] started ${recoveryId} (${rec.source}, worklet: ${worklet ? 'yes' : 'no'})`);
      return null;
    } catch (err: any) {
      console.error('[Recorder] failed to start:', err);
      this.rec = null;
      if (step === 'share' && err?.name === 'NotAllowedError') return fail('denied', 'Screen sharing was cancelled, so the recording did not start.');
      if (err?.name === 'NotAllowedError') return fail('denied', 'Microphone access was denied. Please allow microphone permission in your browser settings and try again.');
      if (err?.name === 'NotFoundError') return fail('no_device', 'No microphone detected. Please connect a microphone and try again.');
      return fail('failed', 'Could not start recording. Please check your microphone and try again.');
    }
  }

  /** Listeners, tick, wake lock, power blocker — everything torn down in teardown(). */
  private wireRecording(rec: ActiveRecording): void {
    // Level meter.
    if (rec.worklet) {
      rec.worklet.port.onmessage = (e: MessageEvent) => this.onLevel(rec, e.data?.t ?? rec.ctx.currentTime, e.data?.rms ?? 0);
    }

    // Track endings.
    this.watchMic(rec);
    this.watchShare(rec);
    this.attachShareMeter(rec);

    // Tab close / hide: save the in-progress segment so at most a few seconds are lost.
    const onPageHide = () => { void rec.seg.checkpoint(); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') void rec.seg.checkpoint(); };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      void rec.seg.checkpoint();
      e.preventDefault();
      e.returnValue = 'Recording is in progress. Are you sure you want to leave?';
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    rec.cleanup.push(() => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
    });

    // Server says this recording hit the STT ceiling → stop and save.
    rec.cleanup.push(subscribeLiveCeiling((sessionId) => {
      if (sessionId === rec.recoveryId) void this.finalizeRecording('session_ceiling');
    }));

    rec.wakeLock.start();
    electronPowerBlocker('start');

    rec.tick = window.setInterval(() => this.onTick(rec), 1000);
  }

  /** Re-attach the ended handler to the current mic track (replacing any previous one). */
  private watchMic(rec: ActiveRecording): void {
    rec.unwatchMic?.();
    rec.unwatchMic = null;
    const track = rec.micStream?.getAudioTracks()[0];
    if (!track) return;
    const onEnded = () => { track.removeEventListener('ended', onEnded); void this.onMicEnded(rec); };
    track.addEventListener('ended', onEnded);
    const off = () => track.removeEventListener('ended', onEnded);
    rec.unwatchMic = off;
    rec.cleanup.push(off);
  }

  /**
   * Let go of the microphone (pause) so the OS "mic in use" light turns off.
   * The watcher is detached FIRST — otherwise stopping the track would look
   * like a disconnect and onMicEnded() would re-acquire it.
   */
  private releaseMic(rec: ActiveRecording): void {
    rec.unwatchMic?.();
    rec.unwatchMic = null;
    try { rec.micSource?.disconnect(); } catch { /* ignore */ }
    rec.micStream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    rec.micStream = null;
    rec.micSource = null;
  }

  /**
   * Attach the ended handler to the current screen stream's tracks. Bound to
   * THAT stream, so one replaced by reconnectShare() can never raise a prompt.
   */
  private watchShare(rec: ActiveRecording): void {
    const stream = rec.displayStream;
    if (!stream) return;
    const tracks = stream.getTracks();
    const onEnded = () => { if (rec.displayStream === stream) this.onShareEnded(rec); };
    tracks.forEach((t) => t.addEventListener('ended', onEnded));
    rec.cleanup.push(() => tracks.forEach((t) => t.removeEventListener('ended', onEnded)));
  }

  /**
   * Put a level meter on the current meeting-audio source ONLY — not the mic,
   * not the shared worklet — so a meeting tab gone silent after the call is
   * seen even over office noise on the mic. A second instance of the level
   * worklet (module already loaded in start()), so it keeps measuring in a
   * background tab; an analyser read per tick when the worklet is unavailable.
   * Replaces any previous meter.
   */
  private attachShareMeter(rec: ActiveRecording): void {
    this.detachShareMeter(rec);
    const source = rec.displaySource;
    if (!source) return;
    if (rec.worklet) {
      try {
        const node = new AudioWorkletNode(rec.ctx, 'aligned-level', { numberOfInputs: 1, numberOfOutputs: 1 });
        node.port.onmessage = (e: MessageEvent) => this.onShareLevel(rec, e.data?.t ?? rec.ctx.currentTime, e.data?.rms ?? 0);
        node.connect(rec.dest); // writes nothing; keeps it in the rendered graph
        source.connect(node);
        rec.shareMeter = node;
        return;
      } catch (err) {
        console.warn('[Recorder] meeting-audio level worklet unavailable, using analyser fallback:', (err as Error)?.message);
      }
    }
    const analyser = rec.ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    rec.shareMeter = analyser;
  }

  private detachShareMeter(rec: ActiveRecording): void {
    const meter = rec.shareMeter;
    if (!meter) return;
    rec.shareMeter = null;
    if (meter instanceof AudioWorkletNode) meter.port.onmessage = null;
    try { meter.disconnect(); } catch { /* ignore */ }
  }

  private onLevel(rec: ActiveRecording, audioT: number, rms: number): void {
    if (this.rec !== rec) return;
    if (rms >= SILENCE_RMS_THRESHOLD) rec.lastSpeechAudio = audioT;
    if (IS_DEV) {
      const s = rec.levelStats;
      s.min = Math.min(s.min, rms); s.max = Math.max(s.max, rms); s.sum += rms; s.n++;
      if (Date.now() - s.since >= 30_000 && s.n > 0) {
        console.debug(
          `[Recorder] level (30s): min ${s.min.toFixed(4)} avg ${(s.sum / s.n).toFixed(4)} ` +
          `max ${s.max.toFixed(4)} — silence threshold ${SILENCE_RMS_THRESHOLD}`,
        );
        rec.levelStats = freshLevelStats();
      }
    }
  }

  /** Meeting audio alone (see attachShareMeter). */
  private onShareLevel(rec: ActiveRecording, audioT: number, rms: number): void {
    if (this.rec !== rec) return;
    if (rms >= SHARE_SILENCE_RMS_THRESHOLD) rec.lastShareSoundAudio = audioT;
    if (IS_DEV) {
      const s = rec.shareLevelStats;
      s.min = Math.min(s.min, rms); s.max = Math.max(s.max, rms); s.sum += rms; s.n++;
      if (Date.now() - s.since >= 30_000 && s.n > 0) {
        console.debug(
          `[Recorder] meeting audio level (30s): min ${s.min.toFixed(5)} avg ${(s.sum / s.n).toFixed(5)} ` +
          `max ${s.max.toFixed(5)} — silence threshold ${SHARE_SILENCE_RMS_THRESHOLD}`,
        );
        rec.shareLevelStats = freshLevelStats();
      }
    }
  }

  private onTick(rec: ActiveRecording): void {
    if (this.rec !== rec || this.snapshot.status !== 'recording') return;
    const now = Date.now();
    const audioNow = rec.ctx.currentTime;
    const wallDelta = now - rec.lastWall;
    const audioDeltaMs = Math.max(0, (audioNow - rec.lastAudio) * 1000);

    // A context the OS suspended (e.g. on wake) must be restarted, or nothing records.
    if (rec.ctx.state !== 'running' && rec.ctx.state !== 'closed') {
      rec.ctx.resume().catch(() => {});
    }

    // ── Paused: nothing is captured and every clock / sound check is off ──
    // Keep the baselines current so pause time is neither captured audio nor
    // a sleep (a device sleeping mid-pause is not a gap). Only the pause
    // limit runs, in every paused state (including a failed Resume).
    if (this.snapshot.paused) {
      rec.lastWall = now;
      rec.lastAudio = audioNow;
      const pausedMs = now - (this.snapshot.pausedAt ?? now);
      if (pausedMs >= MAX_PAUSE_MIN * 60_000) {
        console.warn(`[Recorder] paused for ${MAX_PAUSE_MIN} min — saving`);
        void this.finalizeRecording('pause_timeout');
        return;
      }
      if (!this.snapshot.pauseReminder && pausedMs >= PAUSE_REMINDER_MIN * 60_000) {
        console.warn(`[Recorder] paused for ${PAUSE_REMINDER_MIN} min — reminding`);
        this.set({ pauseReminder: true });
      }
      return;
    }

    // Analyser fallback for the level meters (worklet unavailable).
    if (!rec.worklet) this.onLevel(rec, audioNow, rmsOf(rec.analyser));
    if (rec.shareMeter instanceof AnalyserNode) this.onShareLevel(rec, audioNow, rmsOf(rec.shareMeter));

    // ── Real sleep vs throttling ──
    // Throttled (locked / hidden) tab: wall clock jumps ~1 min per tick, but
    // audio keeps flowing, so audioDelta ≈ wallDelta → not sleep.
    // Real sleep: wall clock jumps, audio barely moved.
    if (wallDelta > SLEEP_GAP_THRESHOLD_MIN * 60_000 && audioDeltaMs < SLEEP_MAX_AUDIO_ADVANCE_SEC * 1000) {
      const gapMs = wallDelta - audioDeltaMs;
      const gapMin = Math.round(gapMs / 60_000);
      console.warn(`[Recorder] device slept ~${gapMin} min (wall +${Math.round(wallDelta / 1000)}s, audio +${Math.round(audioDeltaMs / 1000)}s)`);
      rec.lastWall = now;
      rec.lastAudio = audioNow;
      rec.lastSpeechAudio = audioNow; // sleep is not silence
      rec.lastShareSoundAudio = audioNow;
      if (gapMs >= SLEEP_RESUME_MAX_MIN * 60_000) {
        void this.finalizeRecording('long_sleep');
        return;
      }
      // Short sleep: same session. Cut the segment at the gap, note it, carry on.
      void rec.seg.recordGap({ startedAt: now - wallDelta, gapMs });
      rec.seg.cutSegment();
      this.set({
        capturedMs: this.snapshot.capturedMs + audioDeltaMs, // the few seconds that were captured
        sleepNotice: { gapMin: Math.max(1, gapMin) },
      });
      return;
    }
    rec.lastWall = now;
    rec.lastAudio = audioNow;

    const capturedMs = this.snapshot.capturedMs + audioDeltaMs;
    const silenceMs = Math.max(0, (audioNow - rec.lastSpeechAudio) * 1000);
    this.set({ capturedMs, silenceMs });

    // ── Periodic checkpoint of the segment in progress ──
    if (now - rec.lastCheckpointWall >= CHECKPOINT_INTERVAL_SEC * 1000) {
      rec.lastCheckpointWall = now;
      void rec.seg.checkpoint();
    }

    // ── Prompts: answer deadline passed → stop and SAVE ──
    const prompt = this.snapshot.prompt;
    if (prompt && now >= prompt.deadline) {
      void this.finalizeRecording(PROMPT_TIMEOUT_REASON[prompt.kind]);
      return;
    }

    // ── Silence ──
    if (!prompt && silenceMs >= SILENCE_AUTOSTOP_MIN * 60_000) {
      console.warn(`[Recorder] ${SILENCE_AUTOSTOP_MIN} min of silence — asking "Still recording?"`);
      this.set({ prompt: { kind: 'silence', deadline: now + SILENCE_PROMPT_TIMEOUT_MIN * 60_000 } });
    }

    // ── Meeting audio silent while still shared (call left, tab kept open) ──
    // Only asks: a meeting where everyone is muted is silent too. Sharing that
    // has ENDED is the share_ended prompt's job (shareLive is false then).
    const shareSilentMs = Math.max(0, (audioNow - rec.lastShareSoundAudio) * 1000);
    if (!this.snapshot.prompt && this.snapshot.shareLive && rec.shareMeter && shareSilentMs >= SHARE_SILENCE_PROMPT_MIN * 60_000) {
      console.warn(`[Recorder] meeting audio silent for ${SHARE_SILENCE_PROMPT_MIN} min — asking "Did your meeting end?"`);
      this.set({ prompt: { kind: 'share_silent', deadline: now + SHARE_SILENCE_PROMPT_TIMEOUT_MIN * 60_000 } });
    }

    // ── Still mic-only after "Keep recording" → ask again ──
    if (
      !this.snapshot.prompt && !this.snapshot.shareLive && rec.micOnlySinceMs !== null &&
      capturedMs - rec.micOnlySinceMs >= MIC_ONLY_REPROMPT_MIN * 60_000
    ) {
      console.warn(`[Recorder] mic-only for ${MIC_ONLY_REPROMPT_MIN} min — asking about meeting audio again`);
      this.set({ prompt: { kind: 'share_ended', deadline: now + SHARE_ENDED_PROMPT_TIMEOUT_MIN * 60_000 } });
    }

    // ── Limits (captured audio, not wall clock) ──
    const capturedMin = capturedMs / 60_000;
    const limits: Array<{ kind: 'session_ceiling' | 'tier_cap'; min: number }> = [
      { kind: 'session_ceiling', min: STT_SESSION_CEILING_MIN },
    ];
    if (rec.sessionCapMinutes) limits.push({ kind: 'tier_cap', min: rec.sessionCapMinutes });
    for (const lim of limits) {
      if (capturedMin >= lim.min) {
        void this.finalizeRecording(lim.kind);
        return;
      }
      if (capturedMin >= lim.min - STT_CEILING_WARNING_MIN && !rec.warned.has(lim.kind)) {
        rec.warned.add(lim.kind);
        try { this.handlers.onWarning?.(lim.kind, Math.max(1, Math.ceil(lim.min - capturedMin))); } catch { /* ignore */ }
      }
    }
  }

  private async onMicEnded(rec: ActiveRecording): Promise<void> {
    if (this.rec !== rec || this.snapshot.status !== 'recording' || this.snapshot.paused) return;
    console.warn('[Recorder] microphone track ended — trying to re-acquire');
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({
        audio: rec.inputMode === 'meeting' ? true : MIC_CONSTRAINTS,
      });
      if (this.rec !== rec) { fresh.getTracks().forEach((t) => t.stop()); return; }
      try { rec.micSource?.disconnect(); } catch { /* ignore */ }
      rec.micStream?.getTracks().forEach((t) => t.stop());
      const node = rec.ctx.createMediaStreamSource(fresh);
      node.connect(rec.dest);
      rec.meterInputs.forEach((m) => node.connect(m));
      rec.micStream = fresh;
      rec.micSource = node;
      this.watchMic(rec);
      console.log('[Recorder] microphone re-acquired, recording continues');
    } catch (err) {
      console.warn('[Recorder] could not re-acquire microphone:', (err as Error)?.message);
      rec.micStream = null;
      // Virtual mode can carry on with screen audio alone; in-person can't.
      const shareLive = rec.displayStream?.getAudioTracks().some((t) => t.readyState === 'live');
      if (!shareLive) void this.finalizeRecording('mic_ended');
    }
  }

  private onShareEnded(rec: ActiveRecording): void {
    if (this.rec !== rec || this.snapshot.status !== 'recording') return;
    if (this.snapshot.prompt?.kind === 'share_ended') return; // audio + video both fire
    // Paused (mic deliberately released): no countdown now — Resume asks.
    if (this.snapshot.paused) {
      console.warn('[Recorder] screen sharing ended while paused — will ask on Resume');
      rec.shareEndedWhilePaused = true;
      this.set({ shareLive: false });
      return;
    }
    const micLive = rec.micStream?.getAudioTracks().some((t) => t.readyState === 'live');
    console.warn(`[Recorder] screen sharing ended (mic ${micLive ? 'still live' : 'gone'})`);
    if (!micLive) {
      void this.finalizeRecording('share_ended');
      return;
    }
    this.set({ shareLive: false, prompt: { kind: 'share_ended', deadline: Date.now() + SHARE_ENDED_PROMPT_TIMEOUT_MIN * 60_000 } });
  }

  /** Answer the current prompt. "keep" continues; "stop" is a normal user stop. */
  respondToPrompt(answer: 'keep' | 'stop'): void {
    const rec = this.rec;
    const prompt = this.snapshot.prompt;
    if (!rec || !prompt) return;
    if (answer === 'stop') {
      void this.finalizeRecording('user_stop');
      return;
    }
    if (prompt.kind === 'silence') rec.lastSpeechAudio = rec.ctx.currentTime; // another full window
    // Any "keep" restarts the meeting-silence window too, so one answer is
    // never followed straight away by "Did your meeting end?".
    rec.lastShareSoundAudio = rec.ctx.currentTime;
    // Carrying on mic-only: count from now to the next re-ask.
    if (prompt.kind === 'share_ended' && !this.snapshot.shareLive) rec.micOnlySinceMs = this.snapshot.capturedMs;
    console.log(`[Recorder] prompt "${prompt.kind}" → keep recording`);
    this.set({ prompt: null, silenceMs: 0 });
  }

  /**
   * Re-capture meeting audio into the SAME recording (after sharing ended).
   * Call it straight from a click handler: getDisplayMedia is its first async
   * step, or the browser refuses it. The old share is retired first, so only
   * one meeting-audio source ever feeds the recording; the segment recorder
   * records `dest` and never notices. Resolves to a message for the user, or
   * null (reconnected, cancelled, or the recording has ended).
   */
  async reconnectShare(): Promise<string | null> {
    const rec = this.rec;
    if (!rec || rec.inputMode !== 'meeting' || this.snapshot.status !== 'recording' || this.snapshot.paused || this.reconnecting) return null;
    this.reconnecting = true;
    let fresh: MediaStream;
    try {
      fresh = await (navigator.mediaDevices as any).getDisplayMedia(DISPLAY_MEDIA_OPTIONS);
    } catch (err: any) {
      if (err?.name === 'NotAllowedError') return null; // picker cancelled
      console.warn('[Recorder] could not reconnect meeting audio:', err?.message);
      return 'Could not reconnect meeting audio. Please try again.';
    } finally {
      this.reconnecting = false;
    }
    const stopFresh = () => fresh.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    // Saved (deadline, Stop) while the picker was open.
    if (this.rec !== rec || this.snapshot.status !== 'recording') { stopFresh(); return null; }
    if (fresh.getAudioTracks().length === 0) {
      stopFresh();
      return "Share audio was not selected — tick 'Share tab audio' and try again.";
    }
    // Retire the old share completely: never two meeting-audio sources.
    try { rec.displaySource?.disconnect(); } catch { /* ignore */ }
    rec.displayStream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    const node = rec.ctx.createMediaStreamSource(fresh);
    node.connect(rec.dest);
    rec.meterInputs.forEach((m) => node.connect(m));
    rec.displayStream = fresh;
    rec.displaySource = node;
    this.watchShare(rec);
    this.attachShareMeter(rec); // retires the old meter
    rec.lastShareSoundAudio = rec.ctx.currentTime;
    rec.micOnlySinceMs = null;
    console.log('[Recorder] meeting audio reconnected');
    const prompt = this.snapshot.prompt?.kind === 'share_ended' ? null : this.snapshot.prompt;
    this.set({ shareLive: true, prompt });
    return null;
  }

  // ── pause / resume ─────────────────────────────────────────────────────

  /**
   * Pause: close the current segment (saved, uploaded, live-transcribed like
   * any other), release the mic, capture nothing. Virtual mode keeps the
   * screen share open so Resume needs no re-picking. Pausing is a clear
   * answer to any prompt showing, so it is cleared.
   */
  pause(): void {
    const rec = this.rec;
    if (!rec || this.snapshot.status !== 'recording' || this.snapshot.paused) return;
    rec.seg.pause();
    this.releaseMic(rec);
    this.set({ paused: true, pausedAt: Date.now(), pauseReminder: false, resumeError: null, prompt: null, silenceMs: 0 });
    console.log(`[Recorder] paused ${rec.recoveryId}`);
  }

  /**
   * Resume: re-acquire the mic (same constraints as start), start a new
   * segment, note the pause for the transcript marker, and restart every
   * check with a full window. If there is nothing to record from — no mic in
   * person, or no mic and no meeting audio in virtual mode — it stays paused
   * with `resumeError`; the pause limit keeps running, so it is still saved.
   */
  async resume(): Promise<void> {
    const rec = this.rec;
    if (!rec || this.snapshot.status !== 'recording' || !this.snapshot.paused || this.resuming) return;
    this.resuming = true;
    try {
      let mic: MediaStream | null = null;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: rec.inputMode === 'meeting' ? true : MIC_CONSTRAINTS });
      } catch (err) {
        console.warn('[Recorder] could not re-acquire the microphone on resume:', (err as Error)?.message);
      }
      if (this.rec !== rec || this.snapshot.status !== 'recording' || !this.snapshot.paused) {
        mic?.getTracks().forEach((t) => t.stop());
        return;
      }
      const shareLive = rec.inputMode === 'meeting' && !!rec.displayStream?.getAudioTracks().some((t) => t.readyState === 'live');
      if (!mic && !shareLive) {
        this.set({
          resumeError: rec.inputMode === 'meeting'
            ? 'Could not turn the microphone back on, and meeting audio is off. Check your microphone and try Resume again, or Stop & save.'
            : 'Could not turn the microphone back on. Check it is connected and try Resume again, or Stop & save.',
        });
        return;
      }
      if (mic) {
        const node = rec.ctx.createMediaStreamSource(mic);
        node.connect(rec.dest);
        rec.meterInputs.forEach((m) => node.connect(m));
        rec.micStream = mic;
        rec.micSource = node;
        this.watchMic(rec);
      } else {
        console.warn('[Recorder] resuming with meeting audio only (no microphone)');
      }

      const now = Date.now();
      const pausedAt = this.snapshot.pausedAt ?? now;
      const nextSegment = rec.seg.resume();
      void rec.seg.recordGap({ kind: 'pause', startedAt: pausedAt, gapMs: now - pausedAt, nextSegment: nextSegment ?? undefined });

      // Every window restarts full, not from where it was before the pause.
      const t = rec.ctx.currentTime;
      rec.lastSpeechAudio = t;
      rec.lastShareSoundAudio = t;
      rec.lastAudio = t;
      rec.lastWall = now;
      if (rec.micOnlySinceMs !== null) rec.micOnlySinceMs = this.snapshot.capturedMs;
      // Sharing ended during the pause: ask now, with a fresh countdown.
      const prompt: RecorderPrompt | null = rec.shareEndedWhilePaused && !shareLive
        ? { kind: 'share_ended', deadline: now + SHARE_ENDED_PROMPT_TIMEOUT_MIN * 60_000 }
        : null;
      rec.shareEndedWhilePaused = false;
      this.set({
        paused: false, pausedAt: null, pauseReminder: false, resumeError: null,
        silenceMs: 0, shareLive: rec.inputMode === 'meeting' ? shareLive : false, prompt,
      });
      console.log(`[Recorder] resumed ${rec.recoveryId} after ${Math.round((now - pausedAt) / 1000)}s`);
    } finally {
      this.resuming = false;
    }
  }

  dismissSleepNotice(): void {
    this.set({ sleepNotice: null });
  }

  // ── ending ─────────────────────────────────────────────────────────────

  /**
   * THE way a recording ends (other than discard). Idempotent: every caller
   * gets the same promise. Stops capture, flushes the last partial segment
   * (cache + upload), tears everything down, releases the locks, then hands
   * the recording to the app to be processed and saved.
   */
  finalizeRecording(reason: FinalizeReason): Promise<void> {
    if (this.finalizing) return this.finalizing;
    const rec = this.rec;
    if (!rec || this.snapshot.status !== 'recording') return Promise.resolve();
    console.log(`[Recorder] finalizing ${rec.recoveryId} (${reason})`);
    this.set({ status: 'finalizing', prompt: null });

    this.finalizing = (async () => {
      this.stopTimersAndListeners(rec);
      try {
        await rec.seg.stop(); // flushes + uploads the last partial segment
      } catch (err) {
        console.error('[Recorder] segment stop failed (manifest kept for recovery):', err);
      }
      const manifest = await getSegmentManifest(rec.recoveryId);
      const durationMs = manifest
        ? manifestSavedMs(manifest) // decoded length when within ±5% of the audio clock
        : this.snapshot.capturedMs;
      this.teardownCapture(rec);

      const recordingLock = rec.recordingLock;
      rec.recordingLock = null;
      let released = false;
      const result: RecordingResult = {
        recoveryId: rec.recoveryId,
        source: rec.source,
        durationSec: Math.round(durationMs / 1000),
        reason,
        releaseRecordingLock: () => {
          if (released) return;
          released = true;
          try { recordingLock?.release(); } catch { /* ignore */ }
        },
      };
      this.rec = null;
      this.finalizing = null;
      this.set(IDLE_SNAPSHOT);
      console.log(`[Recorder] finalized ${rec.recoveryId}: ${result.durationSec}s captured`);
      if (this.handlers.onFinalized) {
        try { this.handlers.onFinalized(result); } catch (err) { console.error('[Recorder] onFinalized failed:', err); }
      } else {
        // Nothing to hand to (shouldn't happen): the manifest stays in
        // IndexedDB and is recovered on the next load.
        console.warn('[Recorder] no handoff registered — recording left for recovery');
        result.releaseRecordingLock();
      }
    })();
    return this.finalizing;
  }

  /**
   * Drop the recording and all its audio. The ONLY path that loses audio —
   * callers must have confirmed with the user first.
   */
  async discard(): Promise<void> {
    const rec = this.rec;
    if (!rec || this.snapshot.status !== 'recording') return;
    console.log(`[Recorder] discarding ${rec.recoveryId} (user confirmed)`);
    this.set({ status: 'finalizing', prompt: null });
    this.finalizing = (async () => {
      this.stopTimersAndListeners(rec);
      try { await rec.seg.stop(); } catch { /* deleting anyway */ }
      this.teardownCapture(rec);
      this.releaseRecordingLock(rec);
      clearLiveSession(rec.recoveryId);
      await deleteSegmentedRecording(rec.recoveryId, undefined, { kind: 'user_confirmed', action: 'discard_recording' }).catch((err) =>
        console.error('[Recorder] discard cleanup failed:', err));
      this.rec = null;
      this.finalizing = null;
      this.set(IDLE_SNAPSHOT);
    })();
    return this.finalizing;
  }

  private stopTimersAndListeners(rec: ActiveRecording): void {
    if (rec.tick !== null) { clearInterval(rec.tick); rec.tick = null; }
    rec.cleanup.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    rec.cleanup = [];
    if (rec.worklet) rec.worklet.port.onmessage = null;
    this.detachShareMeter(rec);
  }

  /** Stop every track, close the graph, release wake lock / power blocker / locks. */
  private teardownCapture(rec: ActiveRecording): void {
    [rec.micStream, rec.displayStream, rec.dest.stream].forEach((s) =>
      s?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } }));
    rec.ctx.close().catch(() => {});
    rec.wakeLock.stop();
    electronPowerBlocker('stop');
    rec.locks.forEach((l) => { try { l.release(); } catch { /* ignore */ } });
    rec.locks = [];
  }

  /** Release the per-recording lock too (discard / no handoff). */
  private releaseRecordingLock(rec: ActiveRecording): void {
    try { rec.recordingLock?.release(); } catch { /* ignore */ }
    rec.recordingLock = null;
  }
}

export const recordingController = new RecordingController();
