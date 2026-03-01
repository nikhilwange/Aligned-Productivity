import React, { useMemo } from 'react';
import { RecordingSession } from '../types';

interface HomeViewProps {
  user: { name: string; email: string };
  recordings: RecordingSession[];
  onSelectSession: (id: string) => void;
  onStartNew: () => void;
  onStartLive: () => void;
}

// Reuse the done-ids logic from ActionItemsView
const STORAGE_KEY = 'aligned-action-items-done';
const loadDoneIds = (): Set<string> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
};

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
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
  user, recordings, onSelectSession, onStartNew, onStartLive
}) => {
  const doneIds = useMemo(() => loadDoneIds(), []);

  // Derive stats
  const completedRecordings = useMemo(() =>
    recordings.filter(r => r.status === 'completed'),
    [recordings]
  );

  const allActionItems = useMemo(() => {
    const items: { id: string; text: string; sessionId: string; sessionTitle: string; sessionDate: number }[] = [];
    completedRecordings
      .sort((a, b) => b.date - a.date)
      .forEach(rec => {
        (rec.analysis?.actionPoints ?? []).forEach((text, i) => {
          const id = `${rec.id}-${i}`;
          if (!doneIds.has(id)) {
            items.push({ id, text, sessionId: rec.id, sessionTitle: rec.title, sessionDate: rec.date });
          }
        });
      });
    return items;
  }, [completedRecordings, doneIds]);

  const pendingCount = allActionItems.length;
  const top3Actions = allActionItems.slice(0, 3);

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

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });

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
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight leading-tight mb-1">
            {getGreeting()}, <span className="text-amber-400">{user.name.split(' ')[0]}.</span>
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            {pendingCount > 0
              ? `You have ${pendingCount} pending action item${pendingCount > 1 ? 's' : ''} from your meetings.`
              : 'All caught up. Ready for your next session.'}
          </p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="bg-[var(--surface-800)] border border-white/[0.06] rounded-2xl p-4 md:p-5">
            <div className="text-2xl md:text-3xl font-bold tracking-tight text-amber-400 mb-1">{pendingCount}</div>
            <div className="text-xs text-[var(--text-muted)] font-medium">Pending Actions</div>
          </div>
          <div className="bg-[var(--surface-800)] border border-white/[0.06] rounded-2xl p-4 md:p-5">
            <div className="text-2xl md:text-3xl font-bold tracking-tight text-teal-400 mb-1">{thisMonthSessions}</div>
            <div className="text-xs text-[var(--text-muted)] font-medium">Sessions This Month</div>
          </div>
          <div className="bg-[var(--surface-800)] border border-white/[0.06] rounded-2xl p-4 md:p-5">
            <div className="text-2xl md:text-3xl font-bold tracking-tight text-purple-400 mb-1">
              {totalMinutes >= 60 ? `${Math.floor(totalMinutes / 60)}h` : `${totalMinutes}m`}
            </div>
            <div className="text-xs text-[var(--text-muted)] font-medium">Meeting Time Logged</div>
          </div>
        </div>

        {/* Record CTA */}
        <div className="relative overflow-hidden bg-gradient-to-r from-amber-500/10 to-orange-600/5 border border-amber-500/20 rounded-2xl p-5 md:p-6 mb-8 group hover:border-amber-500/35 hover:from-amber-500/14 transition-all duration-300">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative">
            <div>
              <div className="text-[10px] font-bold tracking-[.14em] uppercase text-amber-400 mb-1">Start capturing</div>
              <div className="text-xl font-bold tracking-tight mb-1">New Session</div>
              <div className="text-xs text-[var(--text-muted)]">Choose how you want to capture this session</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={onStartNew}
                className="px-4 py-2.5 rounded-xl text-xs font-bold bg-amber-500 text-black shadow-lg shadow-amber-500/30 hover:bg-amber-400 transition-all active:scale-95"
              >
                🎙 In-Person
              </button>
              <button
                onClick={onStartNew}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-[var(--text-secondary)] hover:bg-white/[0.08] hover:border-white/15 transition-all active:scale-95"
              >
                💻 Virtual
              </button>
              <button
                onClick={onStartNew}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-[var(--text-secondary)] hover:bg-white/[0.08] hover:border-white/15 transition-all active:scale-95"
              >
                📱 Phone
              </button>
              <button
                onClick={onStartLive}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-[var(--text-secondary)] hover:bg-white/[0.08] hover:border-white/15 transition-all active:scale-95"
              >
                🎤 Dictate
              </button>
              <button
                onClick={() => onSelectSession('manual-entry')}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-[var(--text-secondary)] hover:bg-white/[0.08] hover:border-white/15 transition-all active:scale-95"
              >
                ✏️ Paste Transcript
              </button>
            </div>
          </div>
        </div>

        {/* Two-col grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">

          {/* Action Items card */}
          <div className="bg-[var(--surface-800)] border border-white/[0.06] rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-5 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/12 flex items-center justify-center text-sm">✅</div>
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
                      {new Date(item.sessionDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Intelligence nudge card */}
          <div className="bg-[var(--surface-800)] border border-white/[0.06] rounded-2xl overflow-hidden flex flex-col">
            <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
              <div className="w-8 h-8 rounded-xl bg-purple-500/12 flex items-center justify-center text-sm">💡</div>
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
                  <span>{new Date(lastSession.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
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
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07] text-[var(--text-secondary)] hover:bg-white/[0.07] transition-all"
              >
                📝 Notes
              </button>
              <button
                onClick={e => { e.stopPropagation(); onSelectSession(lastSession.id); }}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07] text-[var(--text-secondary)] hover:bg-white/[0.07] transition-all"
              >
                💬 Transcript
              </button>
              <button
                onClick={e => { e.stopPropagation(); onSelectSession('intelligence'); }}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-300 hover:bg-purple-500/[0.16] transition-all"
              >
                💡 Ask AI
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
                        {new Date(rec.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {formatDuration(rec.duration)}
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
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-4 text-2xl">🎉</div>
            <div className="text-sm font-semibold text-[var(--text-secondary)] mb-1">No sessions yet</div>
            <div className="text-xs text-[var(--text-muted)]">Start your first recording to see insights here.</div>
          </div>
        )}

      </div>
    </div>
  );
};

export default HomeView;
