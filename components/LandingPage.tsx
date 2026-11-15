import React from 'react';
import { BILLING_ENABLED } from '../config/features';
import { TIERS } from '../config/tiers';
import { TIER_CARDS } from '../config/plans';
import { LANGUAGES } from '../config/languages';
import { FAQ } from '../config/faq';
import {
  SUPPORT_EMAIL, SUPPORT_MAILTO, SUPPORT_REPLY_PROMISE, SUPPORT_WHATSAPP_URL, splitOnSupportEmail,
} from '../config/support';

interface LandingPageProps {
  /** New visitor — opens the auth screen on Sign up. */
  onGetStarted: () => void;
  /** Returning user — opens the auth screen on Sign in. */
  onSignIn: () => void;
}

// ─── Olive-editorial tokens (true white, mirrors index.html .light) ─────
// Self-contained — landing is light-mode marketing only.
const C = {
  bg:           '#ffffff',           // true white page
  bgAlt:        '#f5f5f7',           // Apple-grey sunken
  surface:      '#ffffff',
  text:         '#1c1d20',           // cool ink
  textMuted:    '#6a6c72',           // 4.6:1 on white
  textFaint:    '#9b9da3',
  rule:         'rgba(28, 29, 32, 0.07)',
  ruleStrong:   'rgba(28, 29, 32, 0.10)',
  accent:       '#4a6b3a',           // deep olive
  accent2:      '#d97757',           // terra warm
  accentSoft:   'rgba(74, 107, 58, 0.10)',
  accent2Soft:  'rgba(217, 119, 87, 0.12)',
};

const DISPLAY = '"DM Sans", "Inter", system-ui, -apple-system, sans-serif';
const MONO    = '"JetBrains Mono", "IBM Plex Mono", "SF Mono", Menlo, monospace';

// ─── Pricing cards — numbers come from config/tiers + config/plans ─────
const hoursCount = (minutes: number) => String(Math.round((minutes / 60) * 10) / 10);
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

interface PricingPlan {
  name: string;
  price: string;
  annual?: string;   // Pro only: annual price shown as a small line
  hours: string;
  line: string;
  cta: string;
  popular?: boolean;
}

const PRICING_PLANS: PricingPlan[] = [
  {
    name: 'Free',
    price: inr(0),
    hours: `${hoursCount(TIERS.free.monthlyMinutes)} hours / month`,
    line: `${hoursCount(TIERS.free.monthlyMinutes)} hours every month, free`,
    cta: 'Start free',
  },
  ...(['lite', 'plus', 'pro', 'max'] as const).map((t): PricingPlan => {
    const card = TIER_CARDS[t];
    return {
      name: card.name,
      price: inr(card.monthlyPriceInr),
      annual: card.annualPriceInr != null ? inr(card.annualPriceInr) : undefined,
      hours: `${hoursCount(TIERS[t].monthlyMinutes)} hours / month`,
      // Lite/Plus: their one-line description; Pro/Max: existing copy.
      line: card.tagline ?? (t === 'pro'
        ? 'For heavy weekly use · Strategist & Intelligence chat'
        : 'Best for daily, back-to-back recording'),
      cta: 'Sign up to subscribe',
      popular: card.mostPopular,
    };
  }),
];

// Renders text with the support email turned into a mailto link.
const withEmailLink = (text: string) => splitOnSupportEmail(text).map((part, i) =>
  i % 2 === 1
    ? <a key={i} href={SUPPORT_MAILTO} style={{ color: C.accent, fontWeight: 500 }}>{part}</a>
    : <React.Fragment key={i}>{part}</React.Fragment>,
);

const LandingPage: React.FC<LandingPageProps> = ({ onGetStarted, onSignIn }) => {
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
      <style>{`
        @media (max-width: 640px) { .lp-navlinks { display: none !important; } }
        .lp-faq summary { list-style: none; }
        .lp-faq summary::-webkit-details-marker { display: none; }
        .lp-faq[open] .lp-faq-sign { transform: rotate(45deg); }
      `}</style>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '18px 16px 80px' }}>

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
          {/* Center links (hidden on phones — see the <style> above) */}
          <div className="lp-navlinks" style={{ display: 'flex', gap: 26, color: C.textMuted }}>
            <a href="#languages" style={{ cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}>Languages</a>
            {BILLING_ENABLED && (
              <a href="#pricing" style={{ cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}>Pricing</a>
            )}
            <a href="#faq" style={{ cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}>FAQ</a>
          </div>
          {/* Right CTAs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <a onClick={onSignIn} style={{ color: C.textMuted, cursor: 'pointer' }}>Sign in</a>
            <button onClick={onGetStarted} style={{
              ...pill({ padding: '9px 18px', background: C.text, color: 'white',
                       fontWeight: 500, fontSize: 14, border: 'none', cursor: 'pointer',
                       fontFamily: DISPLAY }),
            }}>
              Start free
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
            <span>Workspace intelligence · Built for Indian languages</span>
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
            <button onClick={onGetStarted} style={ctaPrimary}>Start for free</button>
            <a href="#faq" style={ctaSecondary}>Questions? Read the FAQ →</a>
          </div>

          {/* Meta */}
          <div style={{
            display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap',
            fontSize: 12.5, color: C.textFaint,
          }}>
            <span>No install · Works in your browser</span>
            <span>·</span>
            <span>Free plan, no credit card</span>
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
            Powered by Sarvam AI's Saaras v3, a speech engine built for Indian languages.
            Speak Hindi, Marathi, Tamil, Gujarati, English, or a mix — Aligned detects the language on its own.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            {LANGUAGES.map(l => (
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
              { title: 'Aligned analyses', desc: 'Gemini 2.5 Flash extracts structured notes, action items, key decisions, and follow-ups.' },
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

        {/* ══════ Pricing (hidden while billing is disabled) ══════ */}
        {BILLING_ENABLED && (
        <section id="pricing" style={{ margin: '80px auto 0', maxWidth: 1040, scrollMarginTop: 80 }}>
          <h2 style={{
            fontFamily: DISPLAY, fontSize: 'clamp(26px, 4vw, 36px)',
            fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.1,
            margin: '0 0 8px', color: C.text,
          }}>
            Start free. <em style={{ fontStyle: 'italic', color: C.accent, fontWeight: 500 }}>Upgrade anytime.</em>
          </h2>
          <p style={{ fontSize: 13.5, color: C.textMuted, marginBottom: 28 }}>
            Free includes {hoursCount(TIERS.free.monthlyMinutes)} hours of audio every month — enough to put Aligned through its paces. Upgrade when you need more.
          </p>
          {/* 3 + 2 on desktop (Free/Lite/Plus, then Pro/Max); stacks on mobile. */}
          {[PRICING_PLANS.slice(0, 3), PRICING_PLANS.slice(3)].map((row, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14,
              ...(i === 1 ? { maxWidth: 694, margin: '14px auto 0' } : {}),
            }}>
              {row.map((p) => (
                <div key={p.name} style={{
                  position: 'relative', display: 'flex', flexDirection: 'column',
                  padding: '24px 26px', borderRadius: 16,
                  background: p.popular ? C.accentSoft : C.surface,
                  border: p.popular ? `1.5px solid ${C.accent}` : `1px solid ${C.rule}`,
                }}>
                  {p.popular && (
                    <span style={{
                      position: 'absolute', top: -10, right: 18,
                      padding: '3px 10px', borderRadius: 999,
                      background: C.accent, color: C.bg,
                      fontSize: 10.5, fontFamily: MONO,
                      letterSpacing: '0.12em', textTransform: 'uppercase',
                      fontWeight: 600,
                    }}>Most popular</span>
                  )}
                  <div style={{
                    fontSize: 11, fontFamily: MONO, letterSpacing: '0.14em',
                    textTransform: 'uppercase', color: C.accent, marginBottom: 10,
                  }}>
                    {p.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                    <span style={{
                      fontFamily: DISPLAY, fontSize: 36, fontWeight: 600,
                      letterSpacing: '-0.03em', color: C.text,
                    }}>{p.price}</span>
                    <span style={{ fontSize: 13, color: C.textMuted }}>per month</span>
                  </div>
                  {p.annual && (
                    <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 6 }}>
                      or {p.annual}/year — <span style={{ color: C.accent, fontWeight: 600 }}>2 months free</span>
                    </div>
                  )}
                  <div style={{
                    fontFamily: DISPLAY, fontSize: 15, fontWeight: 600,
                    color: C.text, margin: '8px 0 4px',
                  }}>
                    {p.hours}
                  </div>
                  <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.6, flex: 1 }}>
                    {p.line}
                  </div>
                  <button onClick={onGetStarted} style={{
                    marginTop: 20, width: '100%', padding: '10px 14px',
                    borderRadius: 12, cursor: 'pointer',
                    border: p.popular ? 'none' : `1px solid ${C.ruleStrong}`,
                    background: p.popular ? C.accent : C.surface,
                    color: p.popular ? C.bg : C.text,
                    fontSize: 13.5, fontWeight: 600,
                    fontFamily: DISPLAY,
                  }}>{p.cta}</button>
                </div>
              ))}
            </div>
          ))}
          <p style={{ fontSize: 12, color: C.textMuted, marginTop: 16, textAlign: 'center' }}>
            Payments processed by Razorpay · Cancel anytime — keep access until period ends
          </p>
        </section>
        )}

        {/* ══════ Privacy — how we treat your audio ══════ */}
        <section style={{ margin: '80px auto 0', maxWidth: 880 }}>
          <h2 style={{
            fontFamily: DISPLAY, fontSize: 'clamp(26px, 4vw, 36px)',
            fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.1,
            margin: '0 0 8px', color: C.text,
          }}>
            Your audio <em style={{ fontStyle: 'italic', color: C.accent, fontWeight: 500 }}>doesn't stick around</em>.
          </h2>
          <p style={{ fontSize: 13.5, color: C.textMuted, marginBottom: 28 }}>
            We keep recordings only as long as you actually need them — and not a moment longer.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            {[
              {
                tag: 'On success',
                title: 'Deleted the moment your notes are ready',
                desc: 'Once Aligned has extracted notes, action items, and decisions, the audio file is removed from our servers. The transcript and notes stay — the raw audio goes.',
              },
              {
                tag: 'On failure',
                title: 'Kept for 30 days so Retry just works',
                desc: 'If processing fails, or parts of the audio were unclear, it is held so you can tap Retry from any device, not just the one you recorded on. After 30 days it auto-deletes — even if you forget about it.',
              },
              {
                tag: 'On delete',
                title: 'Gone the instant you delete the session',
                desc: 'Delete a session and its audio archive is removed from storage in the same step. If that cleanup ever fails, the app surfaces the error so nothing lingers silently.',
              },
            ].map((s) => (
              <div key={s.title} style={{
                padding: '22px 24px', borderRadius: 16,
                background: C.surface, border: `1px solid ${C.rule}`,
              }}>
                <div style={{
                  fontSize: 11, fontFamily: MONO, letterSpacing: '0.14em',
                  textTransform: 'uppercase', color: C.accent, marginBottom: 10,
                }}>
                  {s.tag}
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

        {/* ══════ FAQ ══════ */}
        <section id="faq" style={{ margin: '80px auto 0', maxWidth: 880, scrollMarginTop: 80 }}>
          <h2 style={{
            fontFamily: DISPLAY, fontSize: 'clamp(26px, 4vw, 36px)',
            fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.1,
            margin: '0 0 8px', color: C.text,
          }}>
            Questions, <em style={{ fontStyle: 'italic', color: C.accent, fontWeight: 500 }}>answered</em>.
          </h2>
          <p style={{ fontSize: 13.5, color: C.textMuted, marginBottom: 28 }}>
            The things people ask us most.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {FAQ.map(item => (
              <details key={item.q} className="lp-faq" style={{
                borderRadius: 14, background: C.surface, border: `1px solid ${C.rule}`,
              }}>
                <summary style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                  padding: '16px 20px', cursor: 'pointer',
                  fontFamily: DISPLAY, fontSize: 15, fontWeight: 600, color: C.text,
                }}>
                  <span>{item.q}</span>
                  <span className="lp-faq-sign" style={{
                    flexShrink: 0, fontSize: 20, lineHeight: 1, color: C.accent,
                    transition: 'transform 0.15s ease',
                  }}>+</span>
                </summary>
                <div style={{ padding: '0 20px 18px', fontSize: 13.5, color: C.textMuted, lineHeight: 1.65 }}>
                  {withEmailLink(item.a)}
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* ══════ Support ══════ */}
        <section id="support" style={{ margin: '56px auto 0', maxWidth: 880 }}>
          <div style={{
            padding: '24px 26px', borderRadius: 16,
            background: C.bgAlt,
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16,
          }}>
            <div>
              <div style={{
                fontFamily: DISPLAY, fontSize: 17, fontWeight: 600,
                letterSpacing: '-0.02em', color: C.text, marginBottom: 4,
              }}>
                Still have a question?
              </div>
              <div style={{ fontSize: 13, color: C.textMuted }}>
                Write to us at{' '}
                <a href={SUPPORT_MAILTO} style={{ color: C.accent, fontWeight: 500 }}>{SUPPORT_EMAIL}</a>.{' '}
                {SUPPORT_REPLY_PROMISE}
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <a href={SUPPORT_MAILTO} style={ctaSecondary}>Email us</a>
              {SUPPORT_WHATSAPP_URL && (
                <a href={SUPPORT_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" style={ctaSecondary}>
                  WhatsApp us
                </a>
              )}
            </div>
          </div>
        </section>

        {/* ══════ Start free ══════ */}
        <section style={{ margin: '96px auto 0', maxWidth: 580, textAlign: 'center' }}>
          <h2 style={{
            fontFamily: DISPLAY, fontSize: 'clamp(28px, 4.5vw, 42px)',
            fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.05,
            margin: '0 0 14px', color: C.text,
          }}>
            Try <em style={{ fontStyle: 'italic', color: C.accent, fontWeight: 500 }}>Aligned</em> free today.
          </h2>
          <p style={{ fontSize: 14.5, color: C.textMuted, lineHeight: 1.65, marginBottom: 24 }}>
            {hoursCount(TIERS.free.monthlyMinutes)} hours of meetings every month on the Free plan. No credit card needed.
          </p>
          <button onClick={onGetStarted} style={ctaPrimary}>Start free →</button>
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
          <div style={{ fontSize: 12, color: C.textFaint, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <a href={SUPPORT_MAILTO} style={{ color: C.textMuted }}>{SUPPORT_EMAIL}</a>
            <span>·</span>
            <span>© 2026 Aligned · Made in India</span>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default LandingPage;
