import React from 'react';
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

const Sidebar: React.FC<SidebarProps> = ({ activeId, onNew, onStartLive, isLiveActive, onLogout }) => {
  return (
    <div className="h-full w-full bg-[#1C1C1C] rounded-[3rem] py-12 flex flex-col items-center justify-between shadow-2xl shadow-black/30 animate-fade">
      <div className="flex flex-col items-center gap-14 w-full">
        {/* Brand Identity */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-11 h-11 bg-[#7FA9F5] rounded-2xl flex items-center justify-center shadow-lg shadow-[#7FA9F5]/20 hover:scale-105 transition-transform cursor-pointer">
            <span className="text-white font-black text-2xl tracking-tighter">V</span>
          </div>
        </div>

        {/* Global Nav Icons */}
        <nav className="flex flex-col items-center gap-10 w-full">
          <button 
            onClick={() => window.location.reload()}
            className="group relative"
            title="Dashboard"
          >
            <div className={`absolute -left-6 top-1/2 -translate-y-1/2 w-1.5 h-8 bg-[#7FA9F5] rounded-r-full transition-opacity ${!activeId && !isLiveActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}></div>
            <svg className={`w-6 h-6 transition-colors ${!activeId && !isLiveActive ? 'text-white' : 'text-slate-500 group-hover:text-white'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
          
          <button 
            onClick={onNew}
            className="group relative"
            title="New Recording"
          >
            <div className="absolute -left-6 top-1/2 -translate-y-1/2 w-1.5 h-8 bg-[#7FA9F5] rounded-r-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <svg className="w-6 h-6 text-slate-500 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
          </button>

          <button 
            onClick={onStartLive}
            className={`group relative ${isLiveActive ? 'text-[#7FA9F5]' : 'text-slate-500'}`}
            title="Live Mode"
          >
            <div className={`absolute -left-6 top-1/2 -translate-y-1/2 w-1.5 h-8 bg-[#7FA9F5] rounded-r-full transition-opacity ${isLiveActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}></div>
            <svg className={`w-6 h-6 group-hover:text-white transition-colors ${isLiveActive ? 'text-[#7FA9F5]' : 'text-slate-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </button>

          <button 
            className="group relative"
            title="Settings"
          >
            <div className="absolute -left-6 top-1/2 -translate-y-1/2 w-1.5 h-8 bg-[#7FA9F5] rounded-r-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <svg className="w-6 h-6 text-slate-500 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            </svg>
          </button>
        </nav>
      </div>

      {/* Exit/Logout Action */}
      <button 
        onClick={onLogout}
        className="w-12 h-12 rounded-2xl flex items-center justify-center text-slate-600 hover:text-rose-500 hover:bg-rose-500/10 transition-all"
        title="Exit Application"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      </button>
    </div>
  );
};

export default Sidebar;