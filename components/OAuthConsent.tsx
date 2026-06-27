/**
 * components/OAuthConsent.tsx
 * --------------------------
 * The OAuth 2.1 consent screen, mounted at /oauth/consent (see App.tsx and the
 * vercel.json rewrite that serves index.html there). When Claude connects to the
 * Aligned MCP server, Supabase's OAuth server bounces the signed-in user here
 * with an `?authorization_id=…` so they can approve or deny the connection.
 *
 * Flow (all via supabase.auth.oauth, available when the OAuth 2.1 server is on):
 *   1. Read authorization_id from the URL.
 *   2. If not signed in, show the normal AuthView; resume once a session exists.
 *   3. getAuthorizationDetails(id) → either we must show consent, OR the user
 *      already consented and we just redirect back to the client.
 *   4. approveAuthorization / denyAuthorization → redirect back to the client
 *      (Claude) with an auth code or an access_denied error.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseService';
import AuthView from './AuthView';
import type { User } from '../types';

// Supabase redirects to the Authorization Path with this query param.
const AUTH_ID_PARAM = 'authorization_id';

type Phase = 'loading' | 'need-auth' | 'consent' | 'working' | 'redirecting' | 'error';

interface AuthDetails {
  authorization_id: string;
  redirect_uri: string;
  scope: string;
  client: { id: string; name: string; uri: string; logo_uri: string };
  user: { id: string; email: string };
}

// Friendly labels for the scopes we know about; anything else shows raw.
const SCOPE_LABELS: Record<string, string> = {
  openid: 'Verify your identity',
  profile: 'Read your basic profile',
  email: 'Read your email address',
};

const describeScope = (s: string): string => SCOPE_LABELS[s] ?? s;

const OAuthConsent: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('loading');
  const [details, setDetails] = useState<AuthDetails | null>(null);
  const [error, setError] = useState<string>('');

  const authorizationId =
    new URLSearchParams(window.location.search).get(AUTH_ID_PARAM) ?? '';

  // Pull the authorization request details once we know a session exists. The
  // response is a union: consent-needed (has authorization_id) vs. already
  // consented (just a redirect_url we should follow immediately).
  const loadDetails = useCallback(async () => {
    setPhase('loading');
    const { data, error: err } = await supabase.auth.oauth.getAuthorizationDetails(
      authorizationId
    );
    if (err || !data) {
      setError(err?.message ?? 'Could not load the authorization request.');
      setPhase('error');
      return;
    }
    if ('authorization_id' in data) {
      setDetails(data as AuthDetails);
      setPhase('consent');
    } else {
      // Already consented — bounce straight back to the client.
      setPhase('redirecting');
      window.location.href = data.redirect_url;
    }
  }, [authorizationId]);

  // Decide where to start: bad link → error; no session → sign in; else load.
  useEffect(() => {
    let cancelled = false;

    if (!authorizationId) {
      setError('Missing authorization request. Start the connection from Claude again.');
      setPhase('error');
      return;
    }

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.user) loadDetails();
      else setPhase('need-auth');
    })();

    // If the user signs in on this page, resume the consent flow automatically.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setPhase((p) => (p === 'need-auth' ? 'loading' : p));
        loadDetails();
      }
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, [authorizationId, loadDetails]);

  const decide = useCallback(
    async (approve: boolean) => {
      if (!details) return;
      setPhase('working');
      // Call on the oauth object so `this` stays bound inside auth-js.
      const { data, error: err } = approve
        ? await supabase.auth.oauth.approveAuthorization(details.authorization_id, {
            skipBrowserRedirect: true,
          })
        : await supabase.auth.oauth.denyAuthorization(details.authorization_id, {
            skipBrowserRedirect: true,
          });
      if (err || !data?.redirect_url) {
        setError(err?.message ?? 'Something went wrong recording your choice.');
        setPhase('error');
        return;
      }
      setPhase('redirecting');
      window.location.href = data.redirect_url;
    },
    [details]
  );

  // ─── Sign-in gate ─────────────────────────────────────────────────────────
  // AuthView calls onLogin; the auth listener above then resumes the flow.
  if (phase === 'need-auth') {
    return <AuthView onLogin={(_user: User) => loadDetails()} />;
  }

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-6"
      style={{ background: 'var(--surface-950)', color: 'var(--text-primary)' }}
    >
      <div
        className="w-full max-w-md rounded-3xl p-8 shadow-2xl"
        style={{
          background: 'var(--surface-900)',
          border: '1px solid var(--border-strong, rgba(255,255,255,0.08))',
        }}
      >
        {(phase === 'loading' || phase === 'redirecting' || phase === 'working') && (
          <div className="flex flex-col items-center gap-5 py-8">
            <Spinner />
            <p style={{ color: 'var(--text-secondary)' }} className="text-sm">
              {phase === 'redirecting'
                ? 'Redirecting you back…'
                : phase === 'working'
                ? 'Recording your choice…'
                : 'Loading authorization request…'}
            </p>
          </div>
        )}

        {phase === 'error' && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-2xl"
              style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}
            >
              !
            </div>
            <h1 className="text-lg font-semibold">Authorization failed</h1>
            <p style={{ color: 'var(--text-secondary)' }} className="text-sm">
              {error}
            </p>
            <button
              onClick={() => (window.location.href = '/')}
              className="mt-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-90"
              style={{ background: 'var(--surface-700)', color: 'var(--text-primary)' }}
            >
              Back to Aligned
            </button>
          </div>
        )}

        {phase === 'consent' && details && (
          <>
            <div className="flex flex-col items-center text-center gap-3 mb-6">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center overflow-hidden text-xl font-bold"
                style={{ background: 'var(--surface-700)' }}
              >
                {details.client.logo_uri ? (
                  <img
                    src={details.client.logo_uri}
                    alt={details.client.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  (details.client.name?.[0] ?? '?').toUpperCase()
                )}
              </div>
              <h1 className="text-xl font-semibold">
                Connect{' '}
                <span style={{ color: 'var(--brand-gold, #f59e0b)' }}>
                  {details.client.name || 'this app'}
                </span>
              </h1>
              <p style={{ color: 'var(--text-secondary)' }} className="text-sm">
                <span className="font-medium">{details.client.name || 'An application'}</span>{' '}
                wants to access your Aligned account
                {details.user?.email ? (
                  <>
                    {' '}as <span className="font-medium">{details.user.email}</span>
                  </>
                ) : null}
                .
              </p>
            </div>

            <div
              className="rounded-2xl p-4 mb-6"
              style={{ background: 'var(--surface-950)' }}
            >
              <p
                style={{ color: 'var(--text-tertiary)' }}
                className="text-xs uppercase tracking-wide mb-3"
              >
                This will allow it to
              </p>
              <ul className="flex flex-col gap-2.5">
                <ScopeRow text="Read your meetings, summaries, and transcripts" />
                <ScopeRow text="Read, create, update, and archive your action items" />
                {details.scope
                  .split(' ')
                  .filter(Boolean)
                  .filter((s) => SCOPE_LABELS[s])
                  .map((s) => (
                    <ScopeRow key={s} text={describeScope(s)} />
                  ))}
              </ul>
            </div>

            <p
              style={{ color: 'var(--text-muted)' }}
              className="text-xs text-center mb-5 break-all"
            >
              You can revoke access anytime in Settings. Redirects to{' '}
              {details.redirect_uri}
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => decide(false)}
                className="flex-1 px-5 py-3 rounded-xl text-sm font-medium transition-opacity hover:opacity-90"
                style={{ background: 'var(--surface-700)', color: 'var(--text-primary)' }}
              >
                Deny
              </button>
              <button
                onClick={() => decide(true)}
                className="flex-1 px-5 py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ background: 'var(--brand-gold, #f59e0b)', color: '#1c1d20' }}
              >
                Approve
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const ScopeRow: React.FC<{ text: string }> = ({ text }) => (
  <li className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
    <span
      className="mt-0.5 shrink-0"
      style={{ color: 'var(--brand-gold, #f59e0b)' }}
      aria-hidden
    >
      ✓
    </span>
    <span>{text}</span>
  </li>
);

const Spinner: React.FC = () => (
  <div className="relative w-10 h-10">
    <div className="w-10 h-10 rounded-full border-4 border-white/10" />
    <div className="absolute inset-0 w-10 h-10 rounded-full border-4 border-t-amber-500 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
  </div>
);

export default OAuthConsent;
