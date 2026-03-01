import React, { useState, useMemo } from 'react';
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

const STORAGE_KEY = 'aligned-action-items-done';
const loadDoneIds = (): Set<string> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
};

const Sidebar: React.FC<SidebarProps> = ({
  user, recordings, activeId, onSelect, onNew, onStartLive,
  isLiveActive, onDelete, onLogout, theme, onToggleTheme, onClose
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const getUserInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);

  // Pending action items count for badge
  const pendingActionsCount = useMemo(() => {
    const doneIds = loadDoneIds();
    let count = 0;
    recordings
      .filter(r => r.status === 'completed')
      .forEach(rec => {
        (rec.analysis?.actionPoints ?? []).forEach((_, i) => {
          if (!doneIds.has(`${rec.id}-${i}`)) count++;
        });
      });
    return count;
  }, [recordings]);

  // Unified sessions list (both meeting recordings and dictations)
  const recentSessions = useMemo(() =>
    recordings
      .filter(r => r.status === 'completed')
      .sort((a, b) => b.date - a.date)
      .slice(0, 8),
    [recordings]
  );

  // Search
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return recentSessions;
    const q = searchQuery.toLowerCase();
    return recordings
      .filter(r => r.status === 'completed')
      .filter(r =>
        r.title.toLowerCase().includes(q) ||
        r.analysis?.summary?.toLowerCase().includes(q) ||
        r.analysis?.transcript?.toLowerCase().includes(q)
      )
      .sort((a, b) => b.date - a.date)
      .slice(0, 20);
  }, [recordings, searchQuery, recentSessions]);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDeletingId(id);
    onDelete(id);
  };

  const getSourceDot = (source: string) => {
    if (source === 'virtual-meeting') return 'bg-purple-400';
    if (source === 'phone-call') return 'bg-teal-400';
    if (source === 'dictation') return 'bg-amber-400';
    return 'bg-white/30';
  };

  // Primary nav items
  const navItems = [
    { id: 'home',         label: 'Home',         icon: HomeIcon,          activeColor: 'text-amber-400',  activeBg: 'bg-amber-500/10' },
    { id: 'sessions',     label: 'Sessions',      icon: SessionsIcon,      activeColor: 'text-teal-400',   activeBg: 'bg-teal-500/10' },
    { id: 'actions',      label: 'Action Items',  icon: ActionsIcon,       activeColor: 'text-amber-400',  activeBg: 'bg-amber-500/10', badge: pendingActionsCount },
    { id: 'intelligence', label: 'Intelligence',  icon: IntelligenceIcon,  activeColor: 'text-purple-400', activeBg: 'bg-purple-500/10' },
  ];

  return (
    <div className="flex flex-col h-full w-full bg-[var(--surface-900)] border-r border-white/[0.06] text-[var(--text-primary)]">

      {/* Header */}
      <div className="px-5 pt-7 pb-5 shrink-0">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 bg-gradient-to-br from-amber-500 via-orange-500 to-yellow-600 rounded-xl shadow-lg flex items-center justify-center text-white font-bold text-lg">
                A
              </div>
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight leading-none text-[var(--text-primary)]">Aligned</h1>
              <span className="text-[9px] font-semibold opacity-30 tracking-wider uppercase mt-0.5 block">Workspace Intelligence</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {onClose && (
              <button onClick={onClose} className="md:hidden w-8 h-8 rounded-lg glass glass-hover flex items-center justify-center opacity-60 hover:opacity-100 transition-all">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            <button onClick={onToggleTheme} className="w-8 h-8 rounded-lg glass glass-hover flex items-center justify-center opacity-40 hover:opacity-100 transition-all" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
              {theme === 'dark' ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 9h-1m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
              )}
            </button>
          </div>
        </div>

        {/* New Session button */}
        <button
          onClick={onNew}
          className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white rounded-xl font-semibold shadow-lg shadow-purple-500/20 transition-all flex items-center justify-center gap-2 text-sm active:scale-[0.98] mb-5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          New Session
        </button>

        {/* Primary nav */}
        <nav className="space-y-0.5">
          {navItems.map(item => {
            const isActive = (activeId === item.id || (item.id === 'intelligence' && (activeId === 'strategist' || activeId === 'chatbot'))) && !isLiveActive;
            return (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  isActive
                    ? `${item.activeBg} ${item.activeColor}`
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/[0.04]'
                }`}
              >
                <item.icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}

          {/* Manual Entry — secondary action */}
          <button
            onClick={() => onSelect('manual-entry')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              activeId === 'manual-entry' && !isLiveActive
                ? 'bg-amber-500/10 text-amber-400'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/[0.04]'
            }`}
          >
            <PencilIcon className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1 text-left">Manual Entry</span>
          </button>

          {/* Dictate — secondary action */}
          <button
            onClick={onStartLive}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              isLiveActive
                ? 'bg-teal-500/10 text-teal-400'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/[0.04]'
            }`}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            <span className="flex-1 text-left">Dictate</span>
            {isLiveActive && <div className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-pulse" />}
          </button>
        </nav>
      </div>

      {/* Divider */}
      <div className="mx-5 h-px bg-white/[0.05] shrink-0" />

      {/* Search */}
      <div className="px-4 py-3 shrink-0">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search sessions..."
            className="w-full py-2 px-4 pl-9 bg-white/[0.04] border border-white/[0.07] rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-purple-500/40 transition-all"
          />
          <svg className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-100 transition-opacity">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto px-3 pb-4 scrollbar-hide">
        <div className="px-2 pb-2 pt-1">
          <span className="text-[9px] font-bold opacity-25 uppercase tracking-[.15em]">
            {searchQuery ? `Results (${filteredSessions.length})` : 'Recent'}
          </span>
        </div>

        {filteredSessions.length === 0 ? (
          <div className="text-center py-8 px-4">
            <p className="text-xs opacity-30">No results for "{searchQuery}"</p>
          </div>
        ) : (
          filteredSessions.map(rec => (
            <div
              key={rec.id}
              className={`relative group/item px-1 mb-0.5 ${deletingId === rec.id ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <div
                onClick={() => onSelect(rec.id)}
                className={`w-full px-3 py-2.5 rounded-xl border transition-all cursor-pointer ${
                  activeId === rec.id && !isLiveActive
                    ? 'bg-purple-500/8 border-purple-500/20'
                    : 'bg-transparent border-transparent hover:bg-white/[0.03] hover:border-white/[0.05]'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${getSourceDot(rec.source)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-[var(--text-secondary)] truncate leading-tight mb-0.5">
                      {rec.title}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] flex gap-1.5">
                      <span>{new Date(rec.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Delete on hover */}
              <button
                onClick={e => handleDelete(e, rec.id)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg opacity-0 group-hover/item:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all"
                title="Delete"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      {/* User footer */}
      {user && (
        <div className="px-4 pb-4 pt-2 border-t border-white/[0.04] shrink-0">
          <div className="p-3 glass rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 text-white flex items-center justify-center font-bold text-xs shadow-lg shadow-purple-500/20">
                {getUserInitials(user.name)}
              </div>
              <div>
                <span className="text-xs font-semibold leading-tight block truncate max-w-[130px] text-[var(--text-primary)]">{user.name}</span>
                <span className="text-[10px] opacity-40 font-medium block truncate max-w-[130px]">{user.email}</span>
              </div>
            </div>
            <button onClick={onLogout} className="p-1.5 opacity-30 hover:text-red-400 hover:bg-red-500/10 hover:opacity-100 rounded-lg transition-all" title="Logout">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Icon components
const HomeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
  </svg>
);

const SessionsIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
  </svg>
);

const ActionsIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
  </svg>
);

const IntelligenceIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
  </svg>
);

const PencilIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

export default Sidebar;
