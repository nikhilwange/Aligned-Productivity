import React from 'react';

export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`skeleton ${className}`} aria-hidden="true" />
);

/** Session card placeholder — matches the shape of a completed session row. */
export const SessionCardSkeleton: React.FC = () => (
  <div className="glass-card rounded-2xl border border-white/[0.06] p-4 flex items-start gap-3">
    <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
    <div className="flex-1 min-w-0 space-y-2 pt-0.5">
      <Skeleton className="h-3.5 w-2/3" />
      <Skeleton className="h-2.5 w-1/2" />
      <div className="flex gap-1.5 pt-1">
        <Skeleton className="h-2 w-10" />
        <Skeleton className="h-2 w-14" />
      </div>
    </div>
  </div>
);

/** Compact row skeleton — for the Sessions log list. */
export const SessionRowSkeleton: React.FC = () => (
  <div className="px-5 py-4 border-b border-white/[0.04] flex items-center gap-4">
    <Skeleton className="w-2 h-2 rounded-full" />
    <div className="flex-1 min-w-0 space-y-2">
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-2 w-1/4" />
    </div>
    <Skeleton className="h-2 w-12 shrink-0" />
  </div>
);

/** Stat number skeleton — for HomeView top stats block. */
export const StatSkeleton: React.FC = () => (
  <div className="space-y-2">
    <Skeleton className="h-8 w-14" />
    <Skeleton className="h-2.5 w-20" />
  </div>
);
