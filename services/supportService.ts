// Help & Support form → api/support/submit.ts (which saves the request and
// emails support). The browser never touches the support_requests table.

import { Capacitor } from '@capacitor/core';
import { supabase } from './supabaseService';
import type { SupportTopic } from '../config/support';

const detectPlatform = (): 'web' | 'desktop' | 'ios' | 'android' => {
  if (typeof window !== 'undefined' && (window as any).ipcRenderer) return 'desktop';
  const p = Capacitor.getPlatform();
  return p === 'ios' || p === 'android' ? p : 'web';
};

/** Resolves with the email we'll reply to; throws with a user-facing message. */
export const submitSupportRequest = async (topic: SupportTopic, message: string): Promise<{ email: string }> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Please sign in again and retry.');

  const res = await fetch('/api/support/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ topic, message, platform: detectPlatform() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? 'Could not send your request.');
  return { email: json.email };
};
