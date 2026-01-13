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
    const shareText = `VaniLog insight brief: ${session.title}\nDate: ${new Date(session.date).toLocaleDateString()}\n\n${session.analysis.summary}`;
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
    let currentSection: { title: string; content: string[]; startIndex: number } | null = null;
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
    if (currentSection) {
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
      <div key={section.title} className="group/section relative mb-16 animate-in fade-in slide-in-from-bottom-6 duration-700">
        <div className="flex items-center justify-between mb-6 group">
          <div className="flex-1"></div>
          <button 
            onClick={() => copySection(section.title, section.content)}
            className={`opacity-0 group-hover/section:opacity-100 transition-all flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-extrabold border shadow-sm ${
              copiedSection === section.title 
                ? 'bg-amber-50 border-amber-100 text-amber-600' 
                : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300'
            }`}
          >
            {copiedSection === section.title ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="space-y-1.5 pl-6 border-l-2 border-slate-50 group-hover/section:border-amber-100 transition-colors duration-500">
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
                  <div key={`table-${i}`} className="overflow-x-auto my-8 border border-slate-100 rounded-2xl shadow-sm">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50 border-b border-slate-100">
                          {currentTable[0].map((cell, idx) => (
                            <th key={idx} className="px-5 py-3 text-[11px] font-bold text-slate-500 tracking-tight">{cell}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {currentTable.slice(1).map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-slate-50/30 transition-colors">
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className="px-5 py-4 text-sm text-slate-600 font-medium">{cell}</td>
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
            if (trimmed.startsWith('## ')) return <h2 key={i} className="text-2xl font-bold text-slate-900 mt-2 mb-8 tracking-tight border-b border-slate-50 pb-3">{trimmed.replace('## ', '')}</h2>;
            if (/^[📋🎯📝💬✅🎲❓📊📅🔗💡🚧📌🗣️📎]/.test(trimmed)) return <h2 key={i} className="text-xl font-bold text-slate-900 -ml-6 mt-2 mb-8 flex items-center gap-3 bg-white z-10"><span className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center border border-slate-100 shadow-sm">{trimmed.substring(0, 2)}</span> {trimmed.substring(2)}</h2>;
            if (trimmed.startsWith('### ')) return <h3 key={i} className="text-lg font-bold text-slate-800 mt-8 mb-5 tracking-tight">{trimmed.replace('### ', '')}</h3>;
            if (trimmed.startsWith('- [ ]')) return (
                <div key={i} className="flex items-start gap-3.5 my-3 group/cb">
                  <div className="mt-1 w-5 h-5 rounded-md border-2 border-slate-200 group-hover/cb:border-amber-400 transition-all shrink-0 shadow-sm"></div>
                  <span className="text-slate-700 font-medium leading-relaxed">{trimmed.replace('- [ ]', '').trim()}</span>
                </div>
            );
            if (trimmed.startsWith('- [x]')) return (
                <div key={i} className="flex items-start gap-3.5 my-3 opacity-60">
                  <div className="mt-1 w-5 h-5 rounded-md bg-amber-500 border-2 border-amber-500 flex items-center justify-center shrink-0 shadow-sm"><svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" /></svg></div>
                  <span className="text-slate-400 line-through font-medium leading-relaxed">{trimmed.replace('- [x]', '').trim()}</span>
                </div>
            );
            if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) return <li key={i} className="ml-5 pl-2 my-2 text-slate-600 list-disc marker:text-amber-500 font-medium">{trimmed.substring(2)}</li>;
            if (trimmed === '') return <div key={i} className="h-4"></div>;
            return <p key={i} className="text-[17px] leading-[1.7] text-slate-600 mb-3 font-medium tracking-tight">{trimmed}</p>;
          })}
        </div>
      </div>
    );
  };

  if (session.status === 'processing') return (
    <div className="flex flex-col items-center justify-center h-full bg-white px-8">
      <div className="relative w-20 h-20 mb-10">
        <div className="absolute inset-0 border-[4px] border-slate-100 rounded-full"></div>
        <div className="absolute inset-0 border-[4px] border-t-amber-500 rounded-full animate-spin"></div>
        <div className="absolute inset-4 bg-amber-50 rounded-full animate-pulse"></div>
      </div>
      <h3 className="text-xl font-bold text-slate-800 tracking-tight mb-2">Architecting document</h3>
      <p className="text-sm text-slate-400 font-bold tracking-tight">Synthesizing insights...</p>
    </div>
  );

  if (!session.analysis) return null;

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden font-sans selection:bg-amber-100 selection:text-amber-900">
      {/* Header Layout */}
      <header className="shrink-0 bg-white border-b border-slate-100 sticky top-0 z-40 backdrop-blur-md">
        {/* Row 1: Breadcrumbs */}
        <div className="h-12 flex items-center px-8 border-b border-slate-50">
          <div className="flex items-center gap-3">
            <button className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <nav className="flex items-center gap-2 text-[11px] font-bold text-slate-400 tracking-tight">
              <span className="hover:text-slate-900 cursor-pointer transition-colors">Workspace</span>
              <span className="text-slate-200">/</span>
              <span className="text-slate-900 truncate max-w-[200px]">{session.title}</span>
            </nav>
          </div>
        </div>

        {/* Row 2: Action Buttons */}
        <div className="h-16 flex items-center gap-3 px-8">
          <button 
            onClick={handleShare}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-bold tracking-tight border transition-all ${
              sharing ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
            {sharing ? "Link copied" : "Share"}
          </button>

          <button 
            onClick={copyToClipboard}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-bold tracking-tight border transition-all ${
              globalCopied ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900'
            }`}
          >
            {globalCopied ? "Copied" : "Export"}
          </button>

          <div className="flex bg-slate-100 p-1 rounded-[1.25rem] border border-slate-200/50 shadow-inner ml-2">
            <button
              onClick={() => setActiveTab('notes')}
              className={`px-5 py-2 rounded-[1rem] text-[11px] font-bold tracking-tight transition-all ${
                activeTab === 'notes' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              Notes
            </button>
            <button
              onClick={() => setActiveTab('transcript')}
              className={`px-5 py-2 rounded-[1rem] text-[11px] font-bold tracking-tight transition-all ${
                activeTab === 'transcript' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              Script
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto bg-white pt-16 pb-32 px-6 md:px-0">
        <article className="max-w-2xl mx-auto">
          <div className="mb-16">
            <div className="flex items-center gap-3 mb-6">
               <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-600 rounded-lg text-[9px] font-extrabold border border-indigo-100/50">Verified analysis</span>
               <span className="text-slate-200">•</span>
               <span className="text-slate-400 text-[9px] font-extrabold">{new Date(session.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              className="text-5xl font-extrabold text-slate-900 bg-transparent border-none p-0 focus:ring-0 placeholder-slate-100 w-full tracking-tighter leading-tight"
            />
            <div className="flex items-center gap-5 mt-10 text-slate-400 text-[10px] font-extrabold border-t border-slate-50 pt-8">
               <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg">
                 <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                 {Math.floor(session.duration/60)}m {session.duration%60}s
               </div>
               <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg">
                 <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                 {session.source.replace('-', ' ')}
               </div>
            </div>
          </div>

          <div className="prose prose-slate max-w-none">
            {activeTab === 'notes' ? (
              <div className="animate-in fade-in duration-700">
                {sections.length > 0 ? sections.map(renderRichSection) : <p className="text-slate-400">Synthesizing content...</p>}
              </div>
            ) : (
              <div className="animate-in fade-in duration-500 space-y-10">
                <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight pb-6 border-b border-slate-50">Verbatim transcript</h2>
                <div className="space-y-10 pl-4 border-l-2 border-slate-50">
                  {session.analysis.transcript.split('\n').filter(l => l.trim()).map((line, i) => {
                    const speakerMatch = line.match(/^([^(\[]+)/);
                    const speaker = speakerMatch ? speakerMatch[1].trim() : "Speaker";
                    const text = line.replace(/^[^:]+:\s*/, '').trim();
                    return (
                      <div key={i} className="group flex gap-8">
                        <div className="w-20 shrink-0">
                           <div className="text-[11px] font-extrabold text-slate-900 truncate">{speaker}</div>
                        </div>
                        <div className="flex-1">
                          <p className="text-slate-600 leading-relaxed text-[17px] font-medium tracking-tight">{text}</p>
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