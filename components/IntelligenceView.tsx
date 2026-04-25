import React, { useState } from 'react';
import { RecordingSession, ChatMessage } from '../types';
import StrategistView from './StrategistView';
import ChatView from './ChatView';

interface IntelligenceViewProps {
  recordings: RecordingSession[];
  userId: string;
  messages: ChatMessage[];
  onMessagesChange: (messages: ChatMessage[]) => void;
}

const IntelligenceView: React.FC<IntelligenceViewProps> = ({
  recordings, userId, messages, onMessagesChange
}) => {
  const [mode, setMode] = useState<'strategist' | 'chat'>('strategist');

  return (
    <div className="h-full flex flex-col">
      {/* Mode toggle */}
      <div className="shrink-0 bg-[var(--surface-900)]/80 backdrop-blur-xl border-b border-white/[0.06] px-6 md:px-8 h-14 flex items-center gap-4">
        <div className="flex items-center gap-2 p-1 glass rounded-xl">
          <button
            onClick={() => setMode('strategist')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all inline-flex items-center gap-1.5 ${
              mode === 'strategist'
                ? 'bg-purple-500 text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12c1 1 2 2 2 4h4c0-2 1-3 2-4a7 7 0 00-4-12z" />
            </svg>
            Strategist
          </button>
          <button
            onClick={() => setMode('chat')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all inline-flex items-center gap-1.5 ${
              mode === 'chat'
                ? 'bg-teal-500 text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            Ask Aligned
          </button>
        </div>
        <p className="text-xs text-[var(--text-muted)] hidden sm:block">
          {mode === 'strategist'
            ? 'AI-generated insights across all your sessions'
            : 'Ask questions across your entire meeting history'}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {mode === 'strategist' ? (
          <StrategistView recordings={recordings} userId={userId} />
        ) : (
          <ChatView recordings={recordings} messages={messages} onMessagesChange={onMessagesChange} />
        )}
      </div>
    </div>
  );
};

export default IntelligenceView;
