// ─── FAQ — written once, shown on the landing page and in Help & Support ────
// Every answer must stay true to the code. The numbers come from config/tiers
// so a limit change can't leave the FAQ behind.

import { TIERS, GRACE_MINUTES } from './tiers';
import { LANGUAGES } from './languages';
import { SUPPORT_EMAIL, SUPPORT_REPLY_PROMISE, SUPPORT_WHATSAPP_URL } from './support';

export interface FaqItem {
  q: string;
  a: string;
}

const hours = (minutes: number) => {
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${h} hour${h === 1 ? '' : 's'}`;
};

const languageList = (() => {
  const names = LANGUAGES.map(l => l.lang);
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
})();

export const FAQ: FaqItem[] = [
  {
    q: 'Which languages does Aligned understand?',
    a: `${languageList}. Mixed speech works too — for example Hindi and English in the same sentence. You don't need to choose a language; Aligned detects it automatically.`,
  },
  {
    q: 'What happens when my hours finish?',
    a: `Free (${hours(TIERS.free.monthlyMinutes)} a month): recording stops when you reach the limit, and each recording can be up to ${TIERS.free.sessionCapMinutes} minutes. `
      + `Lite and Plus: you can finish the meeting you are in (up to ${GRACE_MINUTES} minutes extra), then new recordings wait until next month or until you move to a bigger plan. `
      + 'Pro and Max: the meeting you are in always finishes; new recordings wait until next month. '
      + 'Hours reset on the 1st of every month.',
  },
  {
    q: 'Can I change or cancel my plan?',
    a: 'You can cancel any time from the Billing page. Your plan stays active until the end of the period you have already paid for, and you are not charged again. '
      + `Need more hours right away? Send us a request from Help & Support in the app, or write to ${SUPPORT_EMAIL}, and we will move you to a higher plan the same day.`,
  },
  {
    q: 'How do refunds work?',
    a: `For any refund request, write to ${SUPPORT_EMAIL} and we will help you.`,
  },
  {
    q: 'Is my audio stored?',
    a: 'Your audio is used only to create your notes. Once your notes are ready, the audio is deleted from our servers. '
      + 'If processing fails, it is kept for up to 30 days so you can retry, then deleted automatically. Deleting a session removes everything.',
  },
  {
    q: 'My UPI payment failed. What should I do?',
    a: 'Please try again with a debit or credit card. If it still fails, write to us and we will sort it out.',
  },
  {
    q: 'Does a bot join my meeting?',
    a: 'No. Aligned records from your own device. Nothing joins the call.',
  },
  {
    q: 'How do I reach you?',
    a: `Use Help & Support inside the app, or email ${SUPPORT_EMAIL}${SUPPORT_WHATSAPP_URL ? ', or message us on WhatsApp' : ''}. ${SUPPORT_REPLY_PROMISE}`,
  },
];
