
import React, { useMemo, useState } from 'react';
import { RecordingSession } from '../types';

interface DictationLogViewProps {
  sessions: RecordingSession[];
  onDelete: (id: string) => void;
}

const DictationLogView: React.FC<DictationLogViewProps> = ({ sessions, onDelete }) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToClipboard = async (text: string, sessionId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(sessionId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const groupedSessions = useMemo(() => {
    const dictations = sessions
      .filter(s => s.source === 'dictation') // Show all dictations regardless of status
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
                        {session.status === 'processing' ? (
                          <div className="flex items-center gap-3">
                            <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                            <div className="opacity-60 text-base font-medium text-[var(--text-primary)]">
                              Processing dictation...
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
                            <div className="opacity-80 text-base leading-relaxed font-medium text-[var(--text-primary)]">
                              {session.analysis?.transcript || "No transcript available"}
                            </div>
                            {session.analysis?.summary && session.analysis.summary !== session.analysis.transcript && (
                              <div className="mt-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-sm opacity-50 leading-relaxed italic text-[var(--text-primary)]">
                                {session.analysis.summary}
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      <div className="flex items-start gap-2 shrink-0">
                        {/* Copy button - only show for completed sessions with transcript */}
                        {session.status === 'completed' && session.analysis?.transcript && (
                          <button
                            onClick={() => copyToClipboard(session.analysis!.transcript, session.id)}
                            className="opacity-0 group-hover:opacity-100 p-2 opacity-20 hover:text-emerald-400 hover:bg-emerald-500/10 hover:opacity-100 rounded-lg transition-all"
                            title={copiedId === session.id ? "Copied!" : "Copy transcript"}
                          >
                            {copiedId === session.id ? (
                              <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            )}
                          </button>
                        )}

                        {/* Delete button */}
                        <button
                          onClick={() => onDelete(session.id)}
                          className="opacity-0 group-hover:opacity-100 p-2 opacity-20 hover:text-red-400 hover:bg-red-500/10 hover:opacity-100 rounded-lg transition-all"
                          title="Delete entry"
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

export default DictationLogView;
