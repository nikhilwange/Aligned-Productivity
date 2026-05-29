import React, { useState, useRef } from 'react';
import { RecordingSource } from '../types';

// Two input modes:
//  - 'transcript': user pastes raw text (existing flow, fast — analysis only).
//  - 'audio': user picks an audio file (full transcribe → analyze pipeline,
//    same as a recording, including the silent Sarvam fallback for long files).
type Mode = 'transcript' | 'audio';

type ManualEntrySubmitData = {
  title: string;
  source: RecordingSource;
  date: number;
  duration: number; // seconds
} & (
  | { transcript: string; audioBlob?: undefined }
  | { audioBlob: Blob; transcript?: undefined }
);

interface ManualEntryViewProps {
  onSubmit: (data: ManualEntrySubmitData) => void;
  onCancel: () => void;
  isProcessing: boolean;
}

const IconMonitor = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <path strokeLinecap="round" d="M8 21h8M12 17v4" />
  </svg>
);
const IconBuilding = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M6 21V5a2 2 0 012-2h8a2 2 0 012 2v16M10 7h1M13 7h1M10 11h1M13 11h1M10 15h1M13 15h1" />
  </svg>
);
const IconPhone = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <rect x="6" y="2" width="12" height="20" rx="2" />
    <path strokeLinecap="round" d="M11 18h2" />
  </svg>
);

const SOURCE_OPTIONS: { value: RecordingSource; label: string; icon: React.ReactNode; desc: string }[] = [
  { value: 'virtual-meeting', label: 'Virtual Meeting', icon: IconMonitor,  desc: 'Zoom, Teams, Meet' },
  { value: 'in-person',       label: 'In-Person',       icon: IconBuilding, desc: 'Room meeting' },
  { value: 'phone-call',      label: 'Phone / Call',    icon: IconPhone,    desc: 'Audio call' },
];

const ACCEPTED_AUDIO = 'audio/mpeg,audio/mp3,audio/mp4,audio/m4a,audio/wav,audio/webm,audio/ogg,audio/flac,audio/x-m4a,audio/x-wav,audio/aac';

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const formatDurationLabel = (totalSeconds: number): string => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.round(totalSeconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const ManualEntryView: React.FC<ManualEntryViewProps> = ({ onSubmit, onCancel, isProcessing }) => {
  const now = new Date();
  const localDatetime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16);

  const [mode, setMode]             = useState<Mode>('transcript');
  const [title, setTitle]           = useState('');
  const [transcript, setTranscript] = useState('');
  const [audioFile, setAudioFile]   = useState<File | null>(null);
  const [audioDurationS, setAudioDurationS] = useState<number | null>(null);
  const [source, setSource]         = useState<RecordingSource>('virtual-meeting');
  const [datetime, setDatetime]     = useState(localDatetime);
  const [durationH, setDurationH]   = useState('0');
  const [durationM, setDurationM]   = useState('30');
  const [error, setError]           = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
  const charCount = transcript.length;
  const isReadyTranscript = title.trim().length > 0 && transcript.trim().length > 50;
  const isReadyAudio = title.trim().length > 0 && audioFile !== null;
  const isReady = mode === 'transcript' ? isReadyTranscript : isReadyAudio;

  // Probe the picked file with a transient <audio> element to grab its real
  // duration — saves the user from having to type it. Falls back silently
  // if the browser can't decode the container.
  const probeAudioDuration = (file: File) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        const secs = Math.round(audio.duration);
        setAudioDurationS(secs);
        setDurationH(String(Math.floor(secs / 3600)));
        setDurationM(String(Math.floor((secs % 3600) / 60)));
      }
      URL.revokeObjectURL(url);
    };
    audio.onerror = () => URL.revokeObjectURL(url);
    audio.src = url;
  };

  const handleFilePick = (file: File | null) => {
    setError('');
    if (!file) { setAudioFile(null); setAudioDurationS(null); return; }
    if (!file.type.startsWith('audio/')) {
      setError(`"${file.name}" doesn't look like an audio file (MIME type: ${file.type || 'unknown'}).`);
      return;
    }
    setAudioFile(file);
    setAudioDurationS(null);
    probeAudioDuration(file);
    // If the user hasn't typed a title yet, suggest one from the filename.
    if (!title.trim()) {
      const base = file.name.replace(/\.[^.]+$/, '');
      setTitle(base);
    }
  };

  const handleSubmit = () => {
    if (!title.trim()) { setError('Please enter a meeting title.'); return; }
    setError('');
    const durationSecs = audioDurationS ?? ((parseInt(durationH) || 0) * 3600 + (parseInt(durationM) || 0) * 60);
    const dateMs = new Date(datetime).getTime() || Date.now();

    if (mode === 'transcript') {
      if (transcript.trim().length < 50) { setError('Transcript is too short — paste at least a few sentences.'); return; }
      onSubmit({
        title: title.trim(),
        transcript: transcript.trim(),
        source,
        date: dateMs,
        duration: durationSecs,
      });
    } else {
      if (!audioFile) { setError('Please pick an audio file to upload.'); return; }
      onSubmit({
        title: title.trim(),
        audioBlob: audioFile,
        source,
        date: dateMs,
        duration: durationSecs,
      });
    }
  };

  const submitLabel = isProcessing
    ? (mode === 'audio' ? 'Uploading & transcribing…' : 'Analysing transcript…')
    : (mode === 'audio' ? 'Upload & Transcribe' : 'Generate Notes & Insights');

  return (
    <div className="h-full overflow-y-auto bg-[var(--surface-950)] scrollbar-hide">

      {/* Header */}
      <div className="sticky top-0 z-40 bg-[var(--surface-900)]/80 backdrop-blur-xl border-b border-white/[0.06] px-6 md:px-10 h-16 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center text-black">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <div>
            <h1 className="font-display-tight text-lg font-semibold">Manual Entry</h1>
            <p className="text-[10px] text-[var(--text-muted)]">Paste transcript or upload audio — get full notes &amp; insights</p>
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

        {/* Mode toggle */}
        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[var(--surface-800)] border border-white/[0.07]">
          <button
            onClick={() => { setMode('transcript'); setError(''); }}
            className={`py-2.5 rounded-lg text-xs font-bold transition-all ${
              mode === 'transcript'
                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            Paste Transcript
          </button>
          <button
            onClick={() => { setMode('audio'); setError(''); }}
            className={`py-2.5 rounded-lg text-xs font-bold transition-all ${
              mode === 'audio'
                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            Upload Audio
          </button>
        </div>

        {/* How it works banner */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-purple-500/[0.07] border border-purple-500/15">
          <svg className="w-5 h-5 mt-0.5 text-purple-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12c1 1 2 2 2 4h4c0-2 1-3 2-4a7 7 0 00-4-12z" />
          </svg>
          <div>
            <div className="text-xs font-bold text-purple-300 mb-1">How this works</div>
            <div className="text-xs text-[var(--text-muted)] leading-relaxed">
              {mode === 'transcript'
                ? 'Paste your transcript from Teams, Zoom, or Google Meet. Aligned will generate structured notes, action items, and key insights — exactly like a recorded session.'
                : 'Upload an audio file (mp3, m4a, wav, webm, etc.) you already have. Aligned runs the same transcription + analysis pipeline as a fresh recording, including the automatic long-audio fallback if the file is large.'}
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
                <span className="shrink-0">{opt.icon}</span>
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
              Duration {audioDurationS !== null && (
                <span className="ml-1 text-[10px] text-amber-300 normal-case tracking-normal font-normal">
                  · auto-detected
                </span>
              )}
            </label>
            <div className="flex items-center gap-2 px-4 py-3 bg-[var(--surface-800)] border border-white/[0.08] rounded-xl">
              <input
                type="number"
                value={durationH}
                onChange={e => { setDurationH(e.target.value); setAudioDurationS(null); }}
                min="0" max="8"
                className="w-8 bg-transparent text-sm text-[var(--text-primary)] focus:outline-none text-center"
              />
              <span className="text-xs text-[var(--text-muted)]">h</span>
              <input
                type="number"
                value={durationM}
                onChange={e => { setDurationM(e.target.value); setAudioDurationS(null); }}
                min="0" max="59"
                className="w-8 bg-transparent text-sm text-[var(--text-primary)] focus:outline-none text-center"
              />
              <span className="text-xs text-[var(--text-muted)]">min</span>
            </div>
          </div>
        </div>

        {/* Transcript textarea (transcript mode only) */}
        {mode === 'transcript' && (
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
        )}

        {/* Audio upload (audio mode only) */}
        {mode === 'audio' && (
          <div>
            <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-[.1em] mb-2">
              Audio File <span className="text-red-400">*</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_AUDIO}
              className="hidden"
              onChange={e => handleFilePick(e.target.files?.[0] ?? null)}
            />
            {!audioFile ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full px-4 py-10 rounded-xl border-2 border-dashed border-white/[0.12] hover:border-amber-500/40 hover:bg-amber-500/[0.04] transition-all flex flex-col items-center gap-3 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              >
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.657-1.79 3-4 3s-4-1.343-4-3 1.79-3 4-3 4 1.343 4 3zm12-3c0 1.657-1.79 3-4 3s-4-1.343-4-3 1.79-3 4-3 4 1.343 4 3zM9 10l12-3" />
                </svg>
                <div className="text-center">
                  <div className="text-sm font-semibold">Click to choose an audio file</div>
                  <div className="text-[11px] opacity-60 mt-1">mp3 · m4a · wav · webm · ogg · flac</div>
                </div>
              </button>
            ) : (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-[var(--surface-800)] border border-amber-500/25">
                <div className="w-10 h-10 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-300 shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.657-1.79 3-4 3s-4-1.343-4-3 1.79-3 4-3 4 1.343 4 3zm12-3c0 1.657-1.79 3-4 3s-4-1.343-4-3 1.79-3 4-3 4 1.343 4 3zM9 10l12-3" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{audioFile.name}</div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    {formatBytes(audioFile.size)}
                    {audioDurationS !== null && <> · {formatDurationLabel(audioDurationS)}</>}
                    {audioFile.type && <> · {audioFile.type}</>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { handleFilePick(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                  className="text-xs font-semibold text-[var(--text-muted)] hover:text-red-300 transition-colors shrink-0"
                >
                  Remove
                </button>
              </div>
            )}
            <p className="text-[11px] text-[var(--text-muted)] mt-2">
              Large files (50 min+) automatically use the chunked Sarvam fallback if Gemini hits its time limit.
            </p>
          </div>
        )}

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
              ? 'bg-amber-500 hover:bg-amber-400 text-black shadow-lg hover:scale-[1.01] active:scale-[0.98]'
              : 'bg-white/[0.04] text-[var(--text-muted)] cursor-not-allowed'
          }`}
        >
          {isProcessing ? (
            <>
              <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              {submitLabel}
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              {submitLabel}
            </>
          )}
        </button>

        <p className="text-[11px] text-center text-[var(--text-muted)]">
          {mode === 'audio'
            ? 'Aligned will transcribe the audio, then analyse it and generate structured notes, action items, and strategic insights.'
            : 'Aligned will analyse your transcript and generate structured notes, action items, and strategic insights.'}
        </p>

      </div>
    </div>
  );
};

export default ManualEntryView;
