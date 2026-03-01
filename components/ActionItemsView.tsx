import React, { useState, useMemo, useEffect } from 'react';
import { RecordingSession } from '../types';

interface ActionItemsViewProps {
  recordings: RecordingSession[];
  onSelectSession: (id: string) => void;
}

type FilterState = 'all' | 'pending' | 'done';

interface ActionItem {
  id: string;           // unique: `${sessionId}-${index}`
  text: string;
  sessionId: string;
  sessionTitle: string;
  sessionDate: number;
  done: boolean;
}

const STORAGE_KEY = 'aligned-action-items-done';

const loadDoneIds = (): Set<string> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
};

const saveDoneIds = (ids: Set<string>) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
};

const ActionItemsView: React.FC<ActionItemsViewProps> = ({ recordings, onSelectSession }) => {
  const [filter, setFilter] = useState<FilterState>('pending');
  const [doneIds, setDoneIds] = useState<Set<string>>(loadDoneIds);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Persist done state whenever it changes
  useEffect(() => {
    saveDoneIds(doneIds);
  }, [doneIds]);

  // Aggregate all action items across all completed sessions
  const allItems: ActionItem[] = useMemo(() => {
    const items: ActionItem[] = [];
    recordings
      .filter(r => r.status === 'completed' && r.analysis?.actionPoints?.length)
      .sort((a, b) => b.date - a.date)
      .forEach(rec => {
        rec.analysis!.actionPoints.forEach((text, i) => {
          const id = `${rec.id}-${i}`;
          items.push({
            id,
            text,
            sessionId: rec.id,
            sessionTitle: rec.title,
            sessionDate: rec.date,
            done: doneIds.has(id),
          });
        });
      });
    return items;
  }, [recordings, doneIds]);

  const filteredItems = useMemo(() => {
    let items = allItems;

    if (filter === 'pending') items = items.filter(i => !i.done);
    else if (filter === 'done') items = items.filter(i => i.done);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        i =>
          i.text.toLowerCase().includes(q) ||
          i.sessionTitle.toLowerCase().includes(q)
      );
    }

    return items;
  }, [allItems, filter, searchQuery]);

  const pendingCount = allItems.filter(i => !i.done).length;
  const doneCount = allItems.filter(i => i.done).length;

  const toggleDone = (id: string) => {
    setDoneIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopy = async (item: ActionItem) => {
    await navigator.clipboard.writeText(item.text);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const clearAllDone = () => {
    setDoneIds(prev => {
      const next = new Set(prev);
      allItems.filter(i => i.done).forEach(i => next.delete(i.id));
      return next;
    });
  };

  // Group filtered items by session
  const groupedBySession = useMemo(() => {
    const map = new Map<string, { title: string; date: number; id: string; items: ActionItem[] }>();
    filteredItems.forEach(item => {
      if (!map.has(item.sessionId)) {
        map.set(item.sessionId, {
          id: item.sessionId,
          title: item.sessionTitle,
          date: item.sessionDate,
          items: [],
        });
      }
      map.get(item.sessionId)!.items.push(item);
    });
    return [...map.values()].sort((a, b) => b.date - a.date);
  }, [filteredItems]);

  return (
    <div className="flex flex-col h-full bg-[var(--surface-950)] overflow-hidden text-[var(--text-primary)]">

      {/* Header */}
      <header className="shrink-0 bg-[var(--surface-900)]/80 backdrop-blur-xl border-b border-white/[0.06] sticky top-0 z-40">
        <div className="h-16 flex items-center px-4 md:px-8 gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </div>
            <h1 className="text-xl font-bold tracking-tight">Action Items</h1>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-3 text-xs font-semibold">
            <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/20">
              {pendingCount} pending
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-white/5 text-[var(--text-muted)] border border-white/10">
              {doneCount} done
            </span>
          </div>
        </div>

        {/* Filter + Search row */}
        <div className="px-4 md:px-8 pb-4 flex flex-col sm:flex-row gap-3">
          {/* Filter tabs */}
          <div className="flex gap-1 p-1 bg-white/[0.04] rounded-xl shrink-0">
            {(['pending', 'all', 'done'] as FilterState[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                  filter === f
                    ? 'bg-amber-500 text-white shadow-md shadow-amber-500/25'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search action items..."
              className="w-full glass-input rounded-xl pl-10 pr-10 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pt-6 pb-32 px-4 md:px-8 scrollbar-hide">
        <div className="max-w-3xl mx-auto space-y-8">

          {/* Empty state */}
          {allItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <h3 className="opacity-60 font-semibold">No action items yet</h3>
              <p className="opacity-30 text-sm mt-1">Action items from your recorded sessions will appear here.</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="opacity-60 font-semibold">
                {filter === 'done' ? 'Nothing marked done yet' : 'All caught up!'}
              </h3>
              <p className="opacity-30 text-sm mt-1">
                {filter === 'pending' ? 'All action items have been completed.' : searchQuery ? `No results for "${searchQuery}"` : ''}
              </p>
              {filter === 'pending' && doneCount > 0 && (
                <button
                  onClick={() => setFilter('done')}
                  className="mt-4 px-4 py-2 text-sm font-semibold text-amber-300 bg-amber-500/10 rounded-xl border border-amber-500/20 hover:bg-amber-500/20 transition-all"
                >
                  View {doneCount} completed items
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Clear done button */}
              {filter === 'done' && doneCount > 0 && (
                <div className="flex justify-end">
                  <button
                    onClick={clearAllDone}
                    className="text-xs text-[var(--text-muted)] hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-500/10"
                  >
                    Clear all completed
                  </button>
                </div>
              )}

              {/* Grouped by session */}
              {groupedBySession.map(group => (
                <div key={group.id} className="space-y-2">
                  {/* Session header */}
                  <button
                    onClick={() => onSelectSession(group.id)}
                    className="flex items-center gap-2 group/session w-full text-left mb-3"
                  >
                    <span className="text-[11px] font-bold opacity-30 uppercase tracking-[0.2em] text-[var(--text-primary)]">
                      {group.title}
                    </span>
                    <span className="text-[10px] opacity-20 text-[var(--text-primary)]">
                      · {new Date(group.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                    <svg className="w-3 h-3 opacity-0 group-hover/session:opacity-40 transition-opacity ml-1 text-[var(--text-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </button>

                  {/* Items */}
                  <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden divide-y divide-white/[0.04]">
                    {group.items.map(item => (
                      <div
                        key={item.id}
                        className={`group/item flex items-start gap-4 px-5 py-4 transition-colors ${
                          item.done ? 'opacity-50' : 'hover:bg-white/[0.02]'
                        }`}
                      >
                        {/* Checkbox */}
                        <button
                          onClick={() => toggleDone(item.id)}
                          className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
                            item.done
                              ? 'bg-amber-500 border-amber-500 text-white'
                              : 'border-white/20 hover:border-amber-500/60'
                          }`}
                          title={item.done ? 'Mark as pending' : 'Mark as done'}
                        >
                          {item.done && (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>

                        {/* Text */}
                        <span className={`flex-1 text-sm leading-relaxed pt-0.5 ${
                          item.done ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'
                        }`}>
                          {item.text}
                        </span>

                        {/* Copy button */}
                        <button
                          onClick={() => handleCopy(item)}
                          className="opacity-0 group-hover/item:opacity-100 p-1.5 rounded-lg hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all shrink-0"
                          title="Copy"
                        >
                          {copiedId === item.id ? (
                            <svg className="w-4 h-4 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ActionItemsView;
