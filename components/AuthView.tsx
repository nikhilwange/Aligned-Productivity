
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
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--surface-950)] overflow-hidden px-6">
        {/* Ambient orbs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] rounded-full bg-purple-600/20 blur-[120px] animate-pulse-glow"></div>
          <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-teal-500/15 blur-[100px] animate-pulse-glow" style={{ animationDelay: '1s' }}></div>
        </div>

        <div className="relative max-w-md w-full glass-card rounded-3xl p-10 text-center animate-scale-in">
          {/* Success Icon */}
          <div className="relative w-20 h-20 mx-auto mb-8">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 opacity-20 blur-xl animate-pulse-glow"></div>
            <div className="relative w-full h-full rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow-lg">
              <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-3">Check your email</h2>
          <p className="text-[var(--text-secondary)] mb-8 leading-relaxed">
            We've sent a confirmation link to<br />
            <span className="text-teal-400 font-semibold">{email}</span>
          </p>

          <button
            onClick={() => setIsLogin(true)}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-sm font-medium transition-colors duration-200 flex items-center gap-2 mx-auto"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Return to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--surface-950)] overflow-hidden px-6">
      {/* Animated ambient background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-purple-600/20 blur-[150px] animate-soft-pulse"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-teal-500/15 blur-[120px] animate-soft-pulse" style={{ animationDelay: '2s' }}></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-amber-500/5 blur-[200px] animate-pulse-glow"></div>
      </div>

      {/* Decorative grid */}
      <div className="absolute inset-0 opacity-[0.02]" style={{
        backgroundImage: 'linear-gradient(var(--glass-border) 1px, transparent 1px), linear-gradient(90deg, var(--glass-border) 1px, transparent 1px)',
        backgroundSize: '60px 60px'
      }}></div>

      <div className="relative w-full max-w-md animate-fade-in-up">
        {/* Brand Header */}
        <div className="flex flex-col items-center mb-10">
          {/* Logo */}
          <div className="relative mb-6 group">
            <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-amber-500 via-orange-500 to-yellow-500 opacity-30 blur-2xl group-hover:opacity-50 transition-opacity duration-500"></div>
            <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 via-orange-500 to-yellow-600 shadow-2xl flex items-center justify-center transform rotate-3 group-hover:rotate-6 transition-transform duration-500">
              <span className="text-white font-bold text-3xl tracking-tight">A</span>
            </div>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)] mb-2">Aligned</h1>
          <p className="text-[var(--text-muted)] text-sm font-medium tracking-wide">Workspace Intelligence</p>
        </div>

        {/* Auth Card */}
        <div className="glass-card rounded-3xl p-8 shadow-2xl">
          {/* Tab indicator */}
          <div className="flex items-center justify-center gap-2 mb-8">
            <button
              onClick={() => { setIsLogin(true); setError(null); }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                isLogin
                  ? 'bg-[var(--glass-bg-hover)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              Sign in
            </button>
            <button
              onClick={() => { setIsLogin(false); setError(null); }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                !isLogin
                  ? 'bg-[var(--glass-bg-hover)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              Create account
            </button>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 animate-fade-in-down">
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <p className="text-red-300 text-sm font-medium">{error}</p>
              </div>
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <div className="space-y-2 animate-fade-in-down">
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider ml-1">Full name</label>
                <input
                  required
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full glass-input rounded-xl px-4 py-3.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-sm font-medium"
                  placeholder="John Doe"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider ml-1">Email address</label>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full glass-input rounded-xl px-4 py-3.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-sm font-medium"
                placeholder="you@workspace.com"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider ml-1">Password</label>
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full glass-input rounded-xl px-4 py-3.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-sm font-medium"
                placeholder="••••••••"
              />
            </div>
            
            <button 
              disabled={isLoading} 
              type="submit" 
              className="w-full py-4 mt-2 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:via-orange-400 hover:to-amber-500 text-white font-bold rounded-xl shadow-lg shadow-amber-500/25 transition-all duration-300 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                <>
                  {isLogin ? 'Sign in' : 'Create account'}
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </>
              )}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-[var(--glass-border)] text-center">
            <button
              onClick={() => { setIsLogin(!isLogin); setError(null); }}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm font-medium transition-colors duration-200"
            >
              {isLogin ? "Don't have an account? " : "Already have an account? "}
              <span className="text-amber-400 hover:text-amber-300">{isLogin ? 'Create one' : 'Sign in'}</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-[var(--text-muted)] opacity-60 text-xs font-medium flex items-center justify-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-500"></span>
            Powered by Gemini 2.5
          </p>
        </div>
      </div>
    </div>
  );
};

export default AuthView;
