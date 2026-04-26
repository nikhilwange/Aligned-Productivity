import React, { useMemo } from 'react';
import { RecordingSession, TrackedActionItem } from '../types';
import { Skeleton, SessionCardSkeleton } from './Skeleton';
import EmptyState from './EmptyState';
import { formatDateShort, formatDateFull, formatDuration } from '../utils/formatters';
import { initialsOf, colorFor } from '../utils/avatar';

interface HomeViewProps {
  user: { name: string; email: string };
  recordings: RecordingSession[];
  actionItems?: TrackedActionItem[];
  isLoading?: boolean;
  onSelectSession: (id: string) => void;
  onStartNew: () => void;
}

const STORAGE_KEY = 'aligned-action-items-done';
const loadDoneIds = (): Set<string> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
};

const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

const HomeView: React.FC<HomeViewProps> = ({
  user, recordings, actionItems, isLoading, onSelectSession, onStartNew
}) => {
  const doneIds = useMemo(() => loadDoneIds(), []);

  const completedRecordings = useMemo(() =>
    recordings.filter(r => r.status === 'completed'),
    [recordings]
  );

  const pendingCount = useMemo(() => {
    if (actionItems) return actionItems.filter(i => i.status !== 'completed').length;
    let count = 0;
    completedRecordings.forEach(rec => {
      (rec.analysis?.actionPoints ?? []).forEach((_, i) => {
        if (!doneIds.has(`${rec.id}-${i}`)) count++;
      });
    });
    return count;
  }, [actionItems, completedRecordings, doneIds]);

  const thisMonthSessions = useMemo(() => {
    const now = new Date();
    return recordings.filter(r => {
      const d = new Date(r.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
  }, [recordings]);

  const totalHours = useMemo(() =>
    completedRecordings.reduce((acc, r) => acc + r.duration, 0) / 3600,
    [completedRecordings]
  );

  const recentSessions = completedRecordings
    .slice()
    .sort((a, b) => b.date - a.date)
    .slice(0, 6);

  const todayLabel = formatDateFull(Date.now());
  const firstName = user.name.split(' ')[0];

  // Synthesize "next meeting" from the most recent session if data is sparse —
  // matches the Granola "Up next" CTA without requiring calendar integration.
  const nextSession = recentSessions[0];

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)] scrollbar-hide">

      {/* Top row: greeting on left, dark pill record button on right */}
      <div className="px-6 md:px-10 pt-10 pb-6 max-w-5xl mx-auto">
        <div className="flex items-end justify-between gap-6 flex-wrap mb-7">
          <div>
            <div className="text-[13px] text-[var(--text-tertiary)] mb-1.5">{todayLabel}</div>
            <h1 className="font-display-tight text-[34px] font-semibold leading-[1.05] mb-1 text-[var(--text-primary)]">
              {getGreeting()}, {firstName}.
            </h1>
            <p className="text-[15px] text-[var(--text-tertiary)]">
              {isLoading && recordings.length === 0
                ? 'Loading your sessions…'
                : pendingCount > 0
                  ? <>You have <b className="text-[var(--text-primary)] font-semibold">{pendingCount} pending action items</b>.</>
                  : 'All caught up. Ready for your next session.'}
            </p>
          </div>
          <button
            onClick={onStartNew}
            className="inline-flex items-center gap-2.5 px-5 py-3 rounded-full text-sm font-medium hover:opacity-90 active:scale-[0.98] transition"
            style={{ background: 'var(--cta-bg)', color: 'var(--cta-fg)' }}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent-2)' }} />
            Start recording
          </button>
        </div>

        {/* Loading skeleton */}
        {isLoading && recordings.length === 0 ? (
          <>
            <div className="grid grid-cols-3 gap-3 mb-6">
              {[0, 1, 2].map(i => (
                <div key={i} className="bg-[var(--bg-elevated)] rounded-2xl p-6 border border-[var(--border)] space-y-3">
                  <Skeleton className="h-9 w-16" />
                  <Skeleton className="h-3 w-28" />
                </div>
              ))}
            </div>
            <div className="bg-[var(--bg-elevated)] rounded-[18px] p-6 mb-8 space-y-3 border border-[var(--border)]">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-3 w-40" />
            </div>
            <div className="space-y-2">
              <SessionCardSkeleton />
              <SessionCardSkeleton />
            </div>
          </>
        ) : (
        <>

        {/* Stats grid — middle stat highlighted in olive-soft */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rounded-2xl px-6 py-5 bg-[var(--bg-sunken)]">
            <div className="font-display-tight text-[38px] font-semibold leading-none text-[var(--text-primary)] tabular-nums">
              {totalHours.toFixed(1)}<span className="text-[22px] text-[var(--text-tertiary)] ml-0.5">h</span>
            </div>
            <div className="mt-2.5 text-[13px] text-[var(--text-tertiary)]">Meetings logged</div>
          </div>
          <div
            className="rounded-2xl px-6 py-5"
            style={{ background: 'var(--accent-soft)' }}
          >
            <div
              className="font-display-tight text-[38px] font-semibold leading-none tabular-nums"
              style={{ color: 'var(--accent)' }}
            >
              {pendingCount}
            </div>
            <div className="mt-2.5 text-[13px] text-[var(--text-tertiary)]">Action items captured</div>
          </div>
          <div className="rounded-2xl px-6 py-5 bg-[var(--bg-sunken)]">
            <div className="font-display-tight text-[38px] font-semibold leading-none text-[var(--text-primary)] tabular-nums">
              {thisMonthSessions}
            </div>
            <div className="mt-2.5 text-[13px] text-[var(--text-tertiary)]">Sessions this month</div>
          </div>
        </div>

        {/* Up next CTA — high-contrast inverse card.
           In granola: dark ink card with cream text. In dark: amber card with black text. */}
        {nextSession && (
          <div
            className="flex items-center justify-between flex-wrap gap-4 rounded-[18px] px-6 py-5 mb-9 cursor-pointer"
            style={{ background: 'var(--cta-bg)', color: 'var(--cta-fg)' }}
            onClick={() => onSelectSession(nextSession.id)}
          >
            <div className="min-w-0">
              <div
                className="text-[12px] font-medium mb-1.5 tracking-[0.04em]"
                style={{ color: 'var(--accent-2)' }}
              >
                Continue where you left off
              </div>
              <div className="text-[18px] font-semibold tracking-tight truncate">
                {nextSession.title}
              </div>
              <div className="text-[13px] mt-1" style={{ color: 'var(--cta-fg-muted)' }}>
                {formatDateShort(nextSession.date)} · {formatDuration(nextSession.duration)}
              </div>
            </div>
            <button
              onClick={e => { e.stopPropagation(); onSelectSession(nextSession.id); }}
              className="px-5 py-2.5 rounded-full text-[13.5px] font-semibold hover:opacity-90 transition"
              style={{ background: 'var(--cta-fg)', color: 'var(--cta-bg)' }}
            >
              Open notes
            </button>
          </div>
        )}

        {/* Recent meetings list */}
        {recentSessions.length > 0 && (
          <>
            <div className="text-[13px] text-[var(--text-tertiary)] mb-2 tracking-[0.02em]">
              Recent meetings
            </div>
            <ul className="list-none p-0 m-0">
              {recentSessions.map(rec => {
                const openActions = (rec.analysis?.actionPoints ?? []).filter((_, i) =>
                  !doneIds.has(`${rec.id}-${i}`)
                ).length;
                const owner = user.name;
                return (
                  <li
                    key={rec.id}
                    onClick={() => onSelectSession(rec.id)}
                    className="grid items-center gap-4 px-4 py-3.5 -mx-4 rounded-xl cursor-pointer hover:bg-[var(--bg-sunken)] transition"
                    style={{ gridTemplateColumns: '80px 1fr auto' }}
                  >
                    <div className="text-[12.5px] text-[var(--text-tertiary)] font-medium">
                      {formatDateShort(rec.date)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[14.5px] font-medium text-[var(--text-primary)] truncate">
                        {rec.title}
                      </div>
                      <div className="text-[12.5px] text-[var(--text-tertiary)] mt-0.5">
                        {formatDuration(rec.duration)}
                        {openActions > 0 && ` · ${openActions} action${openActions > 1 ? 's' : ''}`}
                      </div>
                    </div>
                    <div className="flex items-center">
                      <span
                        className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-semibold text-white border-2"
                        style={{
                          background: colorFor(owner),
                          borderColor: 'var(--bg-elevated)',
                        }}
                      >
                        {initialsOf(owner)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {/* Empty state */}
        {completedRecordings.length === 0 && (
          <EmptyState
            compact
            tone="amber"
            title="No sessions yet"
            description="Start your first recording to see insights, action items, and strategic analysis here."
            icon={
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            }
            action={{ label: 'Start Recording', onClick: onStartNew }}
          />
        )}

        </>
        )}
      </div>
    </div>
  );
};

export default HomeView;
