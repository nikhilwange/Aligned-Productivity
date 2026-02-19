
import React, { useState } from 'react';
import { RecordingSession, User } from '../types';

interface SidebarProps {
  user: User | null;
  recordings: RecordingSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onStartLive: () => void;
  isLiveActive: boolean;
  onDelete: (id: string) => void;
  onLogout: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onClose?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ user, recordings, activeId, onSelect, onNew, onStartLive, isLiveActive, onDelete, onLogout, theme, onToggleTheme, onClose }) => {
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{
    session: RecordingSession;
    snippet: string;
    matchedIn: 'title' | 'summary' | 'transcript';
  }>>([]);
  const [isSearchActive, setIsSearchActive] = useState(false);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getUserInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  };

  const handleShare = async (e: React.MouseEvent, rec: RecordingSession) => {
    e.preventDefault();
    e.stopPropagation();

    const shareText = `Aligned insight brief: ${rec.title}\nDate: ${new Date(rec.date).toLocaleDateString()}\n\n${rec.analysis?.summary || 'Session recorded.'}`;
    const currentUrl = window.location.href;
    const isValidUrl = currentUrl.startsWith('http');

    try {
      if (navigator.share) {
        await navigator.share({
          title: rec.title,
          text: shareText,
          ...(isValidUrl ? { url: currentUrl } : {})
        });
      } else {
        throw new Error('Web Share API not supported');
      }
    } catch (err) {
      console.warn("Share failed, falling back to clipboard:", err);
      await navigator.clipboard.writeText(`${shareText}${isValidUrl ? `\n\nLink: ${currentUrl}` : ''}`);
      setSharingId(rec.id);
      setTimeout(() => setSharingId(null), 2000);
    }
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDeletingId(id);
    onDelete(id);
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);

    if (!query.trim()) {
      setSearchResults([]);
      setIsSearchActive(false);
      return;
    }

    setIsSearchActive(true);
    const lowerQuery = query.toLowerCase();
    const results: Array<{
      session: RecordingSession;
      snippet: string;
      matchedIn: 'title' | 'summary' | 'transcript';
    }> = [];

    recordings.forEach(rec => {
      // Search in title
      if (rec.title.toLowerCase().includes(lowerQuery)) {
        results.push({
          session: rec,
          snippet: rec.title,
          matchedIn: 'title'
        });
        return;
      }

      // Search in summary
      if (rec.analysis?.summary && rec.analysis.summary.toLowerCase().includes(lowerQuery)) {
        const index = rec.analysis.summary.toLowerCase().indexOf(lowerQuery);
        const start = Math.max(0, index - 50);
        const end = Math.min(rec.analysis.summary.length, index + query.length + 50);
        const snippet = (start > 0 ? '...' : '') +
          rec.analysis.summary.substring(start, end) +
          (end < rec.analysis.summary.length ? '...' : '');
        results.push({
          session: rec,
          snippet,
          matchedIn: 'summary'
        });
        return;
      }

      // Search in transcript
      if (rec.analysis?.transcript && rec.analysis.transcript.toLowerCase().includes(lowerQuery)) {
        const index = rec.analysis.transcript.toLowerCase().indexOf(lowerQuery);
        const start = Math.max(0, index - 50);
        const end = Math.min(rec.analysis.transcript.length, index + query.length + 50);
        const snippet = (start > 0 ? '...' : '') +
          rec.analysis.transcript.substring(start, end) +
          (end < rec.analysis.transcript.length ? '...' : '');
        results.push({
          session: rec,
          snippet,
          matchedIn: 'transcript'
        });
      }
    });

    setSearchResults(results);
  };

  const highlightMatch = (text: string, query: string): JSX.Element => {
    if (!query.trim()) return <>{text}</>;

    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase() ? (
            <mark key={i} className="bg-yellow-400/30 text-yellow-200 px-0.5 rounded">
              {part}
            </mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </>
    );
  };

  return (
    <div className="flex flex-col h-full w-full bg-[var(--surface-900)] border-r border-white/[0.06] text-[var(--text-primary)]">
      {/* Brand Header */}
      <div className="pt-8 px-5 mb-6">
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-3.5">
            {/* Logo with glow */}
            <div className="relative group">
              <div className="absolute -inset-2 bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl blur-lg opacity-20 group-hover:opacity-40 transition-opacity duration-500"></div>
              <div className="relative w-11 h-11 bg-gradient-to-br from-amber-500 via-orange-500 to-yellow-600 rounded-xl shadow-lg flex items-center justify-center text-white font-bold text-xl transform group-hover:scale-105 transition-transform duration-300">
                A
              </div>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-none text-[var(--text-primary)]">Aligned</h1>
              <span className="text-[10px] font-semibold opacity-30 tracking-wider uppercase mt-1 block text-[var(--text-primary)]">Workspace Intelligence</span>
            </div>
          </div>

          {/* Right side controls */}
          <div className="flex items-center gap-2">
          {/* Mobile close button */}
          {onClose && (
            <button
              onClick={onClose}
              className="md:hidden w-10 h-10 rounded-xl glass glass-hover flex items-center justify-center opacity-60 hover:opacity-100 transition-all duration-300"
              title="Close menu"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          {/* Theme Toggle Switch */}
          <button
            onClick={onToggleTheme}
            className="w-10 h-10 rounded-xl glass glass-hover flex items-center justify-center opacity-40 hover:opacity-100 transition-all duration-300"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 9h-1m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <button
            onClick={onNew}
            className="w-full py-3.5 px-4 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white rounded-xl font-semibold shadow-lg shadow-purple-500/20 transition-all duration-300 flex items-center justify-center gap-2.5 text-sm active:scale-[0.98] group"
          >
            <div className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 group-hover:rotate-90 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            New Session
          </button>

          {/* Compact tab row for Dictation / Dictations / Sessions */}
          <div className="flex gap-1.5 p-1 glass rounded-xl">
            <button
              onClick={onStartLive}
              className={`flex-1 py-2.5 px-2 rounded-lg font-semibold transition-all duration-300 flex items-center justify-center gap-1.5 text-xs relative overflow-hidden ${isLiveActive
                ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md shadow-teal-500/25'
                : 'hover:bg-white/[0.06] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
            >
              {isLiveActive && (
                <div className="absolute inset-0 bg-gradient-to-r from-teal-400/20 to-transparent animate-shimmer"></div>
              )}
              <div className={`relative w-1.5 h-1.5 rounded-full shrink-0 ${isLiveActive ? 'bg-white animate-pulse' : 'bg-teal-400'}`}></div>
              <span className="relative truncate">Dictate</span>
            </button>

            <button
              onClick={() => onSelect('dictations')}
              className={`flex-1 py-2.5 px-2 rounded-lg font-semibold transition-all duration-300 flex items-center justify-center gap-1.5 text-xs ${activeId === 'dictations' && !isLiveActive
                ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-md shadow-amber-500/25'
                : 'hover:bg-white/[0.06] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
            >
              <span className="truncate">Dictations</span>
            </button>

            <button
              onClick={() => onSelect('sessions')}
              className={`flex-1 py-2.5 px-2 rounded-lg font-semibold transition-all duration-300 flex items-center justify-center gap-1.5 text-xs ${activeId === 'sessions' && !isLiveActive
                ? 'bg-gradient-to-r from-teal-500 to-cyan-600 text-white shadow-md shadow-teal-500/25'
                : 'hover:bg-white/[0.06] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
            >
              <span className="truncate">Sessions</span>
            </button>
          </div>

          <button
            onClick={() => onSelect('strategist')}
            className={`w-full py-3.5 px-4 rounded-xl font-semibold transition-all duration-300 flex items-center justify-center gap-2.5 text-sm relative overflow-hidden group ${activeId === 'strategist' && !isLiveActive
              ? 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow-lg shadow-purple-500/25'
              : 'glass glass-hover text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span>Strategist</span>
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="px-5 mb-4">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search recordings..."
            className="w-full py-2.5 px-4 pl-10 bg-white/5 border border-white/10 rounded-xl text-sm text-[var(--text-primary)] placeholder-[var(--text-primary)]/30 focus:outline-none focus:border-purple-500/50 focus:bg-white/[0.07] transition-all"
          />
          <svg
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-30"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => handleSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 opacity-30 hover:opacity-100 transition-opacity"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* History List */}
      <div className="flex-1 overflow-y-auto px-3 pb-6 scrollbar-hide">
        {isSearchActive ? (
          /* Search Results */
          <>
            <div className="px-2 pb-3 pt-4 sticky top-0 bg-[var(--surface-900)]/80 backdrop-blur-md z-10">
              <h3 className="text-[10px] font-bold opacity-30 uppercase tracking-[0.15em] text-[var(--text-primary)]">
                Search Results ({searchResults.length})
              </h3>
            </div>

            {searchResults.length === 0 ? (
              <div className="text-center py-16 px-6">
                <div className="w-16 h-16 glass rounded-2xl flex items-center justify-center mx-auto mb-5">
                  <svg className="w-7 h-7 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <p className="opacity-30 text-sm font-medium">No results found for "{searchQuery}"</p>
              </div>
            ) : (
              searchResults.map((result, index) => (
                <div
                  key={result.session.id}
                  className="relative group/item px-1 mb-2 transition-all duration-300 animate-fade-in"
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <div
                    className="w-full p-4 rounded-xl border border-white/10 hover:bg-white/[0.03] hover:border-purple-500/30 transition-all cursor-pointer bg-white/[0.02]"
                    onClick={() => {
                      onSelect(result.session.id);
                      setSearchQuery('');
                      setIsSearchActive(false);
                    }}
                  >
                    <div className="mb-2">
                      <span className="font-semibold text-sm leading-tight text-[var(--text-primary)]">
                        {highlightMatch(result.session.title, searchQuery)}
                      </span>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] opacity-40 text-[var(--text-primary)]">
                          {new Date(result.session.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          result.matchedIn === 'title' ? 'bg-purple-500/20 text-purple-300' :
                          result.matchedIn === 'summary' ? 'bg-teal-500/20 text-teal-300' :
                          'bg-amber-500/20 text-amber-300'
                        }`}>
                          {result.matchedIn}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs leading-relaxed opacity-60 text-[var(--text-primary)] line-clamp-2">
                      {highlightMatch(result.snippet, searchQuery)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </>
        ) : (
          /* Normal Recordings List */
          <>
            <div className="px-2 pb-3 pt-4 sticky top-0 bg-[var(--surface-900)]/80 backdrop-blur-md z-10">
              <h3 className="text-[10px] font-bold opacity-30 uppercase tracking-[0.15em] text-[var(--text-primary)]">Recent Meetings</h3>
            </div>

            {recordings.filter(r => r.source !== 'dictation').length === 0 && (
              <div className="text-center py-16 px-6">
                <div className="w-16 h-16 glass rounded-2xl flex items-center justify-center mx-auto mb-5">
                  <svg className="w-7 h-7 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="opacity-30 text-sm font-medium">Ready for your first session</p>
                <p className="opacity-15 text-xs mt-1">Start recording to begin</p>
              </div>
            )}

            {recordings.filter(r => r.source !== 'dictation').map((rec, index) => (
              <div
                key={rec.id}
                className={`relative group/item px-1 transition-all duration-300 ${deletingId === rec.id ? 'opacity-50 pointer-events-none scale-95' : 'opacity-100'}`}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div
                  className={`w-full p-4 rounded-xl border transition-all duration-300 cursor-pointer mb-1 ${activeId === rec.id && !isLiveActive
                    ? 'bg-gradient-to-r from-purple-500/10 to-purple-600/5 border-purple-500/30 shadow-lg shadow-purple-500/5'
                    : 'bg-transparent border-transparent hover:bg-white/[0.03] hover:border-white/[0.06]'
                    }`}
                  onClick={() => onSelect(rec.id)}
                >
                  <div className="flex justify-between items-start mb-2.5">
                    <span className={`font-semibold text-sm leading-tight pr-2 ${activeId === rec.id && !isLiveActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                      {rec.title}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {rec.status === 'processing' && (
                        <div className="flex gap-1">
                          <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                          <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                          <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-[10px] font-semibold opacity-40 text-[var(--text-primary)]">
                    <div className="flex items-center gap-2">
                      <span>{new Date(rec.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                      <span className="w-1 h-1 bg-current opacity-20 rounded-full"></span>
                      <span className="font-mono text-[9px] opacity-70">{formatTime(rec.duration)}</span>
                    </div>

                    <div className={`px-2 py-0.5 rounded-md text-[9px] font-bold tracking-tight ${
                      rec.source === 'virtual-meeting'
                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/20'
                        : rec.source === 'phone-call'
                          ? 'bg-teal-500/20 text-teal-300 border border-teal-500/20'
                          : rec.source === 'dictation'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/20'
                            : 'bg-white/5 opacity-40 border border-white/10'
                      }`}>
                      {rec.source === 'virtual-meeting' ? 'Meeting' : rec.source === 'phone-call' ? 'Call' : rec.source === 'dictation' ? 'Dictation' : 'In person'}
                    </div>
                  </div>
                </div>

                {/* Action buttons - always visible on mobile, hover-only on desktop */}
                <div className="absolute top-3 right-3 flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover/item:opacity-100 transition-all duration-200 z-30">
                  <button
                    onClick={(e) => handleShare(e, rec)}
                    className={`p-1.5 rounded-lg transition-all ${sharingId === rec.id
                      ? 'text-teal-400 bg-teal-500/20'
                      : 'opacity-30 hover:opacity-70 hover:bg-white/10'
                      }`}
                    title="Share"
                  >
                    {sharingId === rec.id ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, rec.id)}
                    className="p-1.5 rounded-lg opacity-30 hover:text-red-400 hover:bg-red-500/10 hover:opacity-100 transition-all"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* User Footer */}
      {user && (
        <div className="mt-auto px-4 pb-4 pt-2 border-t border-white/[0.04]">
          <div className="p-3 glass rounded-xl flex items-center justify-between group">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 text-white flex items-center justify-center font-bold text-xs shadow-lg shadow-purple-500/20">
                {getUserInitials(user.name)}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold leading-tight truncate max-w-[150px] text-[var(--text-primary)]">{user.name}</span>
                <span className="text-[10px] opacity-40 font-medium truncate max-w-[150px] text-[var(--text-primary)]">{user.email}</span>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="p-2 opacity-30 hover:text-red-400 hover:bg-red-500/10 hover:opacity-100 rounded-lg transition-all"
              title="Logout"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Sidebar;
