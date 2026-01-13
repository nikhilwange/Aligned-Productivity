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

  useEffect(() => { setTitle(session.title); }, [session.id, session.title]);

  const handleTitleBlur = () => { if (title.trim() !== session.title) onUpdateTitle(session.id, title); };

  const copyToClipboard = () => {
    if (!session.analysis) return;
    const fullText = `${session.title}\n\nSummary:\n${session.analysis.summary}\n\nTranscript:\n${session.analysis.transcript}`;
    navigator.clipboard.writeText(fullText);
    alert("Full analysis exported to clipboard.");
  };

  const sections = useMemo(() => {
    if (!session.analysis?.summary) return [];
    const lines = session.analysis.summary.split('\n');
    const result: { title: string; content: string }[] = [];
    let currentSection: { title: string; content: string[] } | null = null;
    
    lines.forEach((line) => {
      const isHeader = /^[📋🎯📝💬✅🎲❓📊📅🔗💡🚧📌🗣️📎]/.test(line.trim()) || line.trim().startsWith('## ');
      if (isHeader) {
        if (currentSection) { result.push({ title: currentSection.title, content: currentSection.content.join('\n').trim() }); }
        currentSection = { title: line.trim().replace(/^##\s*/, ''), content: [line] };
      } else if (currentSection) { currentSection.content.push(line); }
    });
    if (currentSection) { result.push({ title: currentSection.title, content: currentSection.content.join('\n').trim() }); }
    return result;
  }, [session.analysis?.summary]);

  if (session.status === 'processing') return (
    <div className="flex flex-col items-center justify-center h-full p-12 bg-white rounded-[3rem] shadow-sm">
      <div className="w-20 h-20 bg-[#F1F5F9] rounded-[2rem] flex items-center justify-center animate-pulse mb-8">
         <svg className="w-8 h-8 text-[#7FA9F5] animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
      </div>
      <h3 className="text-2xl font-black text-[#1C1C1C] tracking-tight">Synthesizing Knowledge</h3>
      <p className="text-slate-400 font-semibold mt-2">Gemini is structuring your session insights.</p>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden animate-fade">
      {/* View Header */}
      <div className="px-12 py-8 flex items-center justify-between border-b border-slate-50 shrink-0 bg-white/50 backdrop-blur-md sticky top-0 z-20">
         <div className="flex bg-[#F8FAFC] p-1.5 rounded-2xl border border-slate-50">
            <button onClick={() => setActiveTab('notes')} className={`px-6 py-2 rounded-xl text-[11px] font-black transition-all ${activeTab === 'notes' ? 'bg-[#1C1C1C] text-white shadow-xl shadow-black/10' : 'text-slate-400 hover:text-slate-900'}`}>Insights</button>
            <button onClick={() => setActiveTab('transcript')} className={`px-6 py-2 rounded-xl text-[11px] font-black transition-all ${activeTab === 'transcript' ? 'bg-[#1C1C1C] text-white shadow-xl shadow-black/10' : 'text-slate-400 hover:text-slate-900'}`}>Verbatim</button>
         </div>
         <div className="flex gap-4">
            <button onClick={copyToClipboard} className="px-6 py-2 rounded-xl text-[11px] font-black border border-slate-200 text-[#1C1C1C] hover:border-[#1C1C1C] transition-all">Export Analysis</button>
         </div>
      </div>

      {/* Main Content Scroll Container */}
      <div className="flex-1 overflow-y-auto px-12 pb-24 pt-10 scrollbar-hide">
        <header className="mb-14">
           <div className="flex items-center gap-3 mb-4">
              <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                session.status === 'completed' ? 'bg-[#DCFCE7] text-green-700' : 'bg-rose-50 text-rose-600'
              }`}>
                {session.status} analysis
              </span>
              <span className="text-slate-200">•</span>
              <span className="text-slate-400 font-black text-[10px] uppercase tracking-widest">{new Date(session.date).toLocaleDateString()}</span>
           </div>
           <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={handleTitleBlur} className="text-5xl font-black text-[#1C1C1C] bg-transparent border-none p-0 focus:ring-0 placeholder-slate-200 w-full tracking-tighter" />
        </header>

        {activeTab === 'notes' ? (
           <div className="space-y-12">
             {sections.map((section, idx) => (
               <div key={idx} className="group relative p-10 bg-[#F8FAFC]/50 rounded-[2.5rem] border border-slate-50 hover:bg-white hover:shadow-2xl hover:shadow-blue-900/5 transition-all duration-500">
                 <div className="prose prose-slate max-w-none">
                   {section.content.split('\n').map((line, i) => {
                     const trimmed = line.trim();
                     if (trimmed.startsWith('## ') || /^[📋🎯📝💬✅🎲❓📊📅🔗💡🚧📌🗣️📎]/.test(trimmed)) {
                       return <h2 key={i} className="text-xl font-black text-[#1C1C1C] mb-8 flex items-center gap-4"><span className="w-10 h-10 rounded-2xl bg-[#7FA9F5]/20 flex items-center justify-center text-lg shadow-sm border border-white">{trimmed.substring(0,2)}</span> {trimmed.substring(2)}</h2>;
                     }
                     if (trimmed.startsWith('- [ ]')) {
                        return <div key={i} className="flex items-start gap-4 my-4 p-4 bg-white/40 rounded-2xl border border-transparent hover:border-[#7FA9F5]/30 transition-all shadow-sm">
                          <div className="mt-1 w-6 h-6 rounded-lg border-2 border-slate-200 hover:border-[#7FA9F5] transition-all shrink-0"></div>
                          <span className="text-slate-700 font-bold text-sm leading-relaxed">{trimmed.replace('- [ ]', '').trim()}</span>
                        </div>;
                     }
                     return <p key={i} className="text-[16px] leading-[1.8] text-slate-500 font-semibold mb-3">{trimmed}</p>;
                   })}
                 </div>
               </div>
             ))}
           </div>
        ) : (
          <div className="space-y-8">
            {session.analysis?.transcript.split('\n').map((line, i) => (
              <div key={i} className="p-8 bg-[#F8FAFC]/50 rounded-[2rem] border border-slate-50 hover:bg-white transition-all group">
                <p className="text-slate-500 font-bold leading-relaxed">{line}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ResultsView;