import React from 'react';

/**
 * Shown above a failed / interrupted session in the last RETENTION_WARNING_DAYS
 * before the server's audio-retention sweep deletes its audio (30 days after
 * the last upload). Retrying before then keeps it.
 */
const AudioRetentionNotice: React.FC<{ daysLeft: number }> = ({ daysLeft }) => (
  <div className="w-full flex items-center gap-3 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/15" role="status">
    <p className="flex-1 min-w-0 text-xs font-medium text-[var(--text-secondary)]">
      Audio will be deleted {daysLeft <= 0 ? 'today' : `in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`}.
      <span className="text-[var(--text-muted)]"> Retry processing before then to keep this recording.</span>
    </p>
  </div>
);

export default AudioRetentionNotice;
