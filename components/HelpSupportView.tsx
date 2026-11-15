import React, { useState } from 'react';
import { User } from '../types';
import { FAQ } from '../config/faq';
import {
  SUPPORT_EMAIL, SUPPORT_MAILTO, SUPPORT_REPLY_PROMISE, SUPPORT_WHATSAPP_URL,
  SUPPORT_TOPICS, SUPPORT_MESSAGE_MAX, SupportTopic, splitOnSupportEmail,
} from '../config/support';
import { submitSupportRequest } from '../services/supportService';

interface HelpSupportViewProps {
  user: User | null;
  /** Pre-selects the topic, e.g. 'payment_plan' when opened from Billing. */
  initialTopic?: SupportTopic;
}

const EmailLink: React.FC = () => (
  <a href={SUPPORT_MAILTO} className="font-semibold underline underline-offset-2" style={{ color: 'var(--accent)' }}>
    {SUPPORT_EMAIL}
  </a>
);

const withEmailLink = (text: string) => splitOnSupportEmail(text).map((part, i) =>
  i % 2 === 1 ? <EmailLink key={i} /> : <React.Fragment key={i}>{part}</React.Fragment>,
);

const HelpSupportView: React.FC<HelpSupportViewProps> = ({ user, initialTopic }) => {
  const [topic, setTopic] = useState<SupportTopic | ''>(initialTopic ?? '');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const canSend = !!topic && message.trim().length > 0 && !sending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic || !message.trim()) return;
    setSending(true);
    setError(null);
    try {
      const { email } = await submitSupportRequest(topic, message.trim());
      setSentTo(email || user?.email || '');
      setMessage('');
    } catch (err: any) {
      setError(err?.message ?? 'Could not send your request.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--surface-950)] scrollbar-hide">
      <div className="px-6 md:px-10 py-8 max-w-3xl mx-auto pb-24 md:pb-10">

        {/* Page heading */}
        <div className="mb-8">
          <h1 className="font-display-tight text-3xl md:text-4xl font-medium text-[var(--text-primary)] leading-[1.05]">
            Help &amp; Support
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            Send us a message and we'll get back to you. {SUPPORT_REPLY_PROMISE}
          </p>
        </div>

        {/* Contact form */}
        <section className="mb-10">
          <SectionLabel>Contact us</SectionLabel>
          <div className="glass-card rounded-2xl border border-white/[0.06] p-5">
            {sentTo !== null ? (
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  Thanks. We reply within 24 hours at {sentTo}.
                </div>
                <button
                  onClick={() => { setSentTo(null); setTopic(''); }}
                  className="mt-4 px-4 py-2 rounded-xl text-sm font-semibold glass glass-hover text-[var(--text-primary)]"
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <label className="block">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Topic</span>
                  <select
                    value={topic}
                    onChange={e => setTopic(e.target.value as SupportTopic)}
                    required
                    className="w-full px-3 py-2.5 rounded-xl text-sm glass text-[var(--text-primary)] bg-[var(--surface-900)] outline-none"
                  >
                    <option value="" disabled>Choose a topic</option>
                    {SUPPORT_TOPICS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </label>

                <label className="block">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Message</span>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value.slice(0, SUPPORT_MESSAGE_MAX))}
                    required
                    rows={6}
                    maxLength={SUPPORT_MESSAGE_MAX}
                    placeholder="Tell us what happened and what you expected."
                    className="w-full px-3 py-2.5 rounded-xl text-sm glass text-[var(--text-primary)] bg-[var(--surface-900)] outline-none resize-y"
                  />
                  <span className="block text-right text-[11px] text-[var(--text-muted)] mt-1">
                    {message.length.toLocaleString('en-IN')} / {SUPPORT_MESSAGE_MAX.toLocaleString('en-IN')}
                  </span>
                </label>

                {error && (
                  <div className="text-xs leading-relaxed" style={{ color: 'var(--accent-2)' }}>
                    {error} You can also write to us at <EmailLink />.
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={!canSend}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-50"
                    style={{ background: 'var(--cta-bg)', color: 'var(--cta-fg)' }}
                  >
                    {sending ? 'Sending…' : 'Send message'}
                  </button>
                  {user?.email && (
                    <span className="text-xs text-[var(--text-muted)]">We'll reply to {user.email}</span>
                  )}
                </div>
              </form>
            )}
          </div>

          {/* Other ways to reach us */}
          <div className="mt-3 flex flex-wrap items-center gap-3 px-1 text-xs text-[var(--text-muted)]">
            <span>Or email <EmailLink /></span>
            {SUPPORT_WHATSAPP_URL && (
              <a
                href={SUPPORT_WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-lg font-semibold glass glass-hover text-[var(--text-primary)]"
              >
                WhatsApp us
              </a>
            )}
          </div>
        </section>

        {/* FAQ */}
        <section className="mb-10">
          <SectionLabel>Frequently asked questions</SectionLabel>
          <div className="glass-card rounded-2xl border border-white/[0.06] overflow-hidden divide-y divide-white/[0.06]">
            {FAQ.map(item => (
              <details key={item.q}>
                <summary className="flex items-center justify-between gap-4 px-5 py-4 cursor-pointer list-none text-sm font-semibold text-[var(--text-primary)] glass-hover">
                  <span>{item.q}</span>
                  <span className="shrink-0 text-lg leading-none" style={{ color: 'var(--accent)' }}>+</span>
                </summary>
                <div className="px-5 pb-4 text-sm leading-relaxed text-[var(--text-muted)]">
                  {withEmailLink(item.a)}
                </div>
              </details>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[.15em] mb-3 px-1">
    {children}
  </div>
);

export default HelpSupportView;
