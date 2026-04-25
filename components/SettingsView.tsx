import React from 'react';
import { User } from '../types';

interface SettingsViewProps {
  user: User | null;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  transcriptionEngine: 'gemini' | 'sarvam';
  onEngineChange: (engine: 'gemini' | 'sarvam') => void;
  hasSarvamKey: boolean;
  onLogout: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({
  user,
  theme,
  onToggleTheme,
  transcriptionEngine,
  onEngineChange,
  hasSarvamKey,
  onLogout,
}) => {
  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);

  return (
    <div className="h-full overflow-y-auto bg-[var(--surface-950)] scrollbar-hide">
      <div className="px-6 md:px-10 py-8 max-w-3xl mx-auto pb-24 md:pb-10">

        {/* Page heading */}
        <div className="mb-8">
          <h1 className="font-display-tight text-3xl md:text-4xl font-medium text-[var(--text-primary)] leading-[1.05]">
            Settings
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            Manage your profile, appearance, and processing preferences.
          </p>
        </div>

        {/* Profile section */}
        {user && (
          <section className="mb-10">
            <SectionLabel>Profile</SectionLabel>
            <div className="glass-card rounded-2xl border border-white/[0.06] p-5 flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-purple-500 text-white flex items-center justify-center font-bold text-lg shadow-lg shrink-0">
                {getInitials(user.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-display-tight text-lg font-semibold text-[var(--text-primary)] truncate">
                  {user.name}
                </div>
                <div className="text-xs text-[var(--text-muted)] truncate">
                  {user.email}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Appearance section */}
        <section className="mb-10">
          <SectionLabel>Appearance</SectionLabel>
          <div className="glass-card rounded-2xl border border-white/[0.06] overflow-hidden">
            <SettingRow
              title="Theme"
              description={theme === 'dark' ? 'Dark mode is active' : 'Light mode is active'}
            >
              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-white/[0.04] border border-white/[0.05]">
                <ThemeOption
                  active={theme === 'light'}
                  onClick={() => theme !== 'light' && onToggleTheme()}
                  label="Light"
                  icon={<SunIcon />}
                />
                <ThemeOption
                  active={theme === 'dark'}
                  onClick={() => theme !== 'dark' && onToggleTheme()}
                  label="Dark"
                  icon={<MoonIcon />}
                />
              </div>
            </SettingRow>
          </div>
        </section>

        {/* Transcription section */}
        <section className="mb-10">
          <SectionLabel>Transcription Engine</SectionLabel>
          <div className="glass-card rounded-2xl border border-white/[0.06] p-5">
            <p className="text-xs text-[var(--text-muted)] mb-4 leading-relaxed">
              Choose which engine transcribes your recordings. Sarvam is optimised for
              Indian languages and code-switched speech; Gemini 2.5 is a strong
              all-round default.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <EngineCard
                active={transcriptionEngine === 'gemini'}
                onClick={() => onEngineChange('gemini')}
                label="Gemini 2.5"
                description="Google's multimodal model — strong English, solid general-purpose default."
                dotColor="bg-teal-400"
              />
              <EngineCard
                active={transcriptionEngine === 'sarvam' && hasSarvamKey}
                onClick={() => hasSarvamKey && onEngineChange('sarvam')}
                label="Sarvam + Gemini"
                description="Sarvam for Indian-language transcription, Gemini for analysis. Best for Hindi / Hinglish."
                dotColor="bg-amber-400"
                disabled={!hasSarvamKey}
              />
            </div>
          </div>
        </section>

        {/* Account section */}
        <section className="mb-10">
          <SectionLabel>Account</SectionLabel>
          <div className="glass-card rounded-2xl border border-white/[0.06] overflow-hidden">
            <button
              onClick={onLogout}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-red-500/5 transition-colors group"
            >
              <div className="text-left">
                <div className="text-sm font-semibold text-[var(--text-primary)] group-hover:text-red-400 transition-colors">
                  Sign out
                </div>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">
                  You'll be returned to the sign-in screen.
                </div>
              </div>
              <svg className="w-5 h-5 text-[var(--text-muted)] group-hover:text-red-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </section>

        <p className="text-[11px] text-center text-[var(--text-muted)] mt-8">
          Aligned · Workspace Intelligence
        </p>
      </div>
    </div>
  );
};

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[.15em] mb-3 px-1">
    {children}
  </div>
);

const SettingRow: React.FC<{
  title: string;
  description?: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <div className="flex items-center justify-between gap-4 px-5 py-4">
    <div className="min-w-0">
      <div className="text-sm font-semibold text-[var(--text-primary)]">{title}</div>
      {description && (
        <div className="text-xs text-[var(--text-muted)] mt-0.5">{description}</div>
      )}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

const ThemeOption: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}> = ({ active, onClick, label, icon }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
      active
        ? 'bg-amber-500 text-black shadow-sm'
        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
    }`}
  >
    <span className="w-3.5 h-3.5">{icon}</span>
    {label}
  </button>
);

const EngineCard: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  description: string;
  dotColor: string;
  disabled?: boolean;
}> = ({ active, onClick, label, description, dotColor, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`text-left rounded-xl border p-4 transition-all ${
      active
        ? 'bg-amber-500/10 border-amber-500/30'
        : disabled
          ? 'bg-[var(--surface-800)]/40 border-white/[0.04] opacity-50 cursor-not-allowed'
          : 'bg-[var(--surface-800)] border-white/[0.07] hover:border-white/[0.12]'
    }`}
  >
    <div className="flex items-center gap-2 mb-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span className={`text-sm font-bold ${active ? 'text-amber-300' : 'text-[var(--text-primary)]'}`}>
        {label}
      </span>
      {active && (
        <svg className="w-3.5 h-3.5 ml-auto text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </div>
    <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">{description}</p>
  </button>
);

const SunIcon: React.FC = () => (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 9h-1m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

const MoonIcon: React.FC = () => (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
  </svg>
);

export default SettingsView;
