
import React, { useState, useEffect, useMemo } from 'react';
import { RecordingSession } from '../types';

interface ResultsViewProps {
  session: RecordingSession;
  onUpdateTitle: (id: string, newTitle: string) => void;
}

const ResultsView: React.FC<ResultsViewProps> = ({ session, onUpdateTitle }) => {
  const [activeTab, setActiveTab] = useState<'notes' | 'transcript'>('notes');
  const [title, setTitle] = useState(session.title);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [globalCopied, setGlobalCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    setTitle(session.title);
  }, [session.id, session.title]);

  useEffect(() => {
    if (session.status === 'completed' && session.analysis?.meetingType && session.title.startsWith('Recording ')) {
      const newTitle = session.analysis.meetingType;
      onUpdateTitle(session.id, newTitle);
      setTitle(newTitle);
    }
  }, [session.status, session.analysis?.meetingType, session.id]);

  const handleTitleBlur = () => {
    if (title.trim() !== session.title) onUpdateTitle(session.id, title);
  };

  const copyToClipboard = () => {
    if (!session.analysis) return;
    const fullText = `${session.title}\n\nSummary & Notes:\n${session.analysis.summary}\n\nFull transcript:\n${session.analysis.transcript}`;
    navigator.clipboard.writeText(fullText);
    setGlobalCopied(true);
    setTimeout(() => setGlobalCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!session.analysis) return;
    const shareText = `Aligned insight brief: ${session.title}\nDate: ${new Date(session.date).toLocaleDateString()}\n\n${session.analysis.summary}`;
    const currentUrl = window.location.href;
    const isValidUrl = currentUrl.startsWith('http');
    try {
      if (navigator.share) {
        await navigator.share({
          title: session.title,
          text: shareText,
          ...(isValidUrl ? { url: currentUrl } : {})
        });
      } else {
        throw new Error('Web Share API not supported');
      }
    } catch (err) {
      console.warn("Share failed, falling back to clipboard:", err);
      await navigator.clipboard.writeText(`${shareText}${isValidUrl ? `\n\nLink: ${currentUrl}` : ''}`);
      setSharing(true);
      setTimeout(() => setSharing(false), 2000);
    }
  };

  const copySection = (sectionName: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedSection(sectionName);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const sections = useMemo(() => {
    if (!session.analysis?.summary) return [];
    const lines = session.analysis.summary.split('\n');
    const result: { title: string; content: string; startIndex: number; endIndex: number }[] = [];
    const firstLineIsHeader = lines.length > 0 && (/^[📋🎯📝💬✅🎲❓📊📅🔗💡🚧📌🗣️📎]/.test(lines[0].trim()) || lines[0].trim().startsWith('## '));

    let currentSection: { title: string; content: string[]; startIndex: number } | null = firstLineIsHeader ? null : {
      title: 'Summary',
      content: [],
      startIndex: 0
    };
    lines.forEach((line, index) => {
      const isHeader = /^[📋🎯📝💬✅🎲❓📊📅🔗💡🚧📌🗣️📎]/.test(line.trim()) || line.trim().startsWith('## ');
      if (isHeader) {
        if (currentSection) {
          result.push({
            title: currentSection.title,
            content: currentSection.content.join('\n').trim(),
            startIndex: currentSection.startIndex,
            endIndex: index - 1
          });
        }
        currentSection = {
          title: line.trim().replace(/^##\s*/, ''),
          content: [line],
          startIndex: index
        };
      } else if (currentSection) {
        currentSection.content.push(line);
      }
    });
    if (currentSection && currentSection.content.length > 0) {
      result.push({
        title: currentSection.title,
        content: currentSection.content.join('\n').trim(),
        startIndex: currentSection.startIndex,
        endIndex: lines.length - 1
      });
    }
    return result;
  }, [session.analysis?.summary]);

  const renderRichSection = (section: typeof sections[0]) => {
    const lines = section.content.split('\n');
    let inTable = false;
    let tableRows: string[][] = [];
    return (
      <div key={section.title} className="group/section relative mb-12 animate-fade-in-up">
        <div className="flex items-center justify-between mb-4 group">
          <div className="flex-1"></div>
          <button
            onClick={() => copySection(section.title, section.content)}
            className={`opacity-0 group-hover/section:opacity-100 transition-all flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold ${copiedSection === section.title
              ? 'bg-teal-500/20 text-teal-300'
              : 'glass text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
          >
            {copiedSection === section.title ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="space-y-2 pl-5 border-l-2 border-white/[0.06] group-hover/section:border-purple-500/30 transition-colors duration-500">
          {lines.map((line, i) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('|')) {
              inTable = true;
              const cells = trimmed.split('|').map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
              if (trimmed.includes('---')) return null;
              tableRows.push(cells);
              const nextLine = lines[i + 1]?.trim();
              if (!nextLine || !nextLine.startsWith('|')) {
                const currentTable = [...tableRows];
                tableRows = [];
                inTable = false;
                return (
                  <div key={`table-${i}`} className="overflow-x-auto my-6 glass rounded-xl">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-white/[0.06]">
                          {currentTable[0].map((cell, idx) => (
                            <th key={idx} className="px-5 py-3 text-xs font-bold opacity-50 tracking-wide text-[var(--text-primary)]">{cell}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {currentTable.slice(1).map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-white/[0.02] transition-colors text-[var(--text-secondary)]">
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className="px-5 py-4 text-sm font-medium">{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }
              return null;
            }
            if (trimmed.startsWith('## ')) return <h2 key={i} className="text-xl font-bold text-[var(--text-primary)] mt-6 mb-6 tracking-tight border-b border-white/[0.06] pb-3">{trimmed.replace('## ', '')}</h2>;
            if (/^[📋🎯📝💬✅🎲❓📊📅🔗💡🚧📌🗣️📎]/.test(trimmed)) return (
              <h2 key={i} className="text-lg font-bold text-[var(--text-primary)] -ml-5 mt-6 mb-6 flex items-center gap-3 bg-[var(--surface-950)] z-10">
                <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-teal-500/20 flex items-center justify-center border border-white/[0.08] shadow-lg">
                  {trimmed.substring(0, 2)}
                </span>
                <span className="opacity-90">{trimmed.substring(2)}</span>
              </h2>
            );
            if (trimmed.startsWith('### ')) return <h3 key={i} className="text-base font-bold opacity-80 mt-6 mb-4 tracking-tight text-[var(--text-primary)]">{trimmed.replace('### ', '')}</h3>;
            if (trimmed.startsWith('- [ ]')) return (
              <div key={i} className="flex items-start gap-3 my-2 group/cb">
                <div className="mt-1 w-5 h-5 rounded-md border-2 border-white/20 group-hover/cb:border-purple-400 transition-all shrink-0"></div>
                <span className="text-[var(--text-secondary)] font-medium leading-relaxed">{trimmed.replace('- [ ]', '').trim()}</span>
              </div>
            );
            if (trimmed.startsWith('- [x]')) return (
              <div key={i} className="flex items-start gap-3 my-2 opacity-50">
                <div className="mt-1 w-5 h-5 rounded-md bg-teal-500 border-2 border-teal-500 flex items-center justify-center shrink-0">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-[var(--text-secondary)] line-through font-medium leading-relaxed">{trimmed.replace('- [x]', '').trim()}</span>
              </div>
            );
            if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) return (
              <li key={i} className="ml-4 pl-2 my-2 text-[var(--text-secondary)] list-disc marker:text-purple-400 font-medium opacity-80">{trimmed.substring(2)}</li>
            );
            if (trimmed === '') return <div key={i} className="h-3"></div>;
            return <p key={i} className="text-base leading-relaxed text-[var(--text-secondary)] mb-2 font-medium opacity-80">{trimmed}</p>;
          })}
        </div>
      </div>
    );
  };

  if (session.status === 'processing') return (
    <div className="flex flex-col items-center justify-center h-full bg-[var(--surface-950)] px-8">
      {/* Loading animation */}
      <div className="relative w-24 h-24 mb-10">
        <div className="absolute inset-0 rounded-full border-4 border-white/10"></div>
        <div className="absolute inset-0 rounded-full border-4 border-t-purple-500 border-r-teal-500 border-b-amber-500 border-l-transparent animate-spin"></div>
        <div className="absolute inset-4 rounded-full bg-gradient-to-br from-purple-500/20 to-teal-500/20 animate-pulse"></div>
      </div>
      <h3 className="text-xl font-bold text-[var(--text-primary)] tracking-tight mb-2">Aligning insights</h3>
      <p className="text-sm opacity-40 font-medium text-[var(--text-primary)]">Synthesizing workspace content...</p>
    </div>
  );

  if (!session.analysis) return null;

  return (
    <div className="flex flex-col h-full bg-[var(--surface-950)] overflow-hidden text-[var(--text-primary)]">
      {/* Header */}
      <header className="shrink-0 bg-[var(--surface-900)]/80 backdrop-blur-xl border-b border-white/[0.06] sticky top-0 z-40">
        {/* Breadcrumbs */}
        <div className="h-12 flex items-center px-4 md:px-8 border-b border-white/[0.04]">
          <div className="flex items-center gap-3">
            <button className="p-1.5 hover:bg-white/5 rounded-lg opacity-30 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <nav className="flex items-center gap-2 text-xs font-semibold opacity-40 text-[var(--text-primary)]">
              <span className="hover:opacity-100 cursor-pointer transition-colors">Workspace</span>
              <span className="opacity-50">/</span>
              <span className="opacity-100">{session.title}</span>
            </nav>
          </div>
        </div>

        {/* Actions */}
        <div className="h-16 flex items-center gap-3 px-4 md:px-8 overflow-x-auto scrollbar-hide">
          <button
            onClick={handleShare}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${sharing 
              ? 'bg-teal-500/20 text-teal-300' 
              : 'glass glass-hover opacity-60 hover:opacity-100'
            }`}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            <span className="whitespace-nowrap">{sharing ? "Copied" : "Share"}</span>
          </button>

          <button
            onClick={copyToClipboard}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${globalCopied 
              ? 'bg-teal-500/20 text-teal-300' 
              : 'glass glass-hover opacity-60 hover:opacity-100'
            }`}
          >
            {globalCopied ? "Copied" : "Export"}
          </button>

          <div className="flex glass p-1 rounded-xl ml-auto">
            <button
              onClick={() => setActiveTab('notes')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'notes' 
                ? 'bg-purple-500/20 text-purple-300 shadow-lg shadow-purple-500/10' 
                : 'opacity-40 hover:opacity-60'
              }`}
            >
              Notes
            </button>
            <button
              onClick={() => setActiveTab('transcript')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'transcript' 
                ? 'bg-purple-500/20 text-purple-300 shadow-lg shadow-purple-500/10' 
                : 'opacity-40 hover:opacity-60'
              }`}
            >
              Script
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-[var(--surface-950)] pt-8 md:pt-12 pb-32 px-4 md:px-6 scrollbar-hide">
        <article className="max-w-2xl mx-auto">
          {/* Title Section */}
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-6">
              <span className="px-2.5 py-1 bg-purple-500/20 text-purple-600 rounded-lg text-[10px] font-bold border border-purple-500/20">
                Verified analysis
              </span>
              <span className="opacity-20 text-[var(--text-primary)]">•</span>
              <span className="opacity-40 text-xs font-medium text-[var(--text-primary)]">
                {new Date(session.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
            </div>
            
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] bg-transparent border-none p-0 focus:ring-0 focus:outline-none placeholder-[var(--text-muted)] w-full tracking-tight leading-tight"
            />
            
            <div className="flex items-center gap-4 mt-8 opacity-40 text-xs font-semibold border-t border-white/[0.06] pt-6">
              <div className="flex items-center gap-2 glass px-3 py-1.5 rounded-lg">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-mono">{Math.floor(session.duration / 60)}m {session.duration % 60}s</span>
              </div>
              <div className="flex items-center gap-2 glass px-3 py-1.5 rounded-lg">
                <div className={`w-2 h-2 rounded-full ${
                  session.source === 'virtual-meeting' ? 'bg-purple-400' 
                  : session.source === 'phone-call' ? 'bg-teal-400' 
                  : session.source === 'dictation' ? 'bg-amber-400'
                  : 'bg-white/40'
                }`}></div>
                <span className="capitalize">{session.source.replace('-', ' ')}</span>
              </div>
            </div>
          </div>

          <div className="prose prose-invert max-w-none">
            {activeTab === 'notes' ? (
              <div className="animate-fade-in">
                {/* Warning for truncated content */}
                {session.analysis.isTruncated && (
                  <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-3 text-amber-600 text-sm font-medium">
                    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    The transcript was too long and has been partially truncated.
                  </div>
                )}

                {/* Transcript Section - Only show at top for Dictation sessions */}
                {session.source === 'dictation' && session.analysis.transcript && (
                  <div className="mb-10 pb-8 border-b border-white/[0.06]">
                    <h2 className="text-lg font-bold text-[var(--text-primary)] mb-5 flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/20 to-teal-500/20 text-purple-300 flex items-center justify-center border border-white/[0.08] text-sm">🗣️</span>
                      Transcribed Text
                    </h2>
                    <div className="text-base leading-relaxed text-[var(--text-secondary)] font-medium opacity-80">
                      {session.analysis.transcript.split('\n').map((line, i) => (
                        <p key={i} className="mb-3">{line}</p>
                      ))}
                    </div>
                  </div>
                )}

                {sections.length > 0 ? sections.map(renderRichSection) : <p className="opacity-30">Synthesizing content...</p>}
              </div>
            ) : (
              <div className="animate-fade-in space-y-8">
                <h2 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight pb-5 border-b border-white/[0.06]">Verbatim transcript</h2>
                <div className="space-y-6 pl-4 border-l-2 border-white/[0.06]">
                  {session.analysis.transcript.split('\n').filter(l => l.trim()).map((line, i) => {
                    const hasSpeakerLabel = line.includes(':');
                    let speaker = "Dictation";
                    let text = line.trim();

                    if (hasSpeakerLabel) {
                      const parts = line.split(':');
                      speaker = parts[0].trim();
                      text = parts.slice(1).join(':').trim();
                    }

                    return (
                      <div key={i} className="group flex gap-6">
                        <div className="w-20 shrink-0">
                          <div className={`text-xs font-bold text-purple-300 truncate ${!hasSpeakerLabel && 'opacity-0'}`}>{speaker}</div>
                        </div>
                        <div className="flex-1">
                          <p className="text-[var(--text-secondary)] leading-relaxed text-base font-medium opacity-80">{text}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </article>
      </div>
    </div>
  );
};

export default ResultsView;
