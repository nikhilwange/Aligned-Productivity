import React, { useState, useMemo } from 'react';
import { RecordingSession, StrategicAnalysis } from '../types';
import { generateStrategicAnalysis } from '../services/strategyService';

interface StrategistViewProps {
  recordings: RecordingSession[];
  userId: string;
}

const StrategistView: React.FC<StrategistViewProps> = ({ recordings, userId }) => {
  const [analysis, setAnalysis] = useState<StrategicAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'gaps' | 'actions' | 'issues'>('actions');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [sharedSection, setSharedSection] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  const filteredRecordings = useMemo(() => {
    let filtered = recordings.filter(
      r => r.status === 'completed' && r.analysis && r.source !== 'dictation'
    );
    if (dateFrom) {
      filtered = filtered.filter(r => r.date >= new Date(dateFrom).getTime());
    }
    if (dateTo) {
      filtered = filtered.filter(r => r.date <= new Date(dateTo + 'T23:59:59').getTime());
    }
    return filtered;
  }, [recordings, dateFrom, dateTo]);

  const completedMeetingsCount = filteredRecordings.length;

  const handleGenerateAnalysis = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await generateStrategicAnalysis(filteredRecordings);
      setAnalysis(result);
    } catch (err: any) {
      setError(err.message || 'Failed to generate strategic analysis');
      console.error('Strategic analysis error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSection(label);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const shareContent = async (title: string, text: string) => {
    try {
      if (navigator.share) {
        await navigator.share({ title, text });
      } else {
        throw new Error('Web Share API not supported');
      }
    } catch (err) {
      await navigator.clipboard.writeText(text);
      setSharedSection(title);
      setTimeout(() => setSharedSection(null), 2000);
    }
  };

  const CopyShareButtons: React.FC<{ label: string; text: string; shareTitle: string }> = ({ label, text, shareTitle }) => (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
      <button
        onClick={(e) => { e.stopPropagation(); copyToClipboard(label, text); }}
        className={`p-1.5 rounded-lg transition-all ${
          copiedSection === label
            ? 'bg-teal-500/20 text-teal-300'
            : 'glass text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        }`}
        title={copiedSection === label ? 'Copied!' : 'Copy'}
      >
        {copiedSection === label ? (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); shareContent(shareTitle, text); }}
        className={`p-1.5 rounded-lg transition-all ${
          sharedSection === shareTitle
            ? 'bg-teal-500/20 text-teal-300'
            : 'glass text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        }`}
        title={sharedSection === shareTitle ? 'Shared!' : 'Share'}
      >
        {sharedSection === shareTitle ? (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
        )}
      </button>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-[var(--surface-950)] overflow-hidden text-[var(--text-primary)]">
      {/* Header */}
      <header className="shrink-0 bg-[var(--surface-900)]/80 backdrop-blur-xl border-b border-white/[0.06] sticky top-0 z-40">
        <div className="h-16 flex items-center px-4 md:px-8 justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white shadow-lg">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">Intelligent Strategist</h1>
              <p className="text-[10px] font-semibold opacity-30 tracking-wider uppercase mt-0.5 text-[var(--text-primary)]">Workspace Intelligence</p>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg glass text-xs font-semibold text-[var(--text-tertiary)]">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
            {completedMeetingsCount} meetings{dateFrom || dateTo ? ' (filtered)' : ''}
          </div>
        </div>

        {/* Date Range Picker */}
        <div className="px-4 md:px-8 pb-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold opacity-40 text-[var(--text-primary)]">From</label>
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setAnalysis(null); }}
                  onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                  className="glass-input rounded-lg pl-8 pr-3 py-2 text-sm text-[var(--text-primary)] cursor-pointer"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold opacity-40 text-[var(--text-primary)]">To</label>
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setAnalysis(null); }}
                  onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                  className="glass-input rounded-lg pl-8 pr-3 py-2 text-sm text-[var(--text-primary)] cursor-pointer"
                />
              </div>
            </div>
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); setAnalysis(null); }}
                className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear dates
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pt-8 pb-32 px-4 md:px-8 scrollbar-hide">
        <div className="max-w-4xl mx-auto">

          {/* No meetings state */}
          {completedMeetingsCount === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-20 h-20 rounded-2xl bg-white/5 flex items-center justify-center mb-6">
                <svg className="w-10 h-10 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <h3 className="opacity-60 font-semibold text-lg mb-2">
                {dateFrom || dateTo ? 'No meetings in selected date range' : 'No meetings to analyze yet'}
              </h3>
              <p className="opacity-30 text-sm max-w-md">
                {dateFrom || dateTo
                  ? 'Try adjusting the date range or clear the filter.'
                  : 'Record at least 2 meetings to unlock strategic insights across your workspace.'
                }
              </p>
            </div>
          )}

          {/* Has meetings but no analysis yet */}
          {completedMeetingsCount > 0 && !analysis && !isLoading && !error && (
            <div className="space-y-8">
              <div className="text-center py-12">
                <div className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br from-purple-500/20 to-indigo-600/20 flex items-center justify-center mb-6 border border-white/10">
                  <svg className="w-12 h-12 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold mb-3 text-[var(--text-primary)]">Ready for Strategic Analysis</h2>
                <p className="text-[var(--text-secondary)] mb-8 max-w-lg mx-auto opacity-60">
                  Analyze {completedMeetingsCount} meeting{completedMeetingsCount !== 1 ? 's' : ''} to identify process gaps, strategic actions, and recurring issues across your workspace.
                </p>
                <button
                  onClick={handleGenerateAnalysis}
                  className="px-8 py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl font-semibold shadow-lg shadow-purple-500/30 transition-all duration-300 inline-flex items-center gap-3 text-base"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate Strategic Insights
                </button>
              </div>

              {/* Preview cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="glass p-6 rounded-xl border border-white/10">
                  <div className="text-3xl mb-2">🔍</div>
                  <h3 className="font-bold mb-1 text-[var(--text-primary)]">Process Gaps</h3>
                  <p className="text-xs opacity-50 text-[var(--text-primary)]">Repeated bottlenecks across meetings</p>
                </div>
                <div className="glass p-6 rounded-xl border border-white/10">
                  <div className="text-3xl mb-2">🎯</div>
                  <h3 className="font-bold mb-1 text-[var(--text-primary)]">Strategic Actions</h3>
                  <p className="text-xs opacity-50 text-[var(--text-primary)]">High-level operational improvements</p>
                </div>
                <div className="glass p-6 rounded-xl border border-white/10">
                  <div className="text-3xl mb-2">⚠️</div>
                  <h3 className="font-bold mb-1 text-[var(--text-primary)]">Issue Patterns</h3>
                  <p className="text-xs opacity-50 text-[var(--text-primary)]">Recurring unresolved problems</p>
                </div>
              </div>
            </div>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="relative w-24 h-24 mb-8">
                <div className="absolute inset-0 rounded-full border-4 border-white/10"></div>
                <div className="absolute inset-0 rounded-full border-4 border-t-purple-500 border-r-indigo-500 border-b-purple-600 border-l-transparent animate-spin"></div>
                <div className="absolute inset-4 rounded-full bg-gradient-to-br from-purple-500/20 to-indigo-500/20 animate-pulse"></div>
              </div>
              <h3 className="text-xl font-bold mb-2">Analyzing workspace intelligence...</h3>
              <p className="text-sm opacity-40">Processing {completedMeetingsCount} meetings across your workspace</p>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="py-12 text-center">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-red-500/10 flex items-center justify-center mb-4 border border-red-500/20">
                <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="font-bold text-red-400 mb-2">Analysis Failed</h3>
              <p className="text-sm opacity-50 mb-6">{error}</p>
              <button
                onClick={handleGenerateAnalysis}
                className="px-6 py-2.5 glass glass-hover rounded-xl text-sm font-semibold"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Analysis results */}
          {analysis && !isLoading && (
            <div className="space-y-8 animate-fade-in">
              {/* Executive Summary */}
              <div className="glass p-8 rounded-2xl border border-white/10 group">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20 flex items-center justify-center border border-white/[0.08]">
                    <span className="text-2xl">📊</span>
                  </div>
                  <div className="flex-1">
                    <h2 className="text-xl font-bold text-[var(--text-primary)]">Executive Summary</h2>
                    <p className="text-xs opacity-40 text-[var(--text-primary)]">
                      {new Date(analysis.dateRange.start).toLocaleDateString()} - {new Date(analysis.dateRange.end).toLocaleDateString()}
                    </p>
                  </div>
                  <CopyShareButtons
                    label="summary"
                    text={`Executive Summary\n\n${analysis.summary}`}
                    shareTitle="Executive Summary"
                  />
                </div>
                <p className="text-base leading-relaxed text-[var(--text-secondary)] opacity-80">
                  {analysis.summary}
                </p>
              </div>

              {/* Section tabs */}
              <div className="flex glass p-1.5 rounded-xl w-fit">
                <button
                  onClick={() => setActiveSection('actions')}
                  className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
                    activeSection === 'actions'
                      ? 'bg-purple-500/20 text-purple-300 shadow-lg'
                      : 'opacity-40 hover:opacity-60'
                  }`}
                >
                  Strategic Actions ({analysis.strategicActions.length})
                </button>
                <button
                  onClick={() => setActiveSection('gaps')}
                  className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
                    activeSection === 'gaps'
                      ? 'bg-purple-500/20 text-purple-300 shadow-lg'
                      : 'opacity-40 hover:opacity-60'
                  }`}
                >
                  Process Gaps ({analysis.processGaps.length})
                </button>
                <button
                  onClick={() => setActiveSection('issues')}
                  className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
                    activeSection === 'issues'
                      ? 'bg-purple-500/20 text-purple-300 shadow-lg'
                      : 'opacity-40 hover:opacity-60'
                  }`}
                >
                  Issue Patterns ({analysis.issuePatterns.length})
                </button>
              </div>

              {/* Strategic Actions */}
              {activeSection === 'actions' && (
                <div className="space-y-4">
                  {analysis.strategicActions.map((action, idx) => (
                    <div key={idx} className="glass p-6 rounded-xl border border-white/10 hover:border-purple-500/30 transition-all group">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="font-bold text-lg text-[var(--text-primary)] flex-1 pr-3">{action.title}</h3>
                        <div className="flex items-center gap-2 shrink-0">
                          <CopyShareButtons
                            label={`action-${idx}`}
                            text={`${action.title}\nPriority: ${action.priority.toUpperCase()}\n\n${action.description}\n\nRationale: ${action.rationale}`}
                            shareTitle={action.title}
                          />
                          <span className={`px-3 py-1 rounded-lg text-xs font-bold ${
                            action.priority === 'urgent' ? 'bg-red-500/20 text-red-300 border border-red-500/30' :
                            action.priority === 'high' ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30' :
                            action.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30' :
                            'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          }`}>
                            {action.priority.toUpperCase()}
                          </span>
                        </div>
                      </div>
                      <p className="text-[var(--text-secondary)] mb-3 opacity-80">{action.description}</p>
                      <div className="text-sm opacity-50 text-[var(--text-primary)]">
                        <span className="font-semibold">Rationale:</span> {action.rationale}
                      </div>
                    </div>
                  ))}
                  {analysis.strategicActions.length === 0 && (
                    <p className="text-center py-12 opacity-30">No strategic actions identified</p>
                  )}
                </div>
              )}

              {/* Process Gaps */}
              {activeSection === 'gaps' && (
                <div className="space-y-4">
                  {analysis.processGaps.map((gap, idx) => (
                    <div key={idx} className="glass p-6 rounded-xl border border-white/10 hover:border-purple-500/30 transition-all group">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="font-bold text-lg text-[var(--text-primary)] flex-1 pr-3">{gap.title}</h3>
                        <div className="flex items-center gap-2 shrink-0">
                          <CopyShareButtons
                            label={`gap-${idx}`}
                            text={`${gap.title}\nImpact: ${gap.impact.toUpperCase()} | Frequency: ${gap.frequency}x\n\n${gap.description}`}
                            shareTitle={gap.title}
                          />
                          <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-white/5 text-[var(--text-primary)]">
                            {gap.frequency}x mentioned
                          </span>
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                            gap.impact === 'high' ? 'bg-red-500/20 text-red-300' :
                            gap.impact === 'medium' ? 'bg-yellow-500/20 text-yellow-300' :
                            'bg-blue-500/20 text-blue-300'
                          }`}>
                            {gap.impact.toUpperCase()}
                          </span>
                        </div>
                      </div>
                      <p className="text-[var(--text-secondary)] opacity-80">{gap.description}</p>
                    </div>
                  ))}
                  {analysis.processGaps.length === 0 && (
                    <p className="text-center py-12 opacity-30">No process gaps identified</p>
                  )}
                </div>
              )}

              {/* Issue Patterns */}
              {activeSection === 'issues' && (
                <div className="space-y-4">
                  {analysis.issuePatterns.map((issue, idx) => (
                    <div key={idx} className="glass p-6 rounded-xl border border-white/10 hover:border-purple-500/30 transition-all group">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="font-bold text-lg text-[var(--text-primary)] flex-1 pr-3">{issue.issue}</h3>
                        <div className="flex items-center gap-2 shrink-0">
                          <CopyShareButtons
                            label={`issue-${idx}`}
                            text={`${issue.issue}\nOccurrences: ${issue.occurrences} | Status: ${issue.status.toUpperCase()}\n\n${new Date(issue.firstMentioned).toLocaleDateString()} - ${new Date(issue.lastMentioned).toLocaleDateString()}`}
                            shareTitle={issue.issue}
                          />
                          <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-white/5">
                            {issue.occurrences} times
                          </span>
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                            issue.status === 'escalating' ? 'bg-red-500/20 text-red-300 border border-red-500/30' :
                            issue.status === 'recurring' ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30' :
                            'bg-green-500/20 text-green-300 border border-green-500/30'
                          }`}>
                            {issue.status.toUpperCase()}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm opacity-50 text-[var(--text-primary)]">
                        {new Date(issue.firstMentioned).toLocaleDateString()} - {new Date(issue.lastMentioned).toLocaleDateString()}
                      </p>
                    </div>
                  ))}
                  {analysis.issuePatterns.length === 0 && (
                    <p className="text-center py-12 opacity-30">No issue patterns identified</p>
                  )}
                </div>
              )}

              {/* Regenerate button */}
              <div className="flex justify-center pt-8">
                <button
                  onClick={handleGenerateAnalysis}
                  className="px-6 py-3 glass glass-hover rounded-xl text-sm font-semibold flex items-center gap-2 opacity-60 hover:opacity-100 transition-all"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Regenerate Analysis
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StrategistView;
