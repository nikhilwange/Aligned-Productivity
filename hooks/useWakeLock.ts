import { useEffect, useRef } from 'react';

// Keeps the screen awake while `active` is true using the Screen Wake Lock API.
//
// Fully feature-detected and defensive:
//   - No-ops silently if `navigator.wakeLock` is undefined (older Safari, etc.).
//   - Wake locks are automatically released by the browser when the tab is
//     hidden, so we re-acquire on `visibilitychange` when the tab becomes
//     visible again and we're still meant to be active.
//   - Every call is wrapped in try/catch; a wake-lock failure never throws.
export function useWakeLock(active: boolean): void {
  // Typed loosely so the hook compiles regardless of the TS DOM lib version
  // (WakeLock / WakeLockSentinel aren't in older lib.dom typings).
  const sentinelRef = useRef<any>(null);

  useEffect(() => {
    const wakeLock: any = (navigator as any)?.wakeLock;
    if (!wakeLock) return; // Unsupported — behave exactly as before.

    let cancelled = false;

    const acquire = async () => {
      if (!active || cancelled) return;
      // Only meaningful while the document is visible.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (sentinelRef.current) return; // Already held.
      try {
        const sentinel: any = await wakeLock.request('screen');
        if (cancelled || !active) {
          try { await sentinel.release(); } catch { /* ignore */ }
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener('release', () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null;
        });
      } catch (err) {
        // e.g. NotAllowedError when the tab isn't visible — safe to ignore.
        console.warn('[WakeLock] request failed:', (err as Error)?.message);
      }
    };

    const release = () => {
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel) {
        try { sentinel.release(); } catch { /* ignore */ }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') acquire();
    };

    if (active) {
      acquire();
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      release();
    };
  }, [active]);
}
