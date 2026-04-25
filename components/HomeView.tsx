import React, { useMemo } from 'react';
import { RecordingSession, TrackedActionItem } from '../types';
import { Skeleton, SessionCardSkeleton } from './Skeleton';
import EmptyState from './EmptyState';
import { formatDateShort, formatDateFull, formatDuration } from '../utils/formatters';

interface HomeViewProps {
  user: { name: string; email: string };
  recordings: RecordingSession[];
  actionItems?: TrackedActionItem[];
  isLoading?: boolean;
  onSelectSession: (id: string) => void;
  onStartNew: () => void;
}

// Legacy localStorage fallback
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

const getSourceLabel = (source: string) => {
  if (source === 'virtual-meeting') return 'Virtual';
  if (source === 'phone-call') return 'Call';
  if (source === 'dictation') return 'Dictation';
  return 'In-person';
};

const getSourceColor = (source: string) => {
  if (source === 'virtual-meeting') return 'bg-purple-500/15 text-purple-300';
  if (source === 'phone-call') return 'bg-teal-500/15 text-teal-300';
  if (source === 'dictation') return 'bg-amber-500/15 text-amber-300';
  return 'bg-white/5 text-[var(--text-muted)]';
};

const HomeView: React.FC<HomeViewProps> = ({
  user, recordings, actionItems, isLoading, onSelectSession, onStartNew
}) => {
  const doneIds = useMemo(() => loadDoneIds(), []);

  // Derive stats
  const completedRecordings = useMemo(() =>
    recordings.filter(r => r.status === 'completed'),
    [recordings]
  );

  // Use tracked action items if available, else fall back to localStorage
  const pendingCount = useMemo(() => {
    if (actionItems) return actionItems.filter(i => i.status !== 'completed').length;
    const items: unknown[] = [];
    completedRecordings.sort((a, b) => b.date - a.date).forEach(rec => {
      (rec.analysis?.actionPoints ?? []).forEach((_, i) => {
        if (!doneIds.has(`${rec.id}-${i}`)) items.push(null);
      });
    });
    return items.length;
  }, [actionItems, completedRecordings, doneIds]);

  const top3Actions = useMemo(() => {
    if (actionItems) {
      return actionItems
        .filter(i => i.status !== 'completed')
        .slice(0, 3)
        .map(i => ({ id: i.id, text: i.text, sessionId: i.recordingId ?? '', sessionTitle: i.sessionTitle ?? '', sessionDate: i.sessionDate ?? i.createdAt }));
    }
    const items: { id: string; text: string; sessionId: string; sessionTitle: string; sessionDate: number }[] = [];
    completedRecordings.sort((a, b) => b.date - a.date).forEach(rec => {
      (rec.analysis?.actionPoints ?? []).forEach((text, i) => {
        const id = `${rec.id}-${i}`;
        if (!doneIds.has(id)) items.push({ id, text, sessionId: rec.id, sessionTitle: rec.title, sessionDate: rec.date });
      });
    });
    return items.slice(0, 3);
  }, [actionItems, completedRecordings, doneIds]);

  const thisMonthSessions = useMemo(() => {
    const now = new Date();
    return recordings.filter(r => {
      const d = new Date(r.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
  }, [recordings]);

  const totalMinutes = useMemo(() =>
    Math.round(completedRecordings.reduce((acc, r) => acc + r.duration, 0) / 60),
    [completedRecordings]
  );

  const lastSession = completedRecordings[0];
  const recentSessions = completedRecordings.slice(1, 5);

  const today = formatDateFull(Date.now());

  return (
    <div className="h-full overflow-y-auto bg-[var(--surface-950)] scrollbar-hide">

      {/* Top bar */}
      <div className="sticky top-0 z-40 bg-[var(--surface-900)]/80 backdrop-blur-xl border-b border-white/[0.06] px-6 md:px-10 h-14 md:h-16 flex items-center justify-between shrink-0">
        <div className="text-sm text-[var(--text-muted)]">
          {today}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-[var(--text-muted)] hidden sm:inline">
            {getGreeting()}, <span className="text-[var(--text-primary)]">{user.name.split(' ')[0]}</span>
          </span>
        </div>
      </div>

      <div className="px-6 md:px-10 pt-8 pb-24 md:pb-10 max-w-4xl mx-auto">

        {/* Hero */}
        <div className="mb-8">
          <h1 className="font-display-tight text-3xl md:text-4xl font-medium leading-[1.05] mb-1.5">
            {getGreeting()}, <span className="text-amber-400 italic">{user.name.split(' ')[0]}.</span>
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            {isLoading && recordings.length === 0
              ? 'Loading your sessions...'
              : pendingCount > 0
                ? `You have ${pendingCount} pending action item${pendingCount > 1 ? 's' : ''} from your meetings.`
                : 'All caught up. Ready for your next session.'}
          </p>
        </div>

        {/* Loading skeleton — shown when fetching initial session data */}
        {isLoading && recordings.length === 0 ? (
          <>
            <div className="grid grid-cols-3 gap-3 mb-8">
              {[0, 1, 2].map(i => (
                <div key={i} className="bg-[var(--surface-800)] border border-white/[0.06] rounded-2xl p-4 md:p-5 space-y-2">
                  <Skeleton className="h-8 w-12" />
                  <Skeleton className="h-2.5 w-24" />
                </div>
              ))}
            </div>
            <div className="bg-[var(--surface-800)] border border-white/[0.06] rounded-2xl p-5 mb-8 space-y-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-2.5 w-56" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              <SessionCardSkeleton />
              <SessionCardSkeleton />
            </div>
          </>
        ) : (
        <>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="bg-[var(--surface-800)] border border-white/[0.06] rounded-2xl p-4 md:p-5">
            <div className="font-display-tight text-3xl md:text-4xl font-semibold text-amber-400 mb-1 tabular-nums">{pendingCount}</div>
            <div className="text-xs text-[var(--text-muted)] font-medium">Pending Actions</div>
          </div>
          <div className="bg-[var(--surface-800)] border border-white/[0.06] rounded-2xl p-4 md:p-5">
            <div className="font-display-tight text-3xl md:text-4xl font-semibold text-teal-400 mb-1 tabular-nums">{thisMonthSessions}</div>
            <div className="text-xs text-[var(--text-muted)] font-medium">Sessions This Month</div>
          </div>
          <div className="bg-[var(--surface-800)] border border-white/[0.06] rounded-2xl p-4 md:p-5">
            <div className="font-display-tight text-3xl md:text-4xl font-semibold text-purple-400 mb-1 tabular-nums">
              {totalMinutes >= 60 ? `${Math.floor(totalMinutes / 60)}h` : `${totalMinutes}m`}
            </div>
            <div className="text-xs text-[var(--text-muted)] font-medium">Meeting Time Logged</div>
          </div>
        </div>

        {/* Record CTA */}
        <div className="relative overflow-hidden bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5 md:p-6 mb-8 group hover:border-amber-500/35 hover:bg-amber-500/14 transition-all duration-300">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative">
            <div>
              <div className="text-[10px] font-bold tracking-[.14em] uppercase text-amber-400 mb-1">Start capturing</div>
              <div className="font-display-tight text-xl font-semibold mb-1">New Session</div>
              <div className="text-xs text-[var(--text-muted)]">Choose how you want to capture this session</div>
            </div>
            <div className="flex flex-col sm:items-end gap-2.5">
              <button
                onClick={onStartNew}
                className="px-5 py-2.5 rounded-xl text-sm font-bold bg-amber-500 text-black hover:bg-amber-400 transition-all active:scale-95"
              >
                Start Recording
              </button>
              <div className="flex items-center gap-4 text-xs font-medium">
                <button
                  onClick={() => onSelectSession('manual-entry')}
                  className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Paste transcript
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Two-col grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">

          {/* Action Items card */}
          <div className="bg-[var(--surface-800)] border border-white/[0.06] rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-5 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/12 flex items-center justify-center">
                  <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-sm font-bold">Action Items</span>
                {pendingCount > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
                    {pendingCount} pending
                  </span>
                )}
              </div>
              <button
                onClick={() => onSelectSession('actions')}
                className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                See all →
              </button>
            </div>

            {top3Actions.length === 0 ? (
              <div className="px-5 pb-5 text-center py-8">
                <div className="text-2xl mb-2">🎉</div>
                <div className="text-xs text-[var(--text-muted)]">All action items complete!</div>
              </div>
            ) : (
              <div className="px-5 pb-4">
                {top3Actions.map(item => (
                  <div
                    key={item.id}
                    onClick={() => onSelectSession(item.sessionId)}
                    className="flex items-start gap-3 py-3 border-t border-white/[0.05] cursor-pointer group/ai"
                  >
                    <div className="w-[18px] h-[18px] border-[1.5px] border-white/15 rounded-[5px] flex-shrink-0 mt-0.5 group-hover/ai:border-amber-500/60 transition-colors" />
                    <div className="flex-1 text-xs leading-relaxed text-[var(--text-secondary)]">{item.text}</div>
                    <div className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">
                      {formatDateShort(item.sessionDate)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Intelligence nudge card */}
          <div className="bg-[var(--surface-800)] border border-white/[0.06] rounded-2xl overflow-hidden flex flex-col">
            <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
              <div className="w-8 h-8 rounded-xl bg-purple-500/12 flex items-center justify-center">
                <svg className="w-4 h-4 text-purple-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12c1 1 2 2 2 4h4c0-2 1-3 2-4a7 7 0 00-4-12z" />
                </svg>
              </div>
              <span className="text-sm font-bold">Intelligence</span>
            </div>

            <div className="px-5 pb-5 flex flex-col gap-3 flex-1">
              {completedRecordings.length >= 3 ? (
                <button
                  onClick={() => onSelectSession('intelligence')}
                  className="text-left p-4 rounded-xl bg-purple-500/[0.06] border border-purple-500/12 hover:bg-purple-500/10 hover:border-purple-500/20 transition-all group/intel"
                >
                  <div className="text-[10px] font-bold tracking-[.1em] uppercase text-purple-400 mb-2">Pattern detected</div>
                  <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    You've recorded {completedRecordings.length} sessions. Open Intelligence to surface recurring themes and strategic gaps across your meetings.
                  </div>
                </button>
              ) : (
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] text-xs text-[var(--text-muted)] leading-relaxed">
                  Record a few more sessions and Intelligence will start surfacing patterns and strategic insights across all your meetings.
                </div>
              )}

              <button
                onClick={() => onSelectSession('intelligence')}
                className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] transition-all text-left group/ask"
              >
                <div className="text-xs text-[var(--text-muted)] italic">Ask anything across your meetings...</div>
              </button>
            </div>
          </div>
        </div>

        {/* Last session resume */}
        {lastSession && (
          <div
            onClick={() => onSelectSession(lastSession.id)}
            className="bg-[var(--surface-800)] border border-white/[0.06] rounded-2xl overflow-hidden mb-8 cursor-pointer hover:border-purple-500/25 transition-all group/last"
          >
            <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold tracking-[.12em] uppercase text-[var(--text-muted)]">
                    Continue where you left off
                  </span>
                </div>
                <div className="text-base font-bold tracking-tight mb-2">{lastSession.title}</div>
                <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                  <span>{formatDuration(lastSession.duration)}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${getSourceColor(lastSession.source)}`}>
                    {getSourceLabel(lastSession.source)}
                  </span>
                  <span>{formatDateShort(lastSession.date)}</span>
                </div>
              </div>
              <div className="w-9 h-9 border border-white/[0.08] rounded-xl flex items-center justify-center text-[var(--text-muted)] flex-shrink-0 group-hover/last:border-purple-500/30 transition-colors">
                →
              </div>
            </div>

            {lastSession.analysis?.summary && (
              <div className="px-6 py-3 border-t border-white/[0.05] bg-white/[0.01] text-xs text-[var(--text-muted)] leading-relaxed italic line-clamp-2">
                {lastSession.analysis.summary.slice(0, 200)}...
              </div>
            )}

            <div className="px-6 py-3 border-t border-white/[0.05] flex items-center gap-2">
              <button
                onClick={e => { e.stopPropagation(); onSelectSession(lastSession.id); }}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07] text-[var(--text-secondary)] hover:bg-white/[0.07] transition-all inline-flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h11M8 12h11M8 17h7M4 7h.01M4 12h.01M4 17h.01" />
                </svg>
                Notes
              </button>
              <button
                onClick={e => { e.stopPropagation(); onSelectSession(lastSession.id); }}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07] text-[var(--text-secondary)] hover:bg-white/[0.07] transition-all inline-flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
                Transcript
              </button>
              <button
                onClick={e => { e.stopPropagation(); onSelectSession('intelligence'); }}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-300 hover:bg-purple-500/[0.16] transition-all inline-flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12c1 1 2 2 2 4h4c0-2 1-3 2-4a7 7 0 00-4-12z" />
                </svg>
                Ask AI
              </button>
              {(() => {
                const openActions = (lastSession.analysis?.actionPoints ?? []).filter((_, i) =>
                  !doneIds.has(`${lastSession.id}-${i}`)
                ).length;
                return openActions > 0 ? (
                  <div className="ml-auto text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400">
                    {openActions} action{openActions > 1 ? 's' : ''} open
                  </div>
                ) : null;
              })()}
            </div>
          </div>
        )}

        {/* Recent sessions */}
        {recentSessions.length > 0 && (
          <>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-[10px] font-bold tracking-[.15em] uppercase text-[var(--text-muted)]">Recent Sessions</span>
              <div className="flex-1 h-px bg-white/[0.05]" />
              <button
                onClick={() => onSelectSession('sessions')}
                className="text-[10px] font-bold tracking-[.1em] uppercase text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                View all →
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {recentSessions.map(rec => {
                const openActions = (rec.analysis?.actionPoints ?? []).filter((_, i) =>
                  !doneIds.has(`${rec.id}-${i}`)
                ).length;

                return (
                  <div
                    key={rec.id}
                    onClick={() => onSelectSession(rec.id)}
                    className="flex items-center gap-4 px-4 py-3.5 bg-[var(--surface-800)] border border-white/[0.06] rounded-xl cursor-pointer hover:border-white/[0.10] hover:bg-white/[0.025] transition-all"
                  >
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      rec.source === 'virtual-meeting' ? 'bg-purple-400' :
                      rec.source === 'phone-call' ? 'bg-teal-400' : 'bg-amber-400'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate mb-0.5">{rec.title}</div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {formatDateShort(rec.date)} · {formatDuration(rec.duration)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${getSourceColor(rec.source)}`}>
                        {getSourceLabel(rec.source)}
                      </span>
                      {openActions > 0 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
                          {openActions}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
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
