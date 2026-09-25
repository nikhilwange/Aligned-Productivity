import { useEffect, useRef } from 'react';
import { useRecording } from './useRecording';
import type { RecorderPrompt } from '../services/recordingController';

// Pull the user back when the recorder needs an answer. During a meeting the
// user is usually in another tab or app, where the in-app prompt card can't be
// seen, so a system notification is shown (and, in the desktop app, the
// window is brought forward). Driven by snapshot.prompt, so it closes itself
// however the prompt ends: answered, reconnected, timed out and saved.
// Without notification permission the in-app prompt works exactly as before.

const PERMISSION_ASKED_KEY = 'aligned-notify-permission-asked';

const minutesText = (deadline: number): string => {
  const min = Math.max(1, Math.round((deadline - Date.now()) / 60_000));
  return `${min} minute${min === 1 ? '' : 's'}`;
};

// One entry per prompt kind; a kind without an entry raises no alert.
const ALERT_COPY: Record<RecorderPrompt['kind'], { title: string; body: (deadline: number) => string }> = {
  share_ended: {
    title: 'Meeting audio stopped',
    body: (d) => `Aligned will save your recording in ${minutesText(d)}. Click to choose.`,
  },
  share_silent: {
    title: 'Did your meeting end?',
    body: (d) => `The meeting audio has been silent for a while. Aligned will save your recording in ${minutesText(d)}. Click to choose.`,
  },
  silence: {
    title: 'Still recording?',
    body: (d) => `We haven't heard anything for a while. Aligned will save your recording in ${minutesText(d)}. Click to choose.`,
  },
};

const notificationsSupported = (): boolean => typeof window !== 'undefined' && 'Notification' in window;

/**
 * Ask for notification permission once, ever. Call it when the user picks
 * virtual-meeting mode — never in the click that starts recording, where an
 * await before getDisplayMedia would break screen sharing.
 */
export function requestPromptAlertPermission(): void {
  if (!notificationsSupported() || Notification.permission !== 'default') return;
  try {
    if (localStorage.getItem(PERMISSION_ASKED_KEY) === '1') return;
    localStorage.setItem(PERMISSION_ASKED_KEY, '1');
  } catch { /* storage blocked: still ask this once */ }
  Notification.requestPermission().catch(() => { /* ignore */ });
}

/** Desktop app: show + focus the window (main flashes the taskbar if it can't). No-op in a browser. */
function focusDesktopWindow(): void {
  try { (window as any).ipcRenderer?.send?.('focus-window'); } catch { /* not Electron */ }
}

/** Alert while a recorder prompt is open; `onOpen` shows the recorder screen. */
export function usePromptAlert(onOpen: () => void): void {
  const { prompt, recoveryId } = useRecording();
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (!prompt || !recoveryId) return;
    const copy = ALERT_COPY[prompt.kind];
    if (!copy) return;
    const away = document.visibilityState === 'hidden' || !document.hasFocus();
    focusDesktopWindow();
    if (!away || !notificationsSupported() || Notification.permission !== 'granted') return;

    let n: Notification | null = null;
    try {
      n = new Notification(copy.title, {
        body: copy.body(prompt.deadline),
        tag: `aligned-recorder-${recoveryId}`, // one per recording, replaced not stacked
        requireInteraction: true,
      });
      n.onclick = () => {
        window.focus();
        onOpenRef.current();
        n?.close();
      };
    } catch (err) {
      console.warn('[Recorder] could not show notification:', (err as Error)?.message);
    }
    return () => { n?.close(); };
  }, [prompt, recoveryId]);
}
