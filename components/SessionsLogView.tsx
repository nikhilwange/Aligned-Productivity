import React, { useMemo, useState } from 'react';
import { RecordingSession } from '../types';

interface SessionsLogViewProps {
  sessions: RecordingSession[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const SessionsLogView: React.FC<SessionsLogViewProps> = ({ sessions, onSelect, onDelete }) => {
  const [searchQuery, setSearchQuery] = useState('');

  const groupedSessions = useMemo(() => {
    let filtered = sessions
      .filter(s => s.source !== 'dictation')
      .sort((a, b) => b.date - a.date);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(s =>
        s.title?.toLowerCase().includes(q) ||
        s.analysis?.summary?.toLowerCase().includes(q) ||
        s.analysis?.transcript?.toLowerCase().includes(q)
      );
    }

    const groups: { [key: string]: RecordingSession[] } = {};

    filtered.forEach(session => {
      const date = new Date(session.date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }).toUpperCase();

      if (!groups[date]) groups[date] = [];
      groups[date].push(session);
    });

    return Object.entries(groups);
  }, [sessions, searchQuery]);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const getSnippet = (text: string, max = 200) => {
    if (!text) return '';
    if (text.length <= max) return text;
    return text.slice(0, max).trim() + '...';
  };

  return (
    <div className="flex flex-col h-full bg-[var(--surface-950)] overflow-hidden text-[var(--text-primary)]">
      {/* Header */}
      <header className="shrink-0 bg-[var(--surface-900)]/80 backdrop-blur-xl border-b border-white/[0.06] sticky top-0 z-40">
        <div className="h-16 flex items-center px-4 md:px-8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center text-white">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">My Sessions</h1>
          </div>
        </div>

        {/* Search bar */}
        <div className="px-4 md:px-8 pb-4">
          <div className="relative max-w-3xl mx-auto">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sessions..."
              className="w-full glass-input rounded-xl pl-10 pr-10 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
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
      <div className="flex-1 overflow-y-auto pt-8 pb-32 px-4 md:px-8 scrollbar-hide">
        <div className="max-w-3xl mx-auto space-y-12">
          {groupedSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 opacity-20 text-[var(--text-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <h3 className="opacity-60 font-semibold text-[var(--text-primary)]">
                {searchQuery ? `No results for "${searchQuery}"` : 'No sessions yet'}
              </h3>
              <p className="opacity-30 text-sm mt-1 text-[var(--text-primary)]">
                {searchQuery ? 'Try a different search term.' : 'Your recorded sessions will appear here.'}
              </p>
            </div>
          ) : (
            groupedSessions.map(([date, daySessions]) => (
              <div key={date} className="space-y-4">
                <h3 className="text-[11px] font-bold opacity-30 uppercase tracking-[0.2em] pl-1 text-[var(--text-primary)]">{date}</h3>

                <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden divide-y divide-white/[0.04]">
                  {daySessions.map((session) => (
                    <div
                      key={session.id}
                      className="group relative flex items-start gap-6 p-6 hover:bg-white/[0.02] transition-colors cursor-pointer"
                      onClick={() => onSelect(session.id)}
                    >
                      {/* Time column */}
                      <div className="w-20 shrink-0 text-xs font-bold opacity-40 pt-1 text-[var(--text-primary)]">
                        {formatTime(session.date)}
                      </div>

                      {/* Content column - matching DictationLogView style */}
                      <div className="flex-1 min-w-0">
                        {session.status === 'processing' ? (
                          <div className="flex items-center gap-3">
                            <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                            <div className="opacity-60 text-base font-medium text-[var(--text-primary)]">
                              Processing session...
                            </div>
                          </div>
                        ) : session.status === 'error' ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-red-400">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span className="font-medium">Processing failed</span>
                            </div>
                            {session.errorMessage && (
                              <div className="text-sm opacity-50 text-[var(--text-primary)]">
                                {session.errorMessage}
                              </div>
                            )}
                          </div>
                        ) : (
                          <>
                            {/* Title as main text - like transcript in dictation view */}
                            <div className="opacity-80 text-base leading-relaxed font-medium text-[var(--text-primary)]">
                              {session.title || "Untitled session"}
                            </div>
                            {/* Summary in subtle box - like dictation summary */}
                            {session.analysis?.summary && (
                              <div className="mt-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-sm opacity-50 leading-relaxed italic text-[var(--text-primary)]">
                                {getSnippet(session.analysis.summary)}
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      {/* Delete button */}
                      <div className="flex items-start shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
                          className="opacity-0 group-hover:opacity-100 p-2 opacity-20 hover:text-red-400 hover:bg-red-500/10 hover:opacity-100 rounded-lg transition-all"
                          title="Delete session"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default SessionsLogView;
