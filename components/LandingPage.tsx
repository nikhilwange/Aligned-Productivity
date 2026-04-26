import React, { useState } from 'react';

interface LandingPageProps {
  onGetStarted: () => void;
}

// ─── Colour tokens (no CSS variables — fully self-contained) ───────────────
// Dark mode keeps its voice (Fraunces italic in amber-400 reads well on near-black).
// Light mode is warm paper, not slate-on-white. One accent (brass), not three.
const DARK = {
  bg:           '#0a0a0f',
  bgElevated:   '#131320',
  bgSunken:     '#0f0f17',
  border:       'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',
  hairline:     'rgba(255,255,255,0.05)',
  text1:        '#ffffff',
  text2:        'rgba(255,255,255,0.72)',
  text3:        'rgba(255,255,255,0.50)',
  text4:        'rgba(255,255,255,0.32)',
  inputBg:      'rgba(255,255,255,0.03)',
  inputBorder:  'rgba(255,255,255,0.10)',
  accent:       '#fbbf24',           // amber-400 — readable on near-black
  accentInk:    '#000',
  accentTint:   'rgba(251,191,36,0.10)',
  accentBorder: 'rgba(251,191,36,0.25)',
};
const LIGHT = {
  bg:           '#faf7f2',           // warm paper
  bgElevated:   '#fdfaf3',           // cards
  bgSunken:     '#f0e9d8',           // inputs / sticky surfaces
  border:       'rgba(26,22,18,0.10)',
  borderStrong: 'rgba(26,22,18,0.20)',
  hairline:     'rgba(26,22,18,0.06)',
  text1:        '#1a1612',           // warm ink
  text2:        '#3a3226',
  text3:        '#6b5d4a',           // 4.7:1 on bg
  text4:        '#8a7a64',
  inputBg:      '#ffffff',
  inputBorder:  'rgba(26,22,18,0.16)',
  accent:       '#9a6b1a',           // warm brass · 5.0:1 on bg
  accentInk:    '#faf7f2',
  accentTint:   'rgba(154,107,26,0.08)',
  accentBorder: 'rgba(154,107,26,0.28)',
};

// Typography — Fraunces is loaded by index.html. Plex Mono via Google CDN.
const SERIF = '"Fraunces", "Iowan Old Style", Palatino, Georgia, serif';
const SANS  = '"Inter", -apple-system, BlinkMacSystemFont, sans-serif';
const MONO  = '"JetBrains Mono", "IBM Plex Mono", "SF Mono", Menlo, monospace';

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

  // Reusable style helpers — honest cards, no glass smudge in light mode.
  const card = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: C.bgElevated,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    ...extra,
  });

  const eyebrow: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: C.text3,
  };

  const sectionLabel: React.CSSProperties = {
    ...eyebrow,
    color: C.accent,
    marginBottom: 14,
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, overflowY: 'auto',
      background: C.bg, color: C.text1,
      fontFamily: SANS,
      transition: 'background 0.3s, color 0.3s',
    }}>

      {/* ══════ NAV — plain text, no glass pill ══════ */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: dark ? 'rgba(10,10,15,0.78)' : 'rgba(250,247,242,0.82)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${C.hairline}`,
      }}>
        <div style={{
          maxWidth: 1120, margin: '0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px',
        }}>
          {/* Wordmark — no logo box, no gradient. The product is named Aligned. */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
            <span style={{
              fontFamily: SERIF, fontSize: 19, fontWeight: 600,
              letterSpacing: '-0.02em', color: C.text1,
            }}>
              Aligned
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
            <a href="#features" style={{ ...eyebrow, color: C.text3, textDecoration: 'none' }}>Product</a>
            <a href="#sarvam"   style={{ ...eyebrow, color: C.text3, textDecoration: 'none' }}>Languages</a>

            {/* Theme toggle — quiet, no accent fill */}
            <button onClick={() => setDark(d => !d)}
              title={dark ? 'Light mode' : 'Dark mode'}
              style={{
                width: 30, height: 30, borderRadius: 6,
                background: 'transparent', border: `1px solid ${C.border}`,
                cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center', color: C.text3,
              }}>
              {dark
                ? <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
                : <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
              }
            </button>

            <button onClick={onGetStarted}
              style={{ ...eyebrow, color: C.text3, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Sign In
            </button>
            <button onClick={onGetStarted}
              style={{
                ...eyebrow,
                color: C.accent,
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              }}>
              Get Aligned →
            </button>
          </div>
        </div>
      </nav>

      {/* ══════ HERO — Fraunces sentence, no bouncing pill, no 3-stop gradient ══════ */}
      <section style={{ position: 'relative', padding: '96px 24px 72px', zIndex: 10 }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>

          {/* Typeset eyebrow — replaces the bouncing 🚀 emoji pill */}
          <div style={{ ...sectionLabel, marginBottom: 28 }}>
            Workspace Intelligence · Now in 10 Indian languages
          </div>

          {/* Headline — verb-led, Fraunces, italic accent on the payoff word */}
          <h1 style={{
            fontFamily: SERIF,
            fontSize: 'clamp(44px, 7.5vw, 76px)',
            fontWeight: 500,
            letterSpacing: '-0.035em',
            lineHeight: 1.02,
            marginBottom: 28,
            color: C.text1,
            textWrap: 'balance' as React.CSSProperties['textWrap'],
          }}>
            Capture the chaos.<br/>
            Deliver the{' '}
            <span style={{ fontStyle: 'italic', color: C.accent }}>strategy.</span>
          </h1>

          {/* Subhead — specific, leads with the verb */}
          <p style={{
            fontFamily: SERIF, fontSize: 'clamp(18px, 2vw, 22px)', fontWeight: 400,
            fontStyle: 'italic',
            lineHeight: 1.5, color: C.text2,
            maxWidth: 620, marginBottom: 14,
          }}>
            Walk out of the meeting with the memo already written.
          </p>
          <p style={{
            fontSize: 15, color: C.text3, lineHeight: 1.7,
            maxWidth: 580, marginBottom: 44,
          }}>
            Aligned records, transcribes, and turns the conversation into action items,
            a one-page summary, and a strategy brief — in 10 Indian languages.
          </p>

          {/* CTAs — solid ink button, not a gradient */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 40 }}>
            <button onClick={onGetStarted}
              style={{
                padding: '13px 22px', borderRadius: 8,
                background: C.text1, color: C.bg,
                fontFamily: SANS, fontWeight: 600, fontSize: 14,
                border: 'none', cursor: 'pointer',
                letterSpacing: '-0.01em',
              }}>
              Download for Mac →
            </button>
            <button onClick={onGetStarted}
              style={{
                padding: '13px 22px', borderRadius: 8,
                background: 'transparent', border: `1px solid ${C.border}`,
                color: C.text2,
                fontFamily: SANS, fontWeight: 600, fontSize: 14,
                cursor: 'pointer', letterSpacing: '-0.01em',
              }}>
              Coming to iOS
            </button>
          </div>

          {/* Trust strip — typeset, no shouty rocket */}
          <div style={{
            paddingTop: 28, borderTop: `1px dashed ${C.border}`,
            display: 'flex', flexWrap: 'wrap', gap: 22,
            ...eyebrow,
            color: C.text4,
          }}>
            <span>Gemini 2.5</span>
            <span>·</span>
            <span>Sarvam AI</span>
            <span>·</span>
            <span>Privacy-first</span>
            <span>·</span>
            <span>Offline recovery</span>
          </div>
        </div>
      </section>

      {/* ══════ PRODUCT MOCK — honest screenshot of new Home, not a recording placeholder ══════ */}
      <section style={{ position: 'relative', padding: '20px 24px 80px', zIndex: 10 }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          <div style={{
            ...card({ padding: 0, overflow: 'hidden' }),
            boxShadow: dark
              ? '0 30px 80px rgba(0,0,0,0.5)'
              : '0 30px 80px rgba(26,22,18,0.10)',
          }}>
            {/* Mock window chrome */}
            <div style={{
              padding: '10px 14px',
              borderBottom: `1px solid ${C.hairline}`,
              display: 'flex', alignItems: 'center', gap: 6,
              fontFamily: MONO, fontSize: 11, color: C.text4,
            }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: C.border }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: C.border }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: C.border }} />
              <span style={{ marginLeft: 14 }}>aligned · home</span>
            </div>

            {/* Mock content — mirrors HomeView */}
            <div style={{ padding: '40px 44px 36px' }}>
              <div style={{ ...eyebrow, marginBottom: 4 }}>Thursday · 25 Apr</div>
              <h3 style={{
                fontFamily: SERIF, fontSize: 30, fontWeight: 500,
                letterSpacing: '-0.03em', lineHeight: 1.05,
                color: C.text1, margin: '0 0 4px',
              }}>
                Three threads still <span style={{ fontStyle: 'italic', color: C.accent }}>open.</span>
              </h3>
              <p style={{ fontSize: 13, color: C.text3, margin: '0 0 28px' }}>
                From Tuesday's standup and last Friday.
              </p>

              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0,
                borderTop: `1px solid ${C.hairline}`,
                borderBottom: `1px solid ${C.hairline}`,
              }}>
                {[
                  { num: '03',   label: 'Open' },
                  { num: '12',   label: 'Sessions · Apr' },
                  { num: '4:12', label: 'Hours' },
                ].map((s, i) => (
                  <div key={s.label} style={{
                    padding: '20px 16px',
                    borderLeft: i > 0 ? `1px solid ${C.hairline}` : 'none',
                  }}>
                    <div style={{
                      fontFamily: SERIF, fontSize: 32, fontWeight: 500,
                      letterSpacing: '-0.03em', color: i === 0 ? C.accent : C.text1,
                      fontVariantNumeric: 'tabular-nums', marginBottom: 4,
                    }}>{s.num}</div>
                    <div style={{ ...eyebrow, color: C.text4 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════ PAIN / SOLUTION — single accent, not amber+red ══════ */}
      <section style={{ position: 'relative', padding: '40px 24px', zIndex: 10 }}>
        <div style={{ maxWidth: 880, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 14 }}>
          <div style={{ ...card(), padding: '28px 32px' }}>
            <div style={{ ...eyebrow, color: C.text4, marginBottom: 18 }}>The problem</div>
            {[
              'You sit through a 1-hour meeting. You remember 20% by evening.',
              'Action items live in your head. Half forgotten by morning.',
              'Attended 4 meetings today. Notes from none of them.',
              'Your team speaks Hindi. Your tool understands nothing.',
            ].map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, marginBottom: i < 3 ? 12 : 0 }}>
                <span style={{ color: C.text4, fontFamily: MONO, fontSize: 12, marginTop: 2, width: 18, flexShrink: 0 }}>0{i + 1}</span>
                <span style={{ fontSize: 13, color: C.text2, lineHeight: 1.6 }}>{t}</span>
              </div>
            ))}
          </div>
          <div style={{ ...card({ borderColor: C.accentBorder, background: C.accentTint }), padding: '28px 32px' }}>
            <div style={{ ...eyebrow, color: C.accent, marginBottom: 18 }}>Aligned changes this</div>
            {[
              'Every meeting captured, transcribed, and summarised automatically.',
              'Action items extracted and tracked — nothing falls through.',
              'Patterns and insights surface across all your sessions.',
              'Native support for Hindi, Marathi, Tamil + 10 more languages.',
            ].map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, marginBottom: i < 3 ? 12 : 0 }}>
                <span style={{ color: C.accent, fontFamily: MONO, fontSize: 12, marginTop: 2, width: 18, flexShrink: 0 }}>→</span>
                <span style={{ fontSize: 13, color: C.text2, lineHeight: 1.6 }}>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════ SARVAM AI ══════ */}
      <section id="sarvam" style={{ position: 'relative', padding: '80px 24px', zIndex: 10 }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>

          <div style={{ marginBottom: 44 }}>
            <div style={sectionLabel}>§ 02 · Built for Bharat</div>
            <h2 style={{
              fontFamily: SERIF, fontSize: 'clamp(30px, 5vw, 48px)', fontWeight: 500,
              letterSpacing: '-0.035em', color: C.text1,
              margin: '0 0 14px', lineHeight: 1.05,
              textWrap: 'balance' as React.CSSProperties['textWrap'],
            }}>
              Your team speaks Hindi.<br/>
              Aligned <span style={{ fontStyle: 'italic', color: C.accent }}>understands.</span>
            </h2>
            <p style={{ fontSize: 15, color: C.text2, maxWidth: 600, lineHeight: 1.65, fontFamily: SERIF, fontStyle: 'italic' }}>
              Powered by Sarvam AI's Saaras v3 — India's most accurate multilingual speech engine.
              Hindi, Marathi, Tamil or Gujarati meetings are captured with the same precision as English.
            </p>
          </div>

          <div style={{ ...card(), padding: '40px 44px', marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 40, alignItems: 'start' }}>
              <div>
                <div style={{ ...eyebrow, color: C.accent, marginBottom: 14 }}>Sarvam AI · Saaras v3</div>
                <p style={{ fontSize: 14, color: C.text2, lineHeight: 1.7, marginBottom: 20 }}>
                  Most meeting tools are built for English-only workplaces. Aligned integrates Sarvam AI's <strong style={{ color: C.text1 }}>Saaras v3</strong> — so your real meetings, in your real languages, are captured with the same precision as English.
                </p>
                <div style={{
                  padding: '14px 16px', borderRadius: 10,
                  background: C.bgSunken, border: `1px solid ${C.hairline}`,
                  fontSize: 12, color: C.text3, lineHeight: 1.55,
                }}>
                  <div style={{ ...eyebrow, color: C.accent, marginBottom: 4, fontSize: 10 }}>Made in India · For India</div>
                  Sarvam AI builds foundational language models for Bharat.
                </div>
              </div>

              {/* Language grid */}
              <div>
                <div style={{ ...eyebrow, color: C.text4, marginBottom: 14 }}>Supported languages</div>
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
                    <div key={l.lang} style={{
                      padding: '10px 12px', borderRadius: 8,
                      background: C.bgSunken, border: `1px solid ${C.hairline}`,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.text1 }}>{l.lang}</div>
                      <div style={{ fontSize: 10, color: C.text4 }}>{l.script}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════ FEATURES — numbered 01/02/03, single accent ══════ */}
      <section id="features" style={{ position: 'relative', padding: '60px 24px', zIndex: 10 }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ marginBottom: 44 }}>
            <div style={sectionLabel}>§ 03 · The product</div>
            <h2 style={{
              fontFamily: SERIF, fontSize: 'clamp(28px, 4.5vw, 42px)', fontWeight: 500,
              letterSpacing: '-0.03em', color: C.text1,
              margin: '0 0 14px', lineHeight: 1.1,
              textWrap: 'balance' as React.CSSProperties['textWrap'],
            }}>
              Three things that make Aligned <span style={{ fontStyle: 'italic', color: C.accent }}>different.</span>
            </h2>
            <p style={{ fontSize: 14, color: C.text3, maxWidth: 540, lineHeight: 1.7 }}>
              Not just a meeting recorder — the intelligence layer across everything you discuss.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 14 }}>
            {[
              {
                num: '01',
                title: 'Multilingual meetings',
                tagline: 'The only tool that speaks India\'s languages',
                desc: 'Switch between Hindi and English mid-sentence. Discuss in Marathi, Tamil, or Gujarati. Aligned captures every word with the same precision as English.',
                points: ['10+ Indian languages', 'Hinglish code-switching aware', 'Native script + English summaries'],
              },
              {
                num: '02',
                title: 'Strategic insights',
                tagline: 'Patterns your team would never notice manually',
                desc: 'Aligned doesn\'t just summarise — it thinks across all your meetings. Surface recurring blockers, track unresolved decisions, and get a strategic view of your work over time.',
                points: ['Cross-session pattern detection', 'Recurring issues flagged', 'Strategic gaps & recommended actions'],
              },
              {
                num: '03',
                title: 'AI-powered chat',
                tagline: 'Ask anything. Get answers from your own meetings.',
                desc: 'Ask Aligned questions across your entire history — "What did we decide about the Chakan timeline?" or "What action items are open from last week?" Instant answers, cited from your own sessions.',
                points: ['Natural language queries', 'Answers cited from your meetings', 'Works across all sessions at once'],
              },
            ].map(f => (
              <div key={f.num} style={{ ...card(), padding: '26px 28px', position: 'relative' }}>
                <div style={{ ...eyebrow, color: C.accent, marginBottom: 14 }}>{f.num}</div>
                <h3 style={{
                  fontFamily: SERIF, fontSize: 22, fontWeight: 500,
                  letterSpacing: '-0.02em', color: C.text1,
                  margin: '0 0 8px', lineHeight: 1.15,
                }}>
                  {f.title}
                </h3>
                <div style={{ fontSize: 12, color: C.text3, fontStyle: 'italic', fontFamily: SERIF, marginBottom: 16, lineHeight: 1.5 }}>
                  {f.tagline}
                </div>
                <p style={{ fontSize: 13, color: C.text2, lineHeight: 1.65, marginBottom: 18 }}>{f.desc}</p>
                {f.points.map(p => (
                  <div key={p} style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                    <span style={{ color: C.accent, fontSize: 11 }}>·</span>
                    <span style={{ fontSize: 12, color: C.text3, lineHeight: 1.55 }}>{p}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Manual entry callout — quieter */}
          <div style={{ ...card(), marginTop: 14, padding: '18px 24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
            <div style={{ ...eyebrow, color: C.text4 }}>Or</div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text1, marginBottom: 3 }}>Missed the recording? Paste your transcript.</div>
              <div style={{ fontSize: 12, color: C.text3 }}>Copy from Teams, Zoom or Google Meet — same structured notes and insights as a live recording.</div>
            </div>
            <button onClick={onGetStarted} style={{
              ...eyebrow, color: C.accent, background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}>Try it →</button>
          </div>
        </div>
      </section>

      {/* ══════ HOW IT WORKS ══════ */}
      <section style={{ position: 'relative', padding: '60px 24px', zIndex: 10 }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <div style={{ marginBottom: 36 }}>
            <div style={sectionLabel}>§ 04 · How it works</div>
            <h2 style={{
              fontFamily: SERIF, fontSize: 'clamp(24px, 4vw, 34px)', fontWeight: 500,
              letterSpacing: '-0.03em', color: C.text1,
              margin: '0 0 8px', lineHeight: 1.1,
            }}>
              From meeting to insights in <span style={{ fontStyle: 'italic', color: C.accent }}>three steps.</span>
            </h2>
            <p style={{ fontSize: 13, color: C.text3 }}>No setup. No integrations. Open Aligned and go.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
            {[
              { title: 'Record or paste',  desc: 'Hit record before your meeting, or paste a transcript you already have. Sarvam handles Hindi, English, or both.' },
              { title: 'Aligned analyses', desc: 'Gemini 2.5 Pro extracts structured notes, action items, key decisions, and follow-ups.' },
              { title: 'Act on insights',  desc: 'Your Home screen shows what needs attention. Ask Intelligence questions across all your meetings.' },
            ].map((s, i) => (
              <div key={s.title} style={{ ...card(), padding: '22px 24px' }}>
                <div style={{ ...eyebrow, color: C.accent, marginBottom: 10 }}>0{i + 1}</div>
                <div style={{
                  fontFamily: SERIF, fontSize: 17, fontWeight: 500,
                  letterSpacing: '-0.02em', color: C.text1, marginBottom: 8,
                }}>{s.title}</div>
                <div style={{ fontSize: 12, color: C.text3, lineHeight: 1.6 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════ WAITLIST ══════ */}
      <section id="waitlist" style={{ position: 'relative', padding: '80px 24px', zIndex: 10 }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <div style={sectionLabel}>§ 05 · Early access</div>
          <h2 style={{
            fontFamily: SERIF, fontSize: 'clamp(30px, 5vw, 46px)', fontWeight: 500,
            letterSpacing: '-0.035em', color: C.text1,
            margin: '0 0 16px', lineHeight: 1.05,
            textWrap: 'balance' as React.CSSProperties['textWrap'],
          }}>
            Be among the first<br/>
            to use <span style={{ fontStyle: 'italic', color: C.accent }}>Aligned.</span>
          </h2>
          <p style={{ fontSize: 14, color: C.text2, lineHeight: 1.7, marginBottom: 28, maxWidth: 480 }}>
            Join 200+ professionals on the waitlist. Every early-access member gets{' '}
            <strong style={{ color: C.text1 }}>1 month of free Pro access</strong> — no conditions, automatically applied at sign-up.
          </p>

          {submitted ? (
            <div style={{ ...card(), padding: '32px', textAlign: 'left' }}>
              <div style={{ ...eyebrow, color: C.accent, marginBottom: 8 }}>You're on the list</div>
              <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 500, color: C.text1, marginBottom: 6, letterSpacing: '-0.02em' }}>
                Thanks for signing up.
              </div>
              <div style={{ fontSize: 13, color: C.text3, marginBottom: 18 }}>
                We'll reach out with early-access details soon.
              </div>
              <button onClick={onGetStarted}
                style={{
                  padding: '11px 20px', borderRadius: 8,
                  background: C.text1, color: C.bg,
                  fontFamily: SANS, fontWeight: 600, fontSize: 13,
                  border: 'none', cursor: 'pointer',
                }}>
                Try it now →
              </button>
            </div>
          ) : (
            <form onSubmit={handleJoin} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxWidth: 460 }}>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                style={{
                  flex: 1, minWidth: 220, padding: '13px 16px', borderRadius: 8,
                  background: C.inputBg, border: `1px solid ${C.inputBorder}`,
                  color: C.text1, fontSize: 14, fontFamily: SANS, outline: 'none',
                }}
              />
              <button type="submit" disabled={busy}
                style={{
                  padding: '13px 22px', borderRadius: 8,
                  background: C.text1, color: C.bg,
                  fontFamily: SANS, fontWeight: 600, fontSize: 14,
                  border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap',
                }}>
                {busy ? 'Joining…' : 'Get early access'}
              </button>
            </form>
          )}

          <p style={{ fontSize: 12, color: C.text4, marginTop: 14 }}>No spam. No credit card. Unsubscribe anytime.</p>

          <div style={{ marginTop: 36, paddingTop: 24, borderTop: `1px solid ${C.hairline}` }}>
            <button onClick={onGetStarted} style={{
              ...eyebrow, color: C.accent, background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}>
              Already have an account · Sign in →
            </button>
          </div>
        </div>
      </section>

      {/* ══════ FOOTER ══════ */}
      <footer style={{
        position: 'relative', padding: '32px 24px', borderTop: `1px solid ${C.hairline}`, zIndex: 10,
      }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 20 }}>
          <div style={{
            fontFamily: SERIF, fontSize: 16, fontWeight: 500,
            letterSpacing: '-0.02em', color: C.text1,
          }}>
            Aligned
          </div>
          <div style={{ ...eyebrow, color: C.text4, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>Gemini 2.5</span>
            <span>·</span>
            <span>Sarvam AI</span>
            <span>·</span>
            <span>Supabase</span>
          </div>
          <div style={{ fontSize: 12, color: C.text4 }}>© 2026 Aligned · Made in India</div>
        </div>
      </footer>

    </div>
  );
};

export default LandingPage;
