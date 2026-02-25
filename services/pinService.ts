import { PinnedInsight } from '../types';

const STORAGE_KEY = 'aligned-pinned-insights';

export const getPinnedInsights = (): PinnedInsight[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const pinInsight = (insight: PinnedInsight): void => {
  const pins = getPinnedInsights();
  pins.unshift(insight);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
};

export const unpinInsight = (id: string): void => {
  const pins = getPinnedInsights().filter(p => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
};

export const isPinned = (id: string): boolean => {
  return getPinnedInsights().some(p => p.id === id);
};
