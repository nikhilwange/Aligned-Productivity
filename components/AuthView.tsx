import React, { useState } from 'react';
import { User } from '../types';
import { supabase } from '../services/supabaseService';

interface AuthViewProps {
  onLogin: (user: User) => void;
}

const AuthView: React.FC<AuthViewProps> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSignupSuccess, setIsSignupSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      if (isLogin) {
        const { data, error: loginError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (loginError) throw loginError;
        
        if (data.user) {
          onLogin({
            id: data.user.id,
            email: data.user.email || '',
            name: data.user.user_metadata?.name || data.user.email?.split('@')[0] || 'User'
          });
        }
      } else {
        const { data, error: signupError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              name: name
            }
          }
        });

        if (signupError) throw signupError;

        if (data.user) {
          // If auto-login is disabled or email confirmation is needed
          if (data.session) {
            onLogin({
              id: data.user.id,
              email: data.user.email || '',
              name: name || 'User'
            });
          } else {
            setIsSignupSuccess(true);
          }
        }
      }
    } catch (err: any) {
      setError(err.message || "An authentication error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  if (isSignupSuccess) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950 overflow-hidden font-sans px-6 text-center">
        <div className="max-w-md w-full bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[40px] p-12 animate-in zoom-in-95 duration-500">
          <div className="w-20 h-20 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-8">
            <svg className="w-10 h-10 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-4">Check your email</h2>
          <p className="text-slate-400 mb-10 leading-relaxed font-medium">We've sent a confirmation link to <span className="text-amber-400">{email}</span>. Please click the link to activate your account.</p>
          <button onClick={() => setIsLogin(true)} className="text-white hover:text-amber-400 text-sm font-bold underline transition-colors">Return to login</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950 overflow-hidden font-sans">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-amber-500/10 rounded-full blur-[120px] animate-soft-pulse"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-yellow-600/10 rounded-full blur-[120px] animate-soft-pulse" style={{ animationDelay: '1.5s' }}></div>
      </div>

      <div className="relative w-full max-w-md p-8 animate-in fade-in zoom-in-95 duration-500">
        <div className="flex flex-col items-center mb-10">
          <div className="w-16 h-16 bg-gradient-to-br from-amber-500 to-yellow-500 rounded-2xl shadow-2xl flex items-center justify-center text-white font-bold text-3xl mb-4 rotate-3">V</div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">VaniLog</h1>
          <p className="text-slate-400 text-sm font-medium tracking-wide">{isLogin ? 'Welcome back to your insights' : 'Join the next generation of transcription'}</p>
        </div>

        <div className="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[32px] p-8 shadow-2xl shadow-black/40">
          {error && (
            <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-xs font-bold animate-in slide-in-from-top-2">
              {error}
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 ml-1">Full name</label>
                <input required type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all" placeholder="John Doe" />
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 ml-1">Email address</label>
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all" placeholder="you@example.com" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 ml-1">Password</label>
              <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all" placeholder="••••••••" />
            </div>
            <button disabled={isLoading} type="submit" className="w-full py-4 bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-white font-bold rounded-2xl shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center">
              {isLoading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : (isLogin ? 'Sign in' : 'Create account')}
            </button>
          </form>
          <div className="mt-8 pt-6 border-t border-white/5 text-center">
            <button onClick={() => { setIsLogin(!isLogin); setError(null); }} className="text-slate-400 hover:text-white text-sm font-medium transition-colors">{isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}</button>
          </div>
        </div>
        <p className="mt-8 text-center text-slate-500 text-[10px] font-bold">Powered by Gemini 2.5 flash</p>
      </div>
    </div>
  );
};

export default AuthView;