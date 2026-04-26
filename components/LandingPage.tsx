import React, { useState } from 'react';

interface LandingPageProps {
  onGetStarted: () => void;
}

// ─── Granola-warm tokens (self-contained, no CSS variables) ──────────────
// Dark mode is unchanged; this component is light-mode marketing only.
const C = {
  bg:           '#f7f5ef',
  bgAlt:        '#efece3',
  surface:      '#ffffff',
  text:         '#1c1d1a',
  textMuted:    '#6a6c64',
  textFaint:    '#9b9d93',
  rule:         'rgba(28, 29, 26, 0.07)',
  ruleStrong:   'rgba(28, 29, 26, 0.10)',
  accent:       '#4a6b3a',           // deep olive
  accent2:      '#d97757',           // terra warm
  accentSoft:   'rgba(74, 107, 58, 0.10)',
  accent2Soft:  'rgba(217, 119, 87, 0.12)',
};

const DISPLAY = '"DM Sans", "Inter", system-ui, -apple-system, sans-serif';
const MONO    = '"JetBrains Mono", "IBM Plex Mono", "SF Mono", Menlo, monospace';

const LandingPage: React.FC<LandingPageProps> = ({ onGetStarted }) => {
  const [email, setEmail]         = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy]           = useState(false);

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

  // Reusable bits
  const pill = (extra?: React.CSSProperties): React.CSSProperties => ({
    borderRadius: 100,
    ...extra,
  });

  const ctaPrimary: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '13px 22px', borderRadius: 100,
    background: C.text, color: 'white',
    fontFamily: DISPLAY, fontWeight: 500, fontSize: 14.5,
    border: 'none', cursor: 'pointer',
  };
  const ctaSecondary: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '13px 22px', borderRadius: 100,
    background: C.bg, color: C.text,
    fontFamily: DISPLAY, fontWeight: 500, fontSize: 14.5,
    border: `1px solid ${C.ruleStrong}`, cursor: 'pointer',
    textDecoration: 'none',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, overflowY: 'auto',
      background: C.bg, color: C.text,
      fontFamily: DISPLAY,
    }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '18px 22px 80px' }}>

        {/* ══════ Pill nav ══════ */}
        <nav style={{
          ...pill(),
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 22px',
          background: C.bgAlt,
          fontSize: 14, marginBottom: 56,
        }}>
          {/* Logo: olive square with bg-color hole */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, letterSpacing: '-0.01em' }}>
            <span style={{
              width: 24, height: 24, borderRadius: 8,
              background: C.accent, position: 'relative', display: 'inline-block',
            }}>
              <span style={{
                position: 'absolute', inset: 6, borderRadius: '50%', background: C.bgAlt,
              }} />
            </span>
            <span>Aligned</span>
          </div>
          {/* Center links */}
          <div style={{ display: 'flex', gap: 26, color: C.textMuted }}>
            <a style={{ cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}>Product</a>
            <a style={{ cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}>Pricing</a>
            <a style={{ cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}>Customers</a>
            <a style={{ cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}>Changelog</a>
          </div>
          {/* Right CTAs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <a onClick={onGetStarted} style={{ color: C.textMuted, cursor: 'pointer' }}>Sign in</a>
            <button onClick={onGetStarted} style={{
              ...pill({ padding: '9px 18px', background: C.text, color: 'white',
                       fontWeight: 500, fontSize: 14, border: 'none', cursor: 'pointer',
                       fontFamily: DISPLAY }),
            }}>
              Download
            </button>
          </div>
        </nav>

        {/* ══════ Hero ══════ */}
        <div style={{ textAlign: 'center', maxWidth: 740, margin: '0 auto', padding: '0 24px' }}>
          {/* Olive-soft kicker pill */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '7px 14px', borderRadius: 100,
            background: C.accentSoft, color: C.accent,
            fontSize: 12.5, fontWeight: 500, marginBottom: 28,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.accent }} />
            <span>Workspace intelligence · Now in 10 Indian languages</span>
          </div>

          <h1 style={{
            fontFamily: DISPLAY,
            fontSize: 'clamp(48px, 7vw, 80px)',
            lineHeight: 1.0, letterSpacing: '-0.035em',
            fontWeight: 600, margin: '0 0 24px', color: C.text,
          }}>
            <span style={{ display: 'block' }}>Capture the chaos.</span>
            <span style={{ display: 'block' }}>
              Deliver the <em style={{ fontStyle: 'italic', color: C.accent, fontWeight: 500 }}>strategy</em>.
            </span>
          </h1>

          <p style={{
            fontSize: 18, lineHeight: 1.55, color: C.textMuted,
            maxWidth: 540, margin: '0 auto 30px',
          }}>
            Aligned records, transcribes, and turns the conversation into
            action items, a one-page summary, and a strategy brief.
          </p>

          {/* CTA row */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
            <button onClick={onGetStarted} style={ctaPrimary}>Download for Mac</button>
            <a href="#demo" style={ctaSecondary}>Watch a 90-sec demo →</a>
          </div>

          {/* Meta */}
          <div style={{
            display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap',
            fontSize: 12.5, color: C.textFaint,
          }}>
            <span>macOS 13+ · 28 MB</span>
            <span>·</span>
            <span>Free for personal use</span>
            <span>·</span>
            <span>SOC 2 Type II</span>
          </div>
        </div>

        {/* ══════ Product mock screenshot ══════ */}
        <div style={{ margin: '56px auto 0', maxWidth: 1080 }}>
          <div style={{
            borderRadius: 20, overflow: 'hidden',
            background: C.bg, border: `1px solid ${C.ruleStrong}`,
            boxShadow:
              '0 30px 60px -28px rgba(28, 29, 26, 0.20), ' +
              '0 12px 28px -12px rgba(28, 29, 26, 0.12)',
          }}>
            {/* Mac window chrome */}
            <div style={{
              padding: '12px 16px',
              borderBottom: `1px solid ${C.ruleStrong}`,
              background: C.bgAlt,
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 12, color: C.textMuted,
            }}>
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57' }} />
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e' }} />
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840' }} />
              <span style={{ marginLeft: 'auto', marginRight: 'auto', fontWeight: 500 }}>
                Aligned · Strategy Sync · Apr 25
              </span>
            </div>

            {/* Body: 2-col */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'minmax(280px, 1.1fr) 1fr',
              background: C.surface,
            }}>
              {/* Action items */}
              <div style={{ padding: '22px 24px', borderRight: `1px solid ${C.rule}` }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '5px 12px', borderRadius: 100,
                  background: C.accent2Soft, color: '#b85a3c',
                  fontSize: 11.5, fontWeight: 600, marginBottom: 16,
                }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', background: C.accent2,
                    boxShadow: '0 0 0 3px rgba(217, 119, 87, 0.20)',
                  }} />
                  Recording · 32:14
                </div>
                <div style={{
                  fontSize: 11, fontFamily: MONO, letterSpacing: '0.14em',
                  textTransform: 'uppercase', color: C.textFaint, marginBottom: 12,
                }}>
                  Action items
                </div>
                {[
                  'Send revised pricing model to Priya by Friday',
                  'Draft Q3 OKR brief — owner: Anika',
                  'Loop in legal on data residency clause',
                  'Schedule follow-up with the Chennai team',
                ].map((t, i, arr) => (
                  <div key={i} style={{
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                    padding: '9px 0', fontSize: 13.5, color: C.text,
                    borderBottom: i < arr.length - 1 ? `1px solid ${C.rule}` : 'none',
                  }}>
                    <span style={{
                      width: 16, height: 16, borderRadius: '50%',
                      border: `1.5px solid ${C.ruleStrong}`,
                      flexShrink: 0, marginTop: 1,
                    }} />
                    <span>{t}</span>
                  </div>
                ))}
              </div>
              {/* Summary */}
              <div style={{ padding: '22px 24px' }}>
                <div style={{
                  fontSize: 11, fontFamily: MONO, letterSpacing: '0.14em',
                  textTransform: 'uppercase', color: C.textFaint, marginBottom: 12,
                }}>
                  Summary
                </div>
                <p style={{ fontSize: 13.5, lineHeight: 1.55, color: C.text, margin: '0 0 14px' }}>
                  The team agreed to ship the pricing v2 by EOQ, contingent on
                  legal sign-off on data residency. Anika owns the OKR draft;
                  Priya delivers the model on Friday.
                </p>
                <div style={{
                  display: 'inline-block', marginRight: 8, marginBottom: 6,
                  padding: '4px 10px', borderRadius: 100,
                  background: C.accent2Soft, color: '#b85a3c',
                  fontSize: 11.5, fontWeight: 500,
                }}>
                  Decision · pricing v2 timeline
                </div>
                <div style={{
                  display: 'inline-block', marginRight: 8, marginBottom: 6,
                  padding: '4px 10px', borderRadius: 100,
                  background: C.accentSoft, color: C.accent,
                  fontSize: 11.5, fontWeight: 500,
                }}>
                  Risk · legal review window
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ══════ Languages strip (Sarvam) ══════ */}
        <section id="languages" style={{ margin: '96px auto 0', maxWidth: 880 }}>
          <div style={{
            ...pill({ background: C.accent2Soft, color: '#b85a3c' }),
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 14px', fontSize: 11.5, fontWeight: 600, marginBottom: 20,
          }}>
            <span>Built for Bharat</span>
          </div>
          <h2 style={{
            fontFamily: DISPLAY, fontSize: 'clamp(30px, 4.5vw, 44px)',
            fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.1,
            margin: '0 0 14px', color: C.text,
          }}>
            Your team speaks Hindi.{' '}
            <em style={{ fontStyle: 'italic', color: C.accent, fontWeight: 500 }}>Aligned understands.</em>
          </h2>
          <p style={{ fontSize: 16, color: C.textMuted, lineHeight: 1.65, maxWidth: 620, margin: '0 0 28px' }}>
            Powered by Sarvam AI's Saaras v3 — India's most accurate multilingual speech engine.
            Hindi, Marathi, Tamil or Gujarati meetings are captured with the same precision as English.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
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
                padding: '10px 12px', borderRadius: 12,
                background: C.surface, border: `1px solid ${C.rule}`,
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{l.lang}</div>
                <div style={{ fontSize: 10.5, color: C.textFaint }}>{l.script}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ══════ How it works — 3 steps ══════ */}
        <section style={{ margin: '80px auto 0', maxWidth: 880 }}>
          <h2 style={{
            fontFamily: DISPLAY, fontSize: 'clamp(26px, 4vw, 36px)',
            fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.1,
            margin: '0 0 8px', color: C.text,
          }}>
            From meeting to insights in <em style={{ fontStyle: 'italic', color: C.accent, fontWeight: 500 }}>three steps</em>.
          </h2>
          <p style={{ fontSize: 13.5, color: C.textMuted, marginBottom: 28 }}>
            No setup. No integrations. Open Aligned and go.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            {[
              { title: 'Record or paste',  desc: 'Hit record before your meeting, or paste a transcript you already have. Sarvam handles Hindi, English, or both.' },
              { title: 'Aligned analyses', desc: 'Gemini 2.5 Pro extracts structured notes, action items, key decisions, and follow-ups.' },
              { title: 'Act on insights',  desc: 'Your Home screen shows what needs attention. Ask Intelligence questions across all your meetings.' },
            ].map((s, i) => (
              <div key={s.title} style={{
                padding: '22px 24px', borderRadius: 16,
                background: C.surface, border: `1px solid ${C.rule}`,
              }}>
                <div style={{
                  fontSize: 11, fontFamily: MONO, letterSpacing: '0.14em',
                  textTransform: 'uppercase', color: C.accent, marginBottom: 10,
                }}>
                  0{i + 1}
                </div>
                <div style={{
                  fontFamily: DISPLAY, fontSize: 17, fontWeight: 600,
                  letterSpacing: '-0.02em', color: C.text, marginBottom: 8,
                }}>
                  {s.title}
                </div>
                <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>
                  {s.desc}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ══════ Waitlist ══════ */}
        <section id="waitlist" style={{ margin: '96px auto 0', maxWidth: 580 }}>
          <h2 style={{
            fontFamily: DISPLAY, fontSize: 'clamp(28px, 4.5vw, 42px)',
            fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.05,
            margin: '0 0 14px', color: C.text,
          }}>
            Be among the first to use{' '}
            <em style={{ fontStyle: 'italic', color: C.accent, fontWeight: 500 }}>Aligned</em>.
          </h2>
          <p style={{ fontSize: 14.5, color: C.textMuted, lineHeight: 1.65, marginBottom: 24 }}>
            Join 200+ professionals on the waitlist. Every early-access member gets{' '}
            <strong style={{ color: C.text }}>1 month of free Pro access</strong>.
          </p>

          {submitted ? (
            <div style={{
              padding: '24px 28px', borderRadius: 16,
              background: C.surface, border: `1px solid ${C.rule}`,
            }}>
              <div style={{
                fontFamily: MONO, fontSize: 11, letterSpacing: '0.14em',
                textTransform: 'uppercase', color: C.accent, marginBottom: 8,
              }}>You're on the list</div>
              <div style={{
                fontFamily: DISPLAY, fontSize: 22, fontWeight: 600,
                letterSpacing: '-0.02em', color: C.text, marginBottom: 6,
              }}>
                Thanks for signing up.
              </div>
              <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 18 }}>
                We'll reach out with early-access details soon.
              </div>
              <button onClick={onGetStarted} style={ctaPrimary}>Try it now →</button>
            </div>
          ) : (
            <form onSubmit={handleJoin} style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                style={{
                  flex: 1, minWidth: 220, padding: '13px 18px', borderRadius: 100,
                  background: C.surface, border: `1px solid ${C.ruleStrong}`,
                  color: C.text, fontSize: 14, fontFamily: DISPLAY, outline: 'none',
                }}
              />
              <button type="submit" disabled={busy} style={{
                ...ctaPrimary,
                opacity: busy ? 0.6 : 1, cursor: busy ? 'not-allowed' : 'pointer',
              }}>
                {busy ? 'Joining…' : 'Get early access'}
              </button>
            </form>
          )}

          <p style={{ fontSize: 12, color: C.textFaint, marginTop: 14 }}>
            No spam. No credit card. Unsubscribe anytime.
          </p>
        </section>

        {/* ══════ Footer ══════ */}
        <footer style={{
          marginTop: 80, paddingTop: 28,
          borderTop: `1px solid ${C.rule}`,
          display: 'flex', flexWrap: 'wrap', alignItems: 'baseline',
          justifyContent: 'space-between', gap: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 22, height: 22, borderRadius: 7,
              background: C.accent, position: 'relative', display: 'inline-block',
            }}>
              <span style={{ position: 'absolute', inset: 6, borderRadius: '50%', background: C.bg }} />
            </span>
            <span style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 600, color: C.text }}>
              Aligned
            </span>
          </div>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 14,
            fontSize: 11, fontFamily: MONO, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: C.textFaint,
          }}>
            <span>Gemini 2.5</span>
            <span>·</span>
            <span>Sarvam AI</span>
            <span>·</span>
            <span>Supabase</span>
          </div>
          <div style={{ fontSize: 12, color: C.textFaint }}>
            © 2026 Aligned · Made in India
          </div>
        </footer>
      </div>
    </div>
  );
};

export default LandingPage;
