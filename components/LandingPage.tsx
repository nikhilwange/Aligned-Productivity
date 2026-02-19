import React from 'react';

interface LandingPageProps {
  onGetStarted: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onGetStarted }) => {
  return (
    <div className="fixed inset-0 bg-[var(--surface-950)] text-[var(--text-primary)] overflow-y-auto">
      {/* Animated ambient background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-purple-600/15 blur-[150px] animate-soft-pulse"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-teal-500/10 blur-[120px] animate-soft-pulse" style={{ animationDelay: '2s' }}></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-amber-500/5 blur-[200px] animate-pulse-glow"></div>
      </div>

      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 px-6 py-8">
        <div className="max-w-7xl mx-auto flex justify-between items-center glass rounded-2xl px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl flex items-center justify-center font-bold text-xl text-white shadow-lg">
              A
            </div>
            <span className="text-xl font-bold tracking-tight text-[var(--text-primary)]">Aligned</span>
          </div>
          <button
            onClick={onGetStarted}
            className="md:hidden px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl font-bold text-sm shadow-lg"
          >
            Get Started
          </button>
          <div className="hidden md:flex items-center gap-8 text-sm font-semibold text-[var(--text-tertiary)]">
            <a href="#features" className="hover:text-[var(--text-primary)] transition-colors">Features</a>
            <a href="#vision" className="hover:text-[var(--text-primary)] transition-colors">Vision</a>
            <div className="h-4 w-px bg-[var(--glass-border)] mx-2"></div>
            <button onClick={onGetStarted} className="hover:text-[var(--text-primary)] transition-colors">
              Sign In
            </button>
            <button
              onClick={onGetStarted}
              className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl hover:from-amber-400 hover:to-orange-500 transition-all shadow-lg"
            >
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-28 md:pt-48 pb-16 md:pb-32 px-4 md:px-6">
        <div className="absolute inset-0 bg-gradient-radial from-purple-500/10 via-transparent to-transparent opacity-50"></div>

        <div className="max-w-5xl mx-auto text-center relative">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass text-xs font-bold text-amber-500 mb-8 animate-bounce">
            🚀 NOW SUPPORTING 10+ INDIAN LANGUAGES
          </div>

          <h1 className="text-4xl sm:text-6xl md:text-8xl font-black tracking-tighter mb-6 md:mb-8 leading-[1.05] md:leading-[0.9] text-[var(--text-primary)]">
            Capture the Chaos. <br />
            Deliver the{' '}
            <span className="bg-gradient-to-r from-amber-500 via-yellow-400 to-orange-600 bg-clip-text text-transparent">
              Strategy.
            </span>
          </h1>

          <p className="text-base md:text-2xl text-[var(--text-muted)] font-medium max-w-2xl mx-auto mb-8 md:mb-12 leading-relaxed">
            The ultimate workspace intelligence platform. Capture meetings, dictate thoughts, and let Gemini 2.5 turn noise into actionable insights.
          </p>

          <div className="flex flex-col md:flex-row items-center justify-center gap-6">
            <button
              onClick={onGetStarted}
              className="w-full md:w-auto px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-2xl font-bold text-lg shadow-2xl shadow-orange-500/20 hover:scale-105 transition-all"
            >
              Get Aligned for Mac
            </button>
            <button className="w-full md:w-auto px-8 py-4 glass rounded-2xl font-bold text-lg flex items-center justify-center gap-3 hover:bg-[var(--glass-bg-hover)] transition-all text-[var(--text-primary)]">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.05 20.28c-.96.95-2.04 1.87-3.23 1.87-1.15 0-1.57-.73-2.95-.73-1.4 0-1.85.71-2.93.71-1.13 0-2.31-.95-3.32-1.95-2.06-2.05-3.64-5.79-3.64-8.88 0-3.09 1.58-4.73 3.09-4.73 1.15 0 2.24.8 2.95.8.71 0 2.05-.98 3.48-.98 1.4 0 2.65.6 3.42 1.5-3.15 1.7-2.65 6.08.53 7.37-.88 2.1-1.83 4.2-3.4 5.99zM12.03 7.25c-.22-2.22 1.62-4.14 3.32-4.75.22 2.22-1.62 4.14-3.32 4.75z"/>
              </svg>
              Coming to iOS
            </button>
          </div>
        </div>

        {/* Floating UI Mockup */}
        <div className="mt-10 md:mt-24 max-w-4xl mx-auto animate-float overflow-hidden">
          <div className="glass rounded-[2rem] p-4 shadow-2xl">
            <div className="bg-[var(--surface-800)] rounded-[1.5rem] overflow-hidden aspect-video flex items-center justify-center relative">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-teal-500/10"></div>
              <div className="relative text-center">
                <div className="w-24 h-24 rounded-3xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center mx-auto mb-6">
                  <div className="w-4 h-4 bg-red-500 rounded-full animate-ping"></div>
                </div>
                <div className="text-3xl font-bold tracking-tight mb-2 text-[var(--text-primary)]">Capturing Intelligence...</div>
                <div className="text-[var(--text-muted)] font-mono">00:42:15 remaining</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-16 md:py-32 px-4 md:px-6">
        <div className="max-w-7xl mx-auto grid md:grid-cols-3 gap-6 md:gap-8">
          <div className="p-6 md:p-10 rounded-[2rem] md:rounded-[2.5rem] glass hover:border-amber-500/30 transition-all group">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 mb-8 group-hover:scale-110 transition-transform">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold mb-4 text-[var(--text-primary)]">Workspace Intelligence</h3>
            <p className="text-[var(--text-muted)] leading-relaxed">
              Turn meetings, calls, and corridor chats into beautifully structured, actionable documentation automatically.
            </p>
          </div>

          <div className="p-6 md:p-10 rounded-[2rem] md:rounded-[2.5rem] glass hover:border-purple-500/30 transition-all group">
            <div className="w-14 h-14 rounded-2xl bg-purple-500/10 flex items-center justify-center text-purple-500 mb-8 group-hover:scale-110 transition-transform">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5h12M9 3v2m1.048 9.5a18.022 18.022 0 01-3.827-5.802M13 15.538l-1.89-1.341a18.152 18.152 0 01-5.11-6.197M13 21l-3-3m0 0l-3 3m3-3V15.538M19 3v2m0 0H7" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold mb-4 text-[var(--text-primary)]">10+ Indian Languages</h3>
            <p className="text-[var(--text-muted)] leading-relaxed">
              Full support for Hindi, Marathi, Gujarati, Tamil, and more. Transcribed in native scripts with auto-English translation.
            </p>
          </div>

          <div className="p-6 md:p-10 rounded-[2rem] md:rounded-[2.5rem] glass hover:border-teal-500/30 transition-all group">
            <div className="w-14 h-14 rounded-2xl bg-teal-500/10 flex items-center justify-center text-teal-500 mb-8 group-hover:scale-110 transition-transform">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold mb-4 text-[var(--text-primary)]">Dictation Flow</h3>
            <p className="text-[var(--text-muted)] leading-relaxed">
              A dedicated, chronological log for your daily thoughts. Real-time refinement that polishes raw speech into professional text.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-20 border-t border-[var(--glass-border)] text-center">
        <div className="max-w-7xl mx-auto px-6">
          <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl flex items-center justify-center font-bold text-xl text-white mx-auto mb-8">
            A
          </div>
          <p className="text-[var(--text-muted)] opacity-60 text-sm font-semibold tracking-widest uppercase mb-4">
            Powered by Gemini 2.5 & Google Cloud
          </p>
          <p className="text-[var(--text-muted)] text-xs">© 2026 Aligned Workspace Intelligence. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
