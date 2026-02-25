import React, { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { v4 as uuidv4 } from 'uuid';
import { RecordingSession, ChatMessage } from '../types';
import { buildGlobalChatContext, sendChatMessage } from '../services/chatService';
import { getPinnedInsights, pinInsight, unpinInsight, isPinned } from '../services/pinService';
import PinnedInsightsView from './PinnedInsightsView';

interface ChatViewProps {
  recordings: RecordingSession[];
  messages: ChatMessage[];
  onMessagesChange: (messages: ChatMessage[]) => void;
}

const SUGGESTED_QUESTIONS = [
  "What are the most important action items across all my sessions?",
  "What recurring themes keep coming up?",
  "Summarize the key decisions made across all meetings.",
  "Which sessions had the most open questions or blockers?",
];

const ChatView: React.FC<ChatViewProps> = ({ recordings, messages, onMessagesChange }) => {
  const setMessages = (update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    if (typeof update === 'function') {
      onMessagesChange(update(messages));
    } else {
      onMessagesChange(update);
    }
  };
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'chat' | 'saved'>('chat');
  const [pinVersion, setPinVersion] = useState(0);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredRecordings = useMemo(() => {
    let filtered = recordings.filter(r => r.status === 'completed' && r.analysis);
    if (dateFrom) {
      filtered = filtered.filter(r => r.date >= new Date(dateFrom).getTime());
    }
    if (dateTo) {
      filtered = filtered.filter(r => r.date <= new Date(dateTo + 'T23:59:59').getTime());
    }
    return filtered;
  }, [recordings, dateFrom, dateTo]);

  const completedCount = filteredRecordings.length;
  const isDateFiltered = dateFrom !== '' || dateTo !== '';
  const pins = useMemo(() => getPinnedInsights(), [pinVersion]);

  const context = useMemo(
    () => buildGlobalChatContext(filteredRecordings as RecordingSession[]),
    [filteredRecordings]
  );

  // Reset chat when date range changes (context changes)
  useEffect(() => {
    setMessages([]);
    setError(null);
  }, [dateFrom, dateTo]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSend = async (text?: string) => {
    const messageText = (text || input).trim();
    if (!messageText || isLoading) return;

    setInput('');
    setError(null);

    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: messageText,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const scopeLabel = isDateFiltered
        ? `sessions from ${dateFrom || 'start'} to ${dateTo || 'now'}`
        : 'all your recorded sessions';
      const { text: responseText, citations } = await sendChatMessage(
        messageText,
        messages,
        context,
        scopeLabel
      );

      const assistantMessage: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
        citations,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err: any) {
      setError(err.message || 'Failed to get response');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopy = async (content: string, msgId: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(msgId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleTogglePin = (msg: ChatMessage) => {
    if (isPinned(msg.id)) {
      unpinInsight(msg.id);
    } else {
      // Find the preceding user message
      const msgIndex = messages.findIndex(m => m.id === msg.id);
      const question = msgIndex > 0 ? messages[msgIndex - 1].content : '';
      pinInsight({
        id: msg.id,
        question,
        answer: msg.content,
        citations: msg.citations,
        scope: isDateFiltered ? `Sessions (${dateFrom || '...'} — ${dateTo || '...'})` : 'All sessions',
        pinnedAt: Date.now(),
      });
    }
    setPinVersion(v => v + 1);
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
    table: ({ children }) => (
      <div className="overflow-x-auto my-3 rounded-lg border border-white/[0.06]">
        <table className="w-full text-left border-collapse text-xs">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="px-3 py-2 text-xs font-bold opacity-50 border-b border-white/[0.06]">{children}</th>,
    td: ({ children }) => <td className="px-3 py-2 text-xs border-b border-white/[0.04]">{children}</td>,
  };

  return (
    <div className="flex flex-col h-full bg-[var(--surface-950)] overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-5 border-b border-white/[0.06] bg-[var(--surface-900)]/50 backdrop-blur-xl">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-[var(--text-primary)] tracking-tight">Ask Aligned</h1>
              <p className="text-xs text-[var(--text-muted)] font-medium">
                {completedCount > 0
                  ? `${completedCount} session${completedCount !== 1 ? 's' : ''} in knowledge base${isDateFiltered ? ' (filtered)' : ''}`
                  : isDateFiltered ? 'No sessions in this date range' : 'No sessions recorded yet'}
              </p>
            </div>
          </div>

          {/* Chat / Saved toggle */}
          <div className="flex items-center gap-1 p-1 rounded-xl glass border border-white/[0.06]">
            <button
              onClick={() => setViewMode('chat')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === 'chat'
                  ? 'bg-teal-500/20 text-teal-300'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setViewMode('saved')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                viewMode === 'saved'
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              Saved
              {pins.length > 0 && (
                <span className={`min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold ${
                  viewMode === 'saved' ? 'bg-amber-500/30 text-amber-200' : 'bg-white/[0.08] text-[var(--text-muted)]'
                }`}>
                  {pins.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Date Filter Bar */}
      {viewMode === 'chat' && (
        <div className="shrink-0 px-6 py-3 border-b border-white/[0.04] bg-[var(--surface-900)]/30">
          <div className="max-w-2xl mx-auto flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold opacity-40 text-[var(--text-primary)]">From</label>
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
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
                  onChange={(e) => setDateTo(e.target.value)}
                  onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                  className="glass-input rounded-lg pl-8 pr-3 py-2 text-sm text-[var(--text-primary)] cursor-pointer"
                />
              </div>
            </div>

            {isDateFiltered && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear dates
              </button>
            )}
          </div>
        </div>
      )}

      {viewMode === 'saved' ? (
        /* Saved Pins View */
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 scrollbar-hide">
          <div className="max-w-2xl mx-auto">
            <PinnedInsightsView pins={pins} onPinsChange={() => setPinVersion(v => v + 1)} />
          </div>
        </div>
      ) : (
        <>
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 scrollbar-hide">
            <div className="max-w-2xl mx-auto space-y-6">
              {messages.length === 0 && !isLoading ? (
                /* Empty State */
                <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-teal-500/20 to-cyan-500/20 flex items-center justify-center border border-white/[0.08] mb-6">
                    <svg className="w-10 h-10 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">Ask anything about your sessions</h2>
                  <p className="text-sm text-[var(--text-muted)] max-w-md mb-8">
                    I have access to all your recorded sessions — transcripts, summaries, action items, and decisions. Ask me anything!
                  </p>

                  {completedCount > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
                      {SUGGESTED_QUESTIONS.map((q, i) => (
                        <button
                          key={i}
                          onClick={() => handleSend(q)}
                          className="text-left p-4 rounded-xl glass glass-hover border border-white/[0.06] hover:border-teal-500/30 transition-all group"
                        >
                          <p className="text-xs font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] leading-relaxed transition-colors">
                            {q}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}

                  {completedCount === 0 && (
                    <div className="glass rounded-xl p-6 border border-white/[0.06] max-w-sm">
                      <p className="text-sm text-[var(--text-muted)]">
                        Start by recording some sessions. Once you have data, I'll be able to answer questions about your meetings, action items, and more.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                /* Chat Messages */
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-5 py-4 ${
                        msg.role === 'user'
                          ? 'bg-gradient-to-r from-purple-600 to-purple-700 text-white shadow-lg shadow-purple-500/15'
                          : 'glass border border-white/[0.06]'
                      }`}
                    >
                      {msg.role === 'user' ? (
                        <p className="text-sm leading-relaxed font-medium">{msg.content}</p>
                      ) : (
                        <div className="prose prose-sm prose-invert max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      )}

                      {/* Action buttons for assistant messages */}
                      {msg.role === 'assistant' && (
                        <div className="flex items-center gap-1 mt-3 pt-3 border-t border-white/[0.06]">
                          <button
                            onClick={() => handleCopy(msg.content, msg.id)}
                            className={`p-1.5 rounded-lg transition-all text-[10px] font-bold flex items-center gap-1 ${
                              copiedId === msg.id
                                ? 'bg-teal-500/20 text-teal-300'
                                : 'glass text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                            }`}
                          >
                            {copiedId === msg.id ? (
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
                            onClick={() => handleTogglePin(msg)}
                            className={`p-1.5 rounded-lg transition-all text-[10px] font-bold flex items-center gap-1 ${
                              isPinned(msg.id)
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'glass text-[var(--text-muted)] hover:text-amber-300 hover:bg-amber-500/10'
                            }`}
                          >
                            <svg className="w-3.5 h-3.5" fill={isPinned(msg.id) ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                            </svg>
                            {isPinned(msg.id) ? 'Saved' : 'Save'}
                          </button>

                          {/* Citation chips inline */}
                          {msg.citations && msg.citations.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 ml-auto">
                              {msg.citations.map((cite, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-1 rounded-md bg-teal-500/15 text-teal-300 text-[10px] font-semibold border border-teal-500/20"
                                >
                                  {cite}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Citation chips for user messages (if any) */}
                      {msg.role === 'user' && msg.citations && msg.citations.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-white/[0.06]">
                          {msg.citations.map((cite, i) => (
                            <span
                              key={i}
                              className="px-2 py-1 rounded-md bg-teal-500/15 text-teal-300 text-[10px] font-semibold border border-teal-500/20"
                            >
                              {cite}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}

              {/* Loading indicator */}
              {isLoading && (
                <div className="flex justify-start animate-fade-in">
                  <div className="glass border border-white/[0.06] rounded-2xl px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-2 h-2 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-2 h-2 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                      <span className="text-xs text-[var(--text-muted)] font-medium">Thinking...</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Error message */}
              {error && (
                <div className="flex justify-center animate-fade-in">
                  <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 font-medium">
                    {error}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input Area */}
          <div className="shrink-0 px-4 md:px-6 py-4 border-t border-white/[0.06] bg-[var(--surface-900)]/50 backdrop-blur-xl">
            <div className="max-w-2xl mx-auto flex items-end gap-3">
              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={completedCount > 0 ? "Ask about your sessions..." : "Record some sessions first..."}
                  disabled={completedCount === 0}
                  rows={1}
                  className="w-full px-4 py-3 rounded-xl glass border border-white/[0.08] focus:border-teal-500/50 focus:bg-white/[0.04] text-sm text-[var(--text-primary)] placeholder-[var(--text-primary)]/20 resize-none transition-all focus:outline-none disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ maxHeight: '120px' }}
                  onInput={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    target.style.height = 'auto';
                    target.style.height = Math.min(target.scrollHeight, 120) + 'px';
                  }}
                />
              </div>
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isLoading || completedCount === 0}
                className="shrink-0 w-11 h-11 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 text-white flex items-center justify-center shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 transition-all disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
                </svg>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ChatView;
