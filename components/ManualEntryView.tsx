import React, { useState } from 'react';
import { RecordingSource } from '../types';

interface ManualEntryViewProps {
  onSubmit: (data: {
    title: string;
    transcript: string;
    source: RecordingSource;
    date: number;
    duration: number; // seconds
  }) => void;
  onCancel: () => void;
  isProcessing: boolean;
}

const SOURCE_OPTIONS: { value: RecordingSource; label: string; icon: string; desc: string }[] = [
  { value: 'virtual-meeting', label: 'Virtual Meeting', icon: '💻', desc: 'Zoom, Teams, Meet' },
  { value: 'in-person',       label: 'In-Person',       icon: '🏢', desc: 'Room meeting' },
  { value: 'phone-call',      label: 'Phone / Call',    icon: '📱', desc: 'Audio call' },
];

const ManualEntryView: React.FC<ManualEntryViewProps> = ({ onSubmit, onCancel, isProcessing }) => {
  const now = new Date();
  const localDatetime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16);

  const [title, setTitle]           = useState('');
  const [transcript, setTranscript] = useState('');
  const [source, setSource]         = useState<RecordingSource>('virtual-meeting');
  const [datetime, setDatetime]     = useState(localDatetime);
  const [durationH, setDurationH]   = useState('0');
  const [durationM, setDurationM]   = useState('30');
  const [error, setError]           = useState('');

  const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
  const charCount = transcript.length;
  const isReady   = title.trim().length > 0 && transcript.trim().length > 50;

  const handleSubmit = () => {
    if (!title.trim()) { setError('Please enter a meeting title.'); return; }
    if (transcript.trim().length < 50) { setError('Transcript is too short — paste at least a few sentences.'); return; }
    setError('');
    const durationSecs = (parseInt(durationH) || 0) * 3600 + (parseInt(durationM) || 0) * 60;
    onSubmit({
      title:      title.trim(),
      transcript: transcript.trim(),
      source,
      date:       new Date(datetime).getTime() || Date.now(),
      duration:   durationSecs,
    });
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--surface-950)] scrollbar-hide">

      {/* Header */}
      <div className="sticky top-0 z-40 bg-[var(--surface-900)]/80 backdrop-blur-xl border-b border-white/[0.06] px-6 md:px-10 h-16 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight">Manual Entry</h1>
            <p className="text-[10px] text-[var(--text-muted)]">Paste transcript — get full notes &amp; insights</p>
          </div>
        </div>
        <button
          onClick={onCancel}
          className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors px-3 py-1.5"
        >
          Cancel
        </button>
      </div>

      <div className="px-6 md:px-10 py-8 max-w-2xl mx-auto space-y-6 pb-24 md:pb-10">

        {/* How it works banner */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-purple-500/[0.07] border border-purple-500/15">
          <div className="text-lg mt-0.5">💡</div>
          <div>
            <div className="text-xs font-bold text-purple-300 mb-1">How this works</div>
            <div className="text-xs text-[var(--text-muted)] leading-relaxed">
              Paste your transcript from Teams, Zoom, or Google Meet. Aligned will generate structured notes, action items, and key insights — exactly like a recorded session.
            </div>
          </div>
        </div>

        {/* Meeting Title */}
        <div>
          <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-[.1em] mb-2">
            Meeting Title <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Chakan Plant Review — Q1 Planning"
            className="w-full px-4 py-3 bg-[var(--surface-800)] border border-white/[0.08] rounded-xl text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-amber-500/50 transition-all"
          />
        </div>

        {/* Source type */}
        <div>
          <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-[.1em] mb-2">
            Meeting Type
          </label>
          <div className="grid grid-cols-3 gap-2">
            {SOURCE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setSource(opt.value)}
                className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border text-center transition-all ${
                  source === opt.value
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    : 'bg-[var(--surface-800)] border-white/[0.07] text-[var(--text-muted)] hover:border-white/[0.12]'
                }`}
              >
                <span className="text-xl">{opt.icon}</span>
                <span className="text-[11px] font-bold">{opt.label}</span>
                <span className="text-[10px] opacity-60">{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Date + Duration row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-[.1em] mb-2">
              Meeting Date &amp; Time
            </label>
            <input
              type="datetime-local"
              value={datetime}
              onChange={e => setDatetime(e.target.value)}
              className="w-full px-4 py-3 bg-[var(--surface-800)] border border-white/[0.08] rounded-xl text-sm text-[var(--text-primary)] focus:outline-none focus:border-amber-500/50 transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-[.1em] mb-2">
              Duration
            </label>
            <div className="flex items-center gap-2 px-4 py-3 bg-[var(--surface-800)] border border-white/[0.08] rounded-xl">
              <input
                type="number"
                value={durationH}
                onChange={e => setDurationH(e.target.value)}
                min="0" max="8"
                className="w-8 bg-transparent text-sm text-[var(--text-primary)] focus:outline-none text-center"
              />
              <span className="text-xs text-[var(--text-muted)]">h</span>
              <input
                type="number"
                value={durationM}
                onChange={e => setDurationM(e.target.value)}
                min="0" max="59"
                className="w-8 bg-transparent text-sm text-[var(--text-primary)] focus:outline-none text-center"
              />
              <span className="text-xs text-[var(--text-muted)]">min</span>
            </div>
          </div>
        </div>

        {/* Transcript textarea */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-[.1em]">
              Transcript <span className="text-red-400">*</span>
            </label>
            {transcript.length > 0 && (
              <span className="text-[10px] text-[var(--text-muted)]">
                {wordCount.toLocaleString()} words · {charCount.toLocaleString()} chars
              </span>
            )}
          </div>
          <textarea
            value={transcript}
            onChange={e => setTranscript(e.target.value)}
            placeholder={`Paste your transcript here...\n\nYou can paste directly from:\n• Microsoft Teams — More options → Open transcript → Copy all\n• Zoom — CC button → View full transcript → Copy\n• Google Meet — Transcripts in Drive → Open → Copy\n\nSpeaker labels like "John: Hello everyone" are supported.`}
            rows={16}
            className="w-full px-4 py-3 bg-[var(--surface-800)] border border-white/[0.08] rounded-xl text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-amber-500/50 transition-all resize-none leading-relaxed font-mono"
          />
          {transcript.length > 0 && transcript.trim().length < 50 && (
            <p className="text-[11px] text-amber-400 mt-1.5">Transcript is too short to generate meaningful notes.</p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!isReady || isProcessing}
          className={`w-full py-4 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-3 ${
            isReady && !isProcessing
              ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-black shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 hover:scale-[1.01] active:scale-[0.99]'
              : 'bg-white/[0.04] text-[var(--text-muted)] cursor-not-allowed'
          }`}
        >
          {isProcessing ? (
            <>
              <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              Analysing transcript...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Generate Notes &amp; Insights
            </>
          )}
        </button>

        <p className="text-[11px] text-center text-[var(--text-muted)]">
          Aligned will analyse your transcript and generate structured notes, action items, and strategic insights.
        </p>

      </div>
    </div>
  );
};

export default ManualEntryView;
