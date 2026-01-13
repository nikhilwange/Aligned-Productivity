
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
}

const Sidebar: React.FC<SidebarProps> = ({ user, recordings, activeId, onSelect, onNew, onStartLive, isLiveActive, onDelete, onLogout }) => {
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col h-full w-full bg-[#f8fafc]/40 backdrop-blur-3xl border-r border-slate-200/60 p-4">
      {/* Brand Header */}
      <div className="pt-6 px-2 mb-8">
        <div className="flex items-center gap-3.5 mb-10">
          <div className="relative group">
            <div className="absolute -inset-1.5 bg-gradient-to-br from-amber-500 to-yellow-400 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-500"></div>
            <div className="relative w-11 h-11 bg-gradient-to-br from-amber-600 to-yellow-500 rounded-2xl shadow-lg flex items-center justify-center text-white font-bold text-2xl transform transition-transform group-hover:scale-105">
              A
            </div>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800 leading-none">Aligned</h1>
            <span className="text-[10px] font-bold text-amber-600 opacity-80 mt-1 block">Workspace Alignment</span>
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={onNew}
            className="w-full py-4 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-[1.25rem] font-bold shadow-xl shadow-slate-200 transition-all flex items-center justify-center gap-2.5 text-sm active:scale-[0.98] group"
          >
            <div className="w-5 h-5 bg-white/10 rounded-lg flex items-center justify-center">
              <svg className="w-3.5 h-3.5 group-hover:rotate-90 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            New session
          </button>

          <button
            onClick={onStartLive}
            className={`w-full py-4 px-4 rounded-[1.25rem] font-bold transition-all flex items-center justify-center gap-2.5 text-sm relative overflow-hidden group border ${
              isLiveActive 
                ? 'bg-amber-600 text-white border-amber-500 shadow-lg shadow-amber-200/50' 
                : 'bg-white text-slate-700 border-slate-200/80 hover:border-amber-300 hover:text-amber-700 hover:shadow-md'
            }`}
          >
            <svg className={`w-5 h-5 transition-colors ${isLiveActive ? 'text-white' : 'text-amber-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            Live assistant
          </button>
        </div>
      </div>
      
      {/* History List */}
      <div className="flex-1 overflow-y-auto px-2 pb-6 space-y-1 scrollbar-hide">
        <div className="px-3 pb-3 pt-4 sticky top-0 bg-[#f8fafc]/40 backdrop-blur-md z-10">
          <h3 className="text-[10px] font-bold text-slate-400 tracking-[0.05em]">Recent sessions</h3>
        </div>
        
        {recordings.length === 0 && (
          <div className="text-center py-16 px-6">
            <div className="w-16 h-16 bg-white border border-slate-100 rounded-full flex items-center justify-center mx-auto mb-5 shadow-sm">
              <svg className="w-7 h-7 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <p className="text-slate-400 text-xs font-semibold">Ready for your first session</p>
          </div>
        )}
        
        {recordings.map((rec) => (
          <div key={rec.id} className={`relative group/item px-1 transition-opacity duration-300 ${deletingId === rec.id ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
            <div
              className={`w-full p-4 rounded-2xl border transition-all duration-300 relative cursor-pointer ${
                activeId === rec.id && !isLiveActive
                  ? 'bg-white border-amber-100 shadow-lg shadow-amber-500/5 ring-1 ring-amber-500/10'
                  : 'bg-transparent border-transparent hover:bg-white/60 hover:border-slate-200/50'
              }`}
              onClick={() => onSelect(rec.id)}
            >
              <div className="flex justify-between items-start mb-2.5">
                <span className={`font-bold text-sm truncate max-w-[120px] tracking-tight ${activeId === rec.id && !isLiveActive ? 'text-slate-900' : 'text-slate-600'}`}>
                  {rec.title}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                   {rec.status === 'processing' && (
                    <div className="flex gap-0.5">
                      <span className="w-1 h-1 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                      <span className="w-1 h-1 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                      <span className="w-1 h-1 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-between items-center text-[10px] font-bold text-slate-400">
                <div className="flex items-center gap-2">
                  <span>{new Date(rec.date).toLocaleDateString(undefined, {month:'short', day:'numeric'})}</span>
                  <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                  <span className="font-mono text-[9px]">{formatTime(rec.duration)}</span>
                </div>
                
                <div className={`px-2 py-0.5 rounded-md text-[9px] font-extrabold tracking-tight ${
                  rec.source === 'virtual-meeting' ? 'bg-indigo-50 text-indigo-500 border border-indigo-100/50' :
                  rec.source === 'phone-call' ? 'bg-blue-50 text-blue-500 border border-blue-100/50' : 'bg-slate-100 text-slate-500 border border-slate-200/50'
                }`}>
                  {rec.source === 'virtual-meeting' ? 'Meeting' : rec.source === 'phone-call' ? 'Call' : 'In person'}
                </div>
              </div>
            </div>
            
            <div className="absolute top-4 right-3 flex items-center gap-1 opacity-100 md:opacity-0 group-hover/item:opacity-100 transition-all duration-200 z-30">
              <button
                onClick={(e) => handleShare(e, rec)}
                className={`p-1.5 rounded-xl transition-all ${
                  sharingId === rec.id 
                    ? 'text-amber-600 bg-amber-50' 
                    : 'text-slate-300 hover:text-amber-500 hover:bg-amber-50'
                }`}
                title="Share"
              >
                {sharingId === rec.id ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                )}
              </button>
              <button
                onClick={(e) => handleDelete(e, rec.id)}
                className="p-1.5 rounded-xl text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-all"
                title="Delete"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* User Footer */}
      {user && (
        <div className="mt-auto px-2 pb-2">
          <div className="p-3 bg-white/60 border border-slate-200/50 rounded-2xl flex items-center justify-between group">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-400 text-white flex items-center justify-center font-bold text-xs shadow-md shadow-amber-500/10 border border-white/20">
                {getUserInitials(user.name)}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold text-slate-800 leading-tight truncate max-w-[100px]">{user.name}</span>
                <span className="text-[10px] text-slate-400 font-bold truncate max-w-[100px] tracking-tight">{user.email}</span>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
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
