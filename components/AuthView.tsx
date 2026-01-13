import React, { useState } from 'react';
import { User } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface AuthViewProps {
  onLogin: (user: User) => void;
}

const AuthView: React.FC<AuthViewProps> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => {
      const mockUser: User = { id: uuidv4(), email: email, name: isLogin ? email.split('@')[0] : name };
      localStorage.setItem('vanilog_user', JSON.stringify(mockUser));
      onLogin(mockUser);
      setIsLoading(false);
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950 overflow-hidden font-sans">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-teal-500/20 rounded-full blur-[120px] animate-soft-pulse"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-emerald-500/20 rounded-full blur-[120px] animate-soft-pulse" style={{ animationDelay: '1.5s' }}></div>
      </div>

      <div className="relative w-full max-w-md p-8 animate-in fade-in zoom-in-95 duration-500">
        <div className="flex flex-col items-center mb-10">
          <div className="w-16 h-16 bg-gradient-to-br from-teal-500 to-emerald-400 rounded-2xl shadow-2xl flex items-center justify-center text-white font-bold text-3xl mb-4 rotate-3">V</div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">VaniLog</h1>
          <p className="text-slate-400 text-sm font-medium tracking-wide">{isLogin ? 'Welcome back to your insights' : 'Join the next generation of transcription'}</p>
        </div>

        <div className="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[32px] p-8 shadow-2xl shadow-black/40">
          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 ml-1">Full name</label>
                <input required type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50 transition-all" placeholder="John Doe" />
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 ml-1">Email address</label>
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50 transition-all" placeholder="you@example.com" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 ml-1">Password</label>
              <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50 transition-all" placeholder="••••••••" />
            </div>
            <button disabled={isLoading} type="submit" className="w-full py-4 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-white font-bold rounded-2xl shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center">
              {isLoading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : (isLogin ? 'Sign in' : 'Create account')}
            </button>
          </form>
          <div className="mt-8 pt-6 border-t border-white/5 text-center">
            <button onClick={() => setIsLogin(!isLogin)} className="text-slate-400 hover:text-white text-sm font-medium transition-colors">{isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}</button>
          </div>
        </div>
        <p className="mt-8 text-center text-slate-500 text-[10px] font-bold">Powered by Gemini 2.5 flash</p>
      </div>
    </div>
  );
};

export default AuthView;