// Avatar helpers — initials + deterministic color from a name string.
// Granola palette: olive / terra / sage / brick. Used for owner avatars
// in ActionItemsView and the recent-meetings list in HomeView.

const PALETTE = ['#4a6b3a', '#d97757', '#6a8b5a', '#b85a3c'];

export const initialsOf = (name: string | null | undefined): string => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export const colorFor = (name: string | null | undefined): string => {
  if (!name) return PALETTE[0];
  const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return PALETTE[hash % PALETTE.length];
};

export const formatActionId = (displayId: number): string =>
  `A-${displayId.toString().padStart(3, '0')}`;
