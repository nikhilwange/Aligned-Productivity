/**
 * Unified date/time/duration formatters for the app.
 * Use these instead of inline toLocaleDateString/toLocaleTimeString calls
 * to keep display consistent across views.
 */

/** "Apr 23" — short month + day. Use in dense lists and cards. */
export const formatDateShort = (ts: number): string =>
  new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** "April 23, 2026" — long month + day + year. Use for headers and dividers. */
export const formatDateLong = (ts: number): string =>
  new Date(ts).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

/** "Monday, April 23" — full weekday + long month. Use for greetings. */
export const formatDateFull = (ts: number): string =>
  new Date(ts).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

/** "2:45 PM" — 12-hour local time. */
export const formatTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true });

/** "Today" / "Yesterday" / "3 days ago" / "Apr 12" — relative where recent, absolute otherwise. */
export const formatRelative = (ts: number): string => {
  const now = Date.now();
  const diffMs = now - ts;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay} days ago`;
  return formatDateShort(ts);
};

/** "1h 23m" / "45m" / "30s" — compact duration from seconds. */
export const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};
