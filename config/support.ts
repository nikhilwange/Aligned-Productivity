// ─── Help & Support — single source of truth ────────────────────────────────
// Contact details shown on the landing page, the Help & Support screen,
// Billing and the "limit reached" messages.

export const SUPPORT_EMAIL = 'support@getitaligned.com';
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;
export const SUPPORT_REPLY_PROMISE = 'We reply within 24 hours.';

// WhatsApp Business number, digits only with country code (e.g. 919876543210).
// A phone number is not a secret, so a VITE_ variable is fine. When it is
// empty every WhatsApp button stays hidden.
const WHATSAPP_NUMBER = String(import.meta.env.VITE_SUPPORT_WHATSAPP ?? '').replace(/\D/g, '');
const WHATSAPP_MESSAGE = 'Hi, I need help with Aligned.';

/** wa.me link with the pre-filled message, or null when no number is set. */
export const SUPPORT_WHATSAPP_URL: string | null = WHATSAPP_NUMBER
  ? `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`
  : null;

// Support form topics. Keys are stored in support_requests.topic and are
// mirrored in api/support/submit.ts — change both together.
export type SupportTopic = 'recording' | 'transcription_notes' | 'payment_plan' | 'account' | 'other';
export const SUPPORT_TOPICS: { id: SupportTopic; label: string }[] = [
  { id: 'recording',           label: 'Recording' },
  { id: 'transcription_notes', label: 'Transcription or notes' },
  { id: 'payment_plan',        label: 'Payment or plan' },
  { id: 'account',             label: 'Account' },
  { id: 'other',               label: 'Something else' },
];
export const SUPPORT_MESSAGE_MAX = 2000;

/**
 * Splits text around the support email so renderers can turn it into a
 * mailto link: odd indexes are the email, even indexes plain text.
 */
export const splitOnSupportEmail = (text: string): string[] => text.split(SUPPORT_EMAIL).flatMap(
  (part, i, arr) => (i < arr.length - 1 ? [part, SUPPORT_EMAIL] : [part]),
);
