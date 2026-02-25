import React, { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { v4 as uuidv4 } from 'uuid';
import { RecordingSession, ChatMessage } from '../types';
import { buildSessionChatContext, sendChatMessage } from '../services/chatService';
import { pinInsight, unpinInsight, isPinned } from '../services/pinService';

interface SessionChatPanelProps {
  session: RecordingSession;
}

const SESSION_SUGGESTIONS = [
  "What were the key decisions made?",
  "List all action items from this session.",
  "What are the main risks or blockers discussed?",
  "Give me a quick 3-bullet summary.",
];

const SessionChatPanel: React.FC<SessionChatPanelProps> = ({ session }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pinVersion, setPinVersion] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const context = useMemo(
    () => buildSessionChatContext(session),
    [session.id, session.analysis]
  );

  // Reset chat when session changes
  useEffect(() => {
    setMessages([]);
    setInput('');
    setError(null);
  }, [session.id]);

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
      const { text: responseText, citations } = await sendChatMessage(
        messageText,
        messages,
        context,
        'this session only'
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
      const msgIndex = messages.findIndex(m => m.id === msg.id);
      const question = msgIndex > 0 ? messages[msgIndex - 1].content : '';
      pinInsight({
        id: msg.id,
        question,
        answer: msg.content,
        citations: msg.citations,
        scope: session.title,
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
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 scrollbar-hide">
        <div className="max-w-2xl mx-auto space-y-5">
          {messages.length === 0 && !isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-center animate-fade-in">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-teal-500/20 to-cyan-500/20 flex items-center justify-center border border-white/[0.08] mb-5">
                <svg className="w-7 h-7 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-[var(--text-primary)] mb-1">Chat about this session</h3>
              <p className="text-xs text-[var(--text-muted)] mb-6 max-w-sm">
                Ask questions about "{session.title}" — I have the full transcript, summary, and action items.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
                {SESSION_SUGGESTIONS.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleSend(q)}
                    className="text-left p-3 rounded-xl glass glass-hover border border-white/[0.06] hover:border-teal-500/30 transition-all group"
                  >
                    <p className="text-[11px] font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] leading-relaxed transition-colors">
                      {q}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
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
                    <div className="flex items-center gap-1 mt-2 pt-2 border-t border-white/[0.06]">
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
                              className="px-2 py-0.5 rounded-md bg-teal-500/15 text-teal-300 text-[10px] font-semibold border border-teal-500/20"
                            >
                              {cite}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Citation chips for user messages */}
                  {msg.role === 'user' && msg.citations && msg.citations.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-white/[0.06]">
                      {msg.citations.map((cite, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded-md bg-teal-500/15 text-teal-300 text-[10px] font-semibold border border-teal-500/20"
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

          {isLoading && (
            <div className="flex justify-start animate-fade-in">
              <div className="glass border border-white/[0.06] rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  </div>
                  <span className="text-[11px] text-[var(--text-muted)] font-medium">Thinking...</span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="flex justify-center animate-fade-in">
              <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-medium">
                {error}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 px-4 py-3 border-t border-white/[0.06] bg-[var(--surface-900)]/30">
        <div className="max-w-2xl mx-auto flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this session..."
            rows={1}
            className="flex-1 px-4 py-2.5 rounded-xl glass border border-white/[0.08] focus:border-teal-500/50 text-sm text-[var(--text-primary)] placeholder-[var(--text-primary)]/20 resize-none transition-all focus:outline-none"
            style={{ maxHeight: '100px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 100) + 'px';
            }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            className="shrink-0 w-10 h-10 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 text-white flex items-center justify-center shadow-lg shadow-teal-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionChatPanel;
