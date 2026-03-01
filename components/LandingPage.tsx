import React, { useState } from 'react';

interface LandingPageProps {
  onGetStarted: () => void;
}

// ─── Colour tokens (no CSS variables — fully self-contained) ───────────────
const DARK = {
  bg:           '#080810',
  bgCard:       'rgba(255,255,255,0.03)',
  bgCardHover:  'rgba(255,255,255,0.05)',
  border:       'rgba(255,255,255,0.08)',
  borderHover:  'rgba(255,255,255,0.14)',
  text1:        '#ffffff',
  text2:        'rgba(255,255,255,0.70)',
  text3:        'rgba(255,255,255,0.45)',
  text4:        'rgba(255,255,255,0.28)',
  navBg:        'rgba(255,255,255,0.04)',
  inputBg:      'rgba(255,255,255,0.05)',
  inputBorder:  'rgba(255,255,255,0.10)',
};
const LIGHT = {
  bg:           '#f8f9fb',
  bgCard:       '#ffffff',
  bgCardHover:  '#f1f4f8',
  border:       'rgba(15,23,42,0.10)',
  borderHover:  'rgba(15,23,42,0.18)',
  text1:        '#0f172a',
  text2:        '#334155',
  text3:        '#64748b',
  text4:        '#94a3b8',
  navBg:        'rgba(255,255,255,0.80)',
  inputBg:      '#ffffff',
  inputBorder:  'rgba(15,23,42,0.12)',
};

const AMBER   = '#f59e0b';
const ORANGE  = '#ea580c';
const GRAD    = 'linear-gradient(135deg,#f59e0b,#ea580c)';
const RED_BG  = 'rgba(239,68,68,0.06)';
const RED_BD  = 'rgba(239,68,68,0.18)';
const RED_TXT = 'rgba(239,68,68,0.80)';

const LandingPage: React.FC<LandingPageProps> = ({ onGetStarted }) => {
  const [dark, setDark]           = useState(true);
  const [email, setEmail]         = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy]           = useState(false);

  const C = dark ? DARK : LIGHT;

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setTimeout(() => { setSubmitted(true); setBusy(false); }, 600);
    try {
      const list = JSON.parse(localStorage.getItem('aligned-waitlist') || '[]');
      list.push({ email: email.trim(), ts: Date.now() });
      localStorage.setItem('aligned-waitlist', JSON.stringify(list));
    } catch (_) {}
  };

  // Reusable style helpers
  const card = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: C.bgCard,
    border: `1px solid ${C.border}`,
    borderRadius: 20,
    ...extra,
  });

  const glassCard: React.CSSProperties = {
    background: C.navBg,
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    border: `1px solid ${C.border}`,
    borderRadius: 20,
  };

  return (
    <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', background: C.bg, color: C.text1, fontFamily: 'Inter, sans-serif', transition: 'background 0.3s, color 0.3s' }}>

      {/* Ambient orbs – dark only */}
      {dark && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: '-15%', left: '-5%', width: 600, height: 600, borderRadius: '50%', background: 'rgba(245,158,11,0.07)', filter: 'blur(180px)' }} />
          <div style={{ position: 'absolute', top: '40%', right: '-8%', width: 400, height: 400, borderRadius: '50%', background: 'rgba(234,88,12,0.05)', filter: 'blur(150px)' }} />
          <div style={{ position: 'absolute', bottom: '5%', left: '20%', width: 350, height: 350, borderRadius: '50%', background: 'rgba(245,158,11,0.04)', filter: 'blur(120px)' }} />
          {/* dot grid */}
          <div style={{ position: 'absolute', inset: 0, opacity: 0.4, backgroundImage: `radial-gradient(circle, ${C.border} 1px, transparent 1px)`, backgroundSize: '32px 32px' }} />
        </div>
      )}
      {/* Light mode subtle grid */}
      {!dark && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, backgroundImage: `linear-gradient(rgba(15,23,42,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.07) 1px, transparent 1px)`, backgroundSize: '48px 48px' }} />
      )}

      {/* ══════ NAV ══════ */}
      <nav style={{ position: 'fixed', top: 0, width: '100%', zIndex: 50, padding: '16px 20px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...glassCard, padding: '12px 20px' }}>

          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: GRAD, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 18, color: '#000', boxShadow: '0 4px 14px rgba(245,158,11,0.32)' }}>A</div>
            <div>
              <span style={{ fontSize: 15, fontWeight: 800, color: C.text1, letterSpacing: '-0.02em' }}>Aligned</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.text4, letterSpacing: '0.14em', textTransform: 'uppercase', marginLeft: 8 }}>Workspace Intelligence</span>
            </div>
          </div>

          {/* Right */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {(['Features','Sarvam AI','Early Access'] as const).map((label, i) => (
              <a key={label} href={['#features','#sarvam','#waitlist'][i]}
                style={{ display: 'none', fontSize: 13, fontWeight: 600, color: C.text3, textDecoration: 'none', padding: '4px 8px' }}
                className="nav-link">{label}</a>
            ))}

            {/* Theme toggle */}
            <button onClick={() => setDark(d => !d)}
              title={dark ? 'Light mode' : 'Dark mode'}
              style={{ width: 34, height: 34, borderRadius: 9, background: C.bgCard, border: `1px solid ${C.border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.text3 }}>
              {dark
                ? <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
                : <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
              }
            </button>

            <button onClick={onGetStarted}
              style={{ fontSize: 13, fontWeight: 600, color: C.text3, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px' }}>
              Sign In
            </button>
            <button onClick={onGetStarted}
              style={{ padding: '8px 18px', borderRadius: 12, background: GRAD, color: '#000', fontWeight: 800, fontSize: 13, border: 'none', cursor: 'pointer', boxShadow: '0 4px 14px rgba(245,158,11,0.30)' }}>
              Try Free
            </button>
          </div>
        </div>
      </nav>

      {/* ══════ HERO ══════ */}
      <section style={{ position: 'relative', paddingTop: 160, paddingBottom: 80, padding: '160px 20px 80px', zIndex: 10 }}>
        <div style={{ maxWidth: 860, margin: '0 auto', textAlign: 'center' }}>

          {/* Badge */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 18px', borderRadius: 999, background: 'rgba(245,158,11,0.10)', border: `1px solid rgba(245,158,11,0.28)`, fontSize: 11, fontWeight: 800, color: AMBER, letterSpacing: '0.14em', marginBottom: 32 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: AMBER, display: 'inline-block' }} />
            NOW IN EARLY ACCESS · JOIN 200+ PROFESSIONALS
          </div>

          {/* Headline */}
          <h1 style={{ fontSize: 'clamp(44px,8vw,80px)', fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 0.95, marginBottom: 28 }}>
            <span style={{ color: C.text1 }}>Your Meetings.</span><br />
            <span style={{ background: 'linear-gradient(135deg,#f59e0b,#fbbf24,#ea580c)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Your Workspace.
            </span><br />
            <span style={{ color: C.text1 }}>Your Intelligence.</span>
          </h1>

          {/* "Capture the Chaos" tagline */}
          <div style={{ display: 'inline-block', padding: '10px 24px', borderRadius: 14, background: dark ? 'rgba(245,158,11,0.08)' : 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.22)', marginBottom: 24 }}>
            <span style={{ fontSize: 'clamp(15px,2.5vw,20px)', fontWeight: 900, letterSpacing: '-0.02em', color: C.text1 }}>
              Capture the Chaos.{' '}
            </span>
            <span style={{ fontSize: 'clamp(15px,2.5vw,20px)', fontWeight: 900, letterSpacing: '-0.02em', background: 'linear-gradient(135deg,#f59e0b,#ea580c)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Deliver the Strategy.
            </span>
          </div>

          {/* Body */}
          <p style={{ fontSize: 18, color: C.text2, fontWeight: 500, maxWidth: 580, margin: '0 auto 14px', lineHeight: 1.65 }}>
            Aligned is your <strong style={{ color: C.text1 }}>Workspace Intelligence</strong> layer — captures every meeting, extracts what matters, and surfaces action items before you've closed the tab.
          </p>
          <p style={{ fontSize: 13, color: C.text4, maxWidth: 480, margin: '0 auto 44px', lineHeight: 1.7 }}>
            Works with Zoom, Teams &amp; Google Meet · Paste transcripts you already have · Hindi, Marathi, Tamil &amp; 10 more Indian languages
          </p>

          {/* CTAs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center', marginBottom: 44 }}>
            <button onClick={onGetStarted}
              style={{ padding: '15px 36px', borderRadius: 16, background: GRAD, color: '#000', fontWeight: 800, fontSize: 15, border: 'none', cursor: 'pointer', boxShadow: '0 8px 30px rgba(245,158,11,0.30)' }}>
              Start for Free →
            </button>
            <a href="#waitlist"
              style={{ padding: '15px 36px', borderRadius: 16, background: C.bgCard, border: `1px solid ${C.border}`, color: C.text2, fontWeight: 800, fontSize: 15, textDecoration: 'none', display: 'inline-block' }}>
              Join Early Access
            </a>
          </div>

          {/* Trust strip */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, justifyContent: 'center', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.text4 }}>
            <span>Gemini 2.5 Pro</span>
            <span style={{ color: 'rgba(245,158,11,0.65)' }}>· Sarvam AI ·</span>
            <span>Supabase</span>
            <span>End-to-End Encrypted</span>
          </div>
        </div>
      </section>

      {/* ══════ PAIN / SOLUTION ══════ */}
      <section style={{ position: 'relative', padding: '40px 20px', zIndex: 10 }}>
        <div style={{ maxWidth: 860, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 14 }}>
          {/* Pain */}
          <div style={{ ...card(), background: RED_BG, borderColor: RED_BD, padding: '28px 32px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: RED_TXT, marginBottom: 20 }}>The Problem</div>
            {[
              'You sit through a 1-hour meeting. You remember 20% by evening.',
              'Action items live in your head. Half forgotten by morning.',
              'Attended 4 meetings today. Notes from none of them.',
              'Your team speaks Hindi. Your tool understands nothing.',
            ].map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, marginBottom: i < 3 ? 14 : 0 }}>
                <span style={{ color: RED_TXT, fontWeight: 700, flexShrink: 0 }}>✕</span>
                <span style={{ fontSize: 13, color: C.text2, lineHeight: 1.6 }}>{t}</span>
              </div>
            ))}
          </div>
          {/* Solution */}
          <div style={{ ...card(), background: 'rgba(245,158,11,0.05)', borderColor: 'rgba(245,158,11,0.20)', padding: '28px 32px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: AMBER, marginBottom: 20 }}>Aligned Changes This</div>
            {[
              'Every meeting captured, transcribed, and summarised automatically.',
              'Action items extracted and tracked — nothing falls through.',
              'Patterns and insights surface across all your sessions.',
              'Native support for Hindi, Marathi, Tamil + 10 more languages.',
            ].map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, marginBottom: i < 3 ? 14 : 0 }}>
                <span style={{ color: AMBER, fontWeight: 700, flexShrink: 0 }}>✓</span>
                <span style={{ fontSize: 13, color: C.text2, lineHeight: 1.6 }}>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════ SARVAM AI ══════ */}
      <section id="sarvam" style={{ position: 'relative', padding: '80px 20px', zIndex: 10 }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>

          {/* Section header */}
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 999, background: 'rgba(234,88,12,0.09)', border: '1px solid rgba(234,88,12,0.24)', fontSize: 11, fontWeight: 800, color: '#f97316', letterSpacing: '0.14em', marginBottom: 20 }}>
              🇮🇳 PROUDLY BUILT FOR BHARAT
            </div>
            <h2 style={{ fontSize: 'clamp(28px,5vw,48px)', fontWeight: 900, letterSpacing: '-0.03em', color: C.text1, marginBottom: 14 }}>
              Powered by{' '}
              <span style={{ background: 'linear-gradient(135deg,#f97316,#f59e0b)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                Sarvam AI
              </span>
            </h2>
            <p style={{ fontSize: 16, color: C.text2, maxWidth: 580, margin: '0 auto', lineHeight: 1.65 }}>
              Sarvam AI is India's own speech intelligence platform — built by Indians, trained on Indian languages, designed for how India actually communicates.
            </p>
          </div>

          {/* Big card */}
          <div style={{ ...card(), background: 'rgba(234,88,12,0.04)', borderColor: 'rgba(234,88,12,0.20)', padding: '40px 44px', marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 40, alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#f97316', marginBottom: 14 }}>Sarvam AI · Saaras v3</div>
                <h3 style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.03em', color: C.text1, lineHeight: 1.2, marginBottom: 16 }}>
                  Your team speaks Hindi.<br />Aligned understands.
                </h3>
                <p style={{ fontSize: 13, color: C.text2, lineHeight: 1.7, marginBottom: 20 }}>
                  Most meeting tools are built for English-only workplaces. Aligned integrates Sarvam AI's <strong style={{ color: C.text1 }}>Saaras v3</strong> — India's most accurate multilingual speech engine — so Hindi, Marathi, Tamil, or Gujarati meetings are captured with the same precision as English.
                </p>
                <div style={{ display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 14, background: 'rgba(234,88,12,0.07)', border: '1px solid rgba(234,88,12,0.18)', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 22, flexShrink: 0 }}>🏆</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#fb923c', marginBottom: 4 }}>Made in India · For India</div>
                    <div style={{ fontSize: 12, color: C.text3, lineHeight: 1.5 }}>Sarvam AI builds foundational language models for Bharat</div>
                  </div>
                </div>
              </div>

              {/* Language grid */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.text4, marginBottom: 14 }}>Supported Languages</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    { lang: 'Hindi',     script: 'हिन्दी'   },
                    { lang: 'Marathi',   script: 'मराठी'    },
                    { lang: 'Tamil',     script: 'தமிழ்'    },
                    { lang: 'Telugu',    script: 'తెలుగు'   },
                    { lang: 'Gujarati',  script: 'ગુજરાતી'  },
                    { lang: 'Kannada',   script: 'ಕನ್ನಡ'    },
                    { lang: 'Bengali',   script: 'বাংলা'    },
                    { lang: 'Malayalam', script: 'മലയാളം'   },
                    { lang: 'Punjabi',   script: 'ਪੰਜਾਬੀ'   },
                    { lang: 'English',   script: 'English'  },
                  ].map(l => (
                    <div key={l.lang} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, background: C.bgCard, border: `1px solid ${C.border}` }}>
                      <span style={{ fontSize: 14 }}>{l.lang === 'English' ? '🌐' : '🇮🇳'}</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.text1 }}>{l.lang}</div>
                        <div style={{ fontSize: 10, color: C.text4 }}>{l.script}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 3 sub-points */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
            {[
              { icon: '🎯', title: 'Highest Accuracy',     desc: 'Saaras v3 trained on Indian accents and Hinglish code-switching between languages.' },
              { icon: '⚡', title: 'Real-Time Processing',  desc: 'Transcription completes within seconds of your recording ending — no waiting.' },
              { icon: '🔒', title: 'Your Data Stays Yours', desc: 'Transcripts stored in your personal Supabase instance. Audio processed ephemerally.' },
            ].map(f => (
              <div key={f.title} style={{ ...card(), padding: '20px 22px' }}>
                <div style={{ fontSize: 24, marginBottom: 12 }}>{f.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text1, marginBottom: 6 }}>{f.title}</div>
                <div style={{ fontSize: 12, color: C.text3, lineHeight: 1.6 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════ FEATURES ══════ */}
      <section id="features" style={{ position: 'relative', padding: '60px 20px', zIndex: 10 }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontSize: 'clamp(26px,4.5vw,40px)', fontWeight: 900, letterSpacing: '-0.03em', color: C.text1, marginBottom: 12 }}>
              Your complete{' '}
              <span style={{ background: GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                Workspace Intelligence
              </span>{' '}
              layer
            </h2>
            <p style={{ fontSize: 13, color: C.text3, maxWidth: 480, margin: '0 auto', lineHeight: 1.7 }}>
              Not just a meeting recorder — the intelligence layer across everything you discuss, turned into work that actually gets done.
            </p>
          </div>

          {/* USP label */}
          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 16px', borderRadius: 999, background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.05)', border: `1px solid ${C.border}`, fontSize: 11, fontWeight: 800, color: C.text4, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              ⭐ THREE THINGS THAT MAKE ALIGNED DIFFERENT
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 14 }}>
            {[
              {
                icon: '🇮🇳', rgb: '234,88,12', badge: 'Sarvam AI',
                title: 'Multilingual Meetings',
                tagline: 'The only meeting tool that speaks India\'s languages',
                desc: 'Powered by Sarvam AI — India\'s own speech intelligence. Switch between Hindi and English mid-sentence (Hinglish), discuss in Marathi, Tamil, or Gujarati — Aligned captures every word with the same precision as English.',
                points: ['10+ Indian languages supported', 'Hinglish code-switching aware', 'Native script + English summaries'],
              },
              {
                icon: '💡', rgb: '168,85,247', badge: null,
                title: 'Strategic Insights',
                tagline: 'Patterns your team would never notice manually',
                desc: 'Aligned doesn\'t just summarise — it thinks across all your meetings. Surface recurring blockers, track unresolved decisions, and get a strategic view of what\'s actually happening in your work over time.',
                points: ['Cross-session pattern detection', 'Recurring issues flagged automatically', 'Strategic gaps & recommended actions'],
              },
              {
                icon: '🤖', rgb: '20,184,166', badge: null,
                title: 'AI-Powered Chat',
                tagline: 'Ask anything. Get answers from your own meetings.',
                desc: 'Ask Aligned questions across your entire meeting history — "What did we decide about the Chakan timeline?" or "What action items are still open from last week?" Instant answers, cited from your own sessions.',
                points: ['Natural language queries', 'Answers cited from your meetings', 'Works across all sessions at once'],
              },
            ].map(f => (
              <div key={f.title} style={{ ...card(), background: `rgba(${f.rgb},0.05)`, borderColor: `rgba(${f.rgb},0.16)`, padding: '26px 28px', position: 'relative' }}>
                {f.badge && (
                  <div style={{ position: 'absolute', top: 16, right: 16, padding: '3px 8px', borderRadius: 7, background: `rgba(${f.rgb},0.14)`, border: `1px solid rgba(${f.rgb},0.26)`, fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: `rgb(${f.rgb})` }}>
                    {f.badge}
                  </div>
                )}
                <div style={{ fontSize: 28, marginBottom: 16 }}>{f.icon}</div>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: `rgb(${f.rgb})`, marginBottom: 6 }}>{f.tagline}</div>
                <div style={{ fontSize: 16, fontWeight: 900, color: C.text1, marginBottom: 12, letterSpacing: '-0.02em' }}>{f.title}</div>
                <p style={{ fontSize: 12, color: C.text2, lineHeight: 1.65, marginBottom: 18 }}>{f.desc}</p>
                {f.points.map(p => (
                  <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: `rgb(${f.rgb})`, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: C.text3 }}>{p}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Manual entry callout */}
          <div style={{ ...card(), marginTop: 14, padding: '18px 24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 22 }}>✏️</span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text1, marginBottom: 3 }}>Missed the recording? Paste your transcript.</div>
              <div style={{ fontSize: 12, color: C.text3 }}>Copy from Teams, Zoom or Google Meet — same structured notes and insights as a live recording.</div>
            </div>
            <button onClick={onGetStarted} style={{ fontSize: 12, fontWeight: 700, color: AMBER, background: 'none', border: 'none', cursor: 'pointer' }}>Try it →</button>
          </div>
        </div>
      </section>

      {/* ══════ HOW IT WORKS ══════ */}
      <section style={{ position: 'relative', padding: '60px 20px', zIndex: 10 }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 44 }}>
            <h2 style={{ fontSize: 'clamp(22px,4vw,32px)', fontWeight: 900, letterSpacing: '-0.03em', color: C.text1, marginBottom: 8 }}>From meeting to insights in 3 steps</h2>
            <p style={{ fontSize: 13, color: C.text3 }}>No setup. No integrations required. Open Aligned and go.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 24 }}>
            {[
              { icon: '⏺', title: 'Record or Paste',  desc: 'Hit record before your meeting, or paste a transcript you already have. Sarvam handles Hindi, English, or both.' },
              { icon: '⚡', title: 'Aligned Analyses',  desc: 'Gemini 2.5 Pro extracts structured notes, action items, key decisions, and follow-ups.' },
              { icon: '✅', title: 'Act on Insights',   desc: 'Your Home screen shows what needs attention. Ask Intelligence questions across all your meetings.' },
            ].map((s, i) => (
              <div key={s.title} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '0 8px' }}>
                <div style={{ position: 'relative', width: 72, height: 72, borderRadius: 18, background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 18 }}>
                  {s.icon}
                  <div style={{ position: 'absolute', top: -8, right: -8, width: 22, height: 22, borderRadius: '50%', background: AMBER, color: '#000', fontSize: 10, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text1, marginBottom: 8 }}>{s.title}</div>
                <div style={{ fontSize: 12, color: C.text3, lineHeight: 1.65 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════ WAITLIST ══════ */}
      <section id="waitlist" style={{ position: 'relative', padding: '80px 20px', zIndex: 10 }}>
        <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 999, background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.24)', fontSize: 11, fontWeight: 800, color: AMBER, letterSpacing: '0.14em', marginBottom: 24 }}>
            🚀 LIMITED EARLY ACCESS
          </div>
          <h2 style={{ fontSize: 'clamp(28px,5vw,46px)', fontWeight: 900, letterSpacing: '-0.03em', color: C.text1, lineHeight: 1.1, marginBottom: 16 }}>
            Be among the first<br />to use Aligned.
          </h2>
          <p style={{ fontSize: 14, color: C.text2, lineHeight: 1.7, maxWidth: 440, margin: '0 auto 36px' }}>
            Join 200+ professionals on the waitlist. We <strong style={{ color: C.text1 }}>promise</strong> every early access member{' '}
            <strong style={{ color: AMBER }}>1 month of free Pro access</strong> — no conditions, no credit card, automatically applied when you sign up.
          </p>

          {submitted ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '40px 0' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>🎉</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.text1 }}>You're on the list!</div>
              <div style={{ fontSize: 13, color: C.text3 }}>We'll reach out with early access details soon.</div>
              <button onClick={onGetStarted}
                style={{ marginTop: 16, padding: '12px 28px', borderRadius: 14, background: GRAD, color: '#000', fontWeight: 800, fontSize: 14, border: 'none', cursor: 'pointer', boxShadow: '0 4px 14px rgba(245,158,11,0.28)' }}>
                Try it now →
              </button>
            </div>
          ) : (
            <form onSubmit={handleJoin} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, maxWidth: 440, margin: '0 auto' }}>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                style={{ flex: 1, minWidth: 180, padding: '14px 18px', borderRadius: 14, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text1, fontSize: 14, outline: 'none' }}
              />
              <button type="submit" disabled={busy}
                style={{ padding: '14px 24px', borderRadius: 14, background: GRAD, color: '#000', fontWeight: 800, fontSize: 14, border: 'none', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.65 : 1, boxShadow: '0 4px 14px rgba(245,158,11,0.28)', whiteSpace: 'nowrap' }}>
                {busy ? 'Joining…' : 'Get Early Access'}
              </button>
            </form>
          )}

          <p style={{ fontSize: 12, color: C.text4, marginTop: 14 }}>No spam. No credit card. Unsubscribe anytime.</p>

          <div style={{ marginTop: 40, paddingTop: 28, borderTop: `1px solid ${C.border}` }}>
            <p style={{ fontSize: 12, color: C.text4, marginBottom: 10 }}>Already have an account?</p>
            <button onClick={onGetStarted} style={{ fontSize: 13, fontWeight: 700, color: AMBER, background: 'none', border: 'none', cursor: 'pointer' }}>
              Sign in to Aligned →
            </button>
          </div>
        </div>
      </section>

      {/* ══════ FOOTER ══════ */}
      <footer style={{ position: 'relative', padding: '32px 20px', borderTop: `1px solid ${C.border}`, zIndex: 10 }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: GRAD, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 16, color: '#000' }}>A</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.text1 }}>Aligned</div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.text4 }}>Workspace Intelligence</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.text4 }}>
            <span>Gemini 2.5 Pro</span>
            <span style={{ color: 'rgba(245,158,11,0.65)' }}>· Sarvam AI ·</span>
            <span>Supabase</span>
          </div>
          <div style={{ fontSize: 12, color: C.text4 }}>© 2026 Aligned. Made with 🧡 in India.</div>
        </div>
      </footer>

    </div>
  );
};

export default LandingPage;
