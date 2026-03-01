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
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              mode === 'strategist'
                ? 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow-md shadow-purple-500/25'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            💡 Strategist
          </button>
          <button
            onClick={() => setMode('chat')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              mode === 'chat'
                ? 'bg-gradient-to-r from-teal-500 to-cyan-600 text-white shadow-md shadow-teal-500/25'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            💬 Ask Aligned
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
