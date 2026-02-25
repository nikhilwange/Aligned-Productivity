import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PinnedInsight } from '../types';
import { unpinInsight } from '../services/pinService';

interface PinnedInsightsViewProps {
  pins: PinnedInsight[];
  onPinsChange: () => void;
}

const PinnedInsightsView: React.FC<PinnedInsightsViewProps> = ({ pins, onPinsChange }) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (pin: PinnedInsight) => {
    const text = `Q: ${pin.question}\n\nA: ${pin.answer}`;
    await navigator.clipboard.writeText(text);
    setCopiedId(pin.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleUnpin = (id: string) => {
    unpinInsight(id);
    onPinsChange();
  };

  const markdownComponents: Record<string, React.FC<any>> = {
    strong: ({ children }) => <strong className="font-bold text-[var(--text-primary)]">{children}</strong>,
    ul: ({ children }) => <ul className="ml-4 space-y-1 my-2">{children}</ul>,
    ol: ({ children }) => <ol className="ml-4 space-y-1 my-2 list-decimal marker:text-teal-400">{children}</ol>,
    li: ({ children }) => <li className="pl-1 text-[var(--text-secondary)] list-disc marker:text-teal-400 leading-relaxed">{children}</li>,
    p: ({ children }) => <p className="text-sm leading-relaxed text-[var(--text-secondary)] mb-2">{children}</p>,
    h2: ({ children }) => <h2 className="text-base font-bold text-[var(--text-primary)] mt-4 mb-2">{children}</h2>,
    h3: ({ children }) => <h3 className="text-sm font-bold text-[var(--text-primary)] mt-3 mb-1">{children}</h3>,
    code: ({ children, className }: any) => {
      if (className?.includes('language-')) {
        return <code className="block bg-white/[0.03] rounded-lg p-3 text-xs font-mono text-[var(--text-secondary)] overflow-x-auto my-2">{children}</code>;
      }
      return <code className="bg-white/[0.06] px-1 py-0.5 rounded text-xs font-mono text-teal-300">{children}</code>;
    },
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-teal-500/30 pl-3 my-2 opacity-80">{children}</blockquote>
    ),
  };

  if (pins.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center border border-white/[0.08] mb-5">
          <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
        </div>
        <h3 className="text-base font-bold text-[var(--text-primary)] mb-2">No saved insights yet</h3>
        <p className="text-xs text-[var(--text-muted)] max-w-sm">
          Pin responses from your chat conversations to save them here for quick reference.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {pins.map((pin) => (
        <div key={pin.id} className="group glass-card rounded-2xl border border-white/[0.06] overflow-hidden">
          {/* Question */}
          <div className="px-5 py-3 bg-purple-500/5 border-b border-white/[0.04]">
            <p className="text-xs font-semibold text-purple-300 mb-1">Question</p>
            <p className="text-sm text-[var(--text-primary)] font-medium leading-relaxed">{pin.question}</p>
          </div>

          {/* Answer */}
          <div className="px-5 py-4">
            <div className="prose prose-sm prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {pin.answer}
              </ReactMarkdown>
            </div>

            {/* Citations */}
            {pin.citations && pin.citations.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-white/[0.04]">
                <span className="text-[10px] font-bold text-[var(--text-muted)] mr-1 self-center">Sources:</span>
                {pin.citations.map((cite, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-md bg-teal-500/15 text-teal-300 text-[10px] font-semibold border border-teal-500/20">
                    {cite}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-white/[0.04] flex items-center justify-between">
            <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)] font-medium">
              <span>{pin.scope}</span>
              <span className="opacity-30">|</span>
              <span>{new Date(pin.pinnedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => handleCopy(pin)}
                className={`p-1.5 rounded-lg transition-all text-[10px] font-bold flex items-center gap-1 ${
                  copiedId === pin.id
                    ? 'bg-teal-500/20 text-teal-300'
                    : 'glass text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {copiedId === pin.id ? (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy
                  </>
                )}
              </button>

              <button
                onClick={() => handleUnpin(pin.id)}
                className="p-1.5 rounded-lg glass text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-all text-[10px] font-bold flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Remove
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default PinnedInsightsView;
