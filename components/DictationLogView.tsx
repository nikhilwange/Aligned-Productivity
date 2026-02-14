
import React, { useMemo } from 'react';
import { RecordingSession } from '../types';

interface DictationLogViewProps {
  sessions: RecordingSession[];
  onDelete: (id: string) => void;
}

const DictationLogView: React.FC<DictationLogViewProps> = ({ sessions, onDelete }) => {
  const groupedSessions = useMemo(() => {
    const dictations = sessions
      .filter(s => s.source === 'dictation' && s.status === 'completed')
      .sort((a, b) => b.date - a.date);

    const groups: { [key: string]: RecordingSession[] } = {};
    
    dictations.forEach(session => {
      const date = new Date(session.date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }).toUpperCase();
      
      if (!groups[date]) groups[date] = [];
      groups[date].push(session);
    });

    return Object.entries(groups);
  }, [sessions]);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  return (
    <div className="flex flex-col h-full bg-[var(--surface-950)] overflow-hidden text-[var(--text-primary)]">
      {/* Header */}
      <header className="shrink-0 bg-[var(--surface-900)]/80 backdrop-blur-xl border-b border-white/[0.06] sticky top-0 z-40">
        <div className="h-16 flex items-center px-4 md:px-8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">My Dictations</h1>
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
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <h3 className="opacity-60 font-semibold text-[var(--text-primary)]">No dictations yet</h3>
              <p className="opacity-30 text-sm mt-1 text-[var(--text-primary)]">Sessions recorded via Dictation Flow will appear here.</p>
            </div>
          ) : (
            groupedSessions.map(([date, daySessions]) => (
              <div key={date} className="space-y-4">
                <h3 className="text-[11px] font-bold opacity-30 uppercase tracking-[0.2em] pl-1 text-[var(--text-primary)]">{date}</h3>
                
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden divide-y divide-white/[0.04]">
                  {daySessions.map((session) => (
                    <div key={session.id} className="group relative flex items-start gap-6 p-6 hover:bg-white/[0.02] transition-colors">
                      <div className="w-20 shrink-0 text-xs font-bold opacity-40 pt-1 text-[var(--text-primary)]">
                        {formatTime(session.date)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="opacity-80 text-base leading-relaxed font-medium text-[var(--text-primary)]">
                          {session.analysis?.transcript || "No transcript available"}
                        </div>
                        {session.analysis?.summary && session.analysis.summary !== session.analysis.transcript && (
                          <div className="mt-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-sm opacity-50 leading-relaxed italic text-[var(--text-primary)]">
                            {session.analysis.summary}
                          </div>
                        )}
                      </div>
                      
                      {/* Delete button */}
                      <button
                        onClick={() => onDelete(session.id)}
                        className="opacity-0 group-hover:opacity-100 p-2 opacity-20 hover:text-red-400 hover:bg-red-500/10 hover:opacity-100 rounded-lg transition-all shrink-0"
                        title="Delete entry"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
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

export default DictationLogView;
