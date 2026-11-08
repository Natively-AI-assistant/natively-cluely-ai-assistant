// src/lib/reminderDrafts.mjs
//
// Short notes to the people on an upcoming meeting, written for the user to
// send themselves: "running late", "are you joining?" (nobody has turned up)
// and "can we move it?". Natively never sends them. The user copies one, or
// opens it in their mail app (a mailto: link) or in Gmail's compose window
// (gmailComposeUrl, for a Google calendar).
//
// The words are templates, not a model call: someone running late needs the
// draft at once. A writing-style string, when the app has one for the user,
// picks the register (formal or casual) and is otherwise ignored.
//
// Pure, with no DOM, so the tests run it directly.

import { followUpRecipients, gmailComposeUrl, recipientName } from './followUpRecipients.mjs';

/** @typedef {'running_late' | 'no_show' | 'reschedule'} ReminderKind */

/** Longest mailto link worth opening: Windows' shell cuts them near 2,000 characters. */
export const MAILTO_MAX_LENGTH = 1900;

/**
 * 'formal' or 'casual' from a free-text style description; 'neutral' otherwise.
 * @param {string | undefined | null} style
 */
export function registerFromStyle(style) {
  const s = String(style ?? '').toLowerCase();
  if (!s.trim()) return 'neutral';
  if (/\b(formal|professional|polite|courteous)\b/.test(s)) return 'formal';
  if (/\b(casual|informal|relaxed|friendly|short|brief|terse|lowercase)\b/.test(s)) return 'casual';
  return 'neutral';
}

/**
 * "Priya", "Priya and Rob", "Priya, Rob and Sam", "everyone" past four.
 * @param {Array<{ email: string, name?: string }>} recipients
 */
export function greetingNames(recipients) {
  const firsts = recipients.map((r) => recipientName(r).split(/\s+/)[0]).filter(Boolean);
  if (firsts.length === 0 || firsts.length > 4) return '';
  if (firsts.length === 1) return firsts[0];
  return `${firsts.slice(0, -1).join(', ')} and ${firsts[firsts.length - 1]}`;
}

/**
 * The event's start as people say it: "10:30" in the machine's clock.
 * @param {string} iso
 * @param {string} [locale]
 * @param {string} [timeZone]
 */
export function spokenTime(iso, locale, timeZone) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat(locale || undefined, { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(new Date(ms));
  } catch {
    return '';
  }
}

/**
 * One draft: who it goes to, its subject and its body.
 * @param {{
 *   kind: ReminderKind,
 *   event: { title?: string, startTime: string, attendees?: Array<{ email: string, name?: string, response?: string }> },
 *   senderName?: string | null,
 *   minutesLate?: number,
 *   style?: string | null,
 *   locale?: string,
 *   timeZone?: string,
 * }} input
 * @returns {{ kind: ReminderKind, to: string[], subject: string, body: string }}
 */
export function buildReminderDraft(input) {
  const recipients = followUpRecipients(input.event?.attendees);
  const to = recipients.map((r) => r.email);
  const title = String(input.event?.title ?? '').trim() || 'our meeting';
  const register = registerFromStyle(input.style);
  const names = greetingNames(recipients);
  const hello = register === 'formal'
    ? (names ? `Hello ${names},` : 'Hello,')
    : (names ? `Hi ${names},` : 'Hi all,');
  const sender = String(input.senderName ?? '').trim();
  const signOff = register === 'formal' ? 'Best regards,' : register === 'casual' ? 'Thanks,' : 'Thanks,';
  const signature = sender ? `${signOff}\n${register === 'formal' ? sender : sender.split(/\s+/)[0]}` : signOff;
  const at = spokenTime(input.event?.startTime, input.locale, input.timeZone);
  const minutes = Math.max(1, Math.min(60, Math.round(Number(input.minutesLate) || 5)));

  let subject = '';
  let lines = [];
  switch (input.kind) {
    case 'running_late':
      subject = `Running ${minutes} minutes late: ${title}`;
      lines = register === 'casual'
        ? [`Running about ${minutes} minutes late for ${title}, sorry. Start without me and I'll catch up.`]
        : [`I'm running about ${minutes} minutes late for ${title}. Please go ahead and start, and I'll join as soon as I can.`, 'Sorry for the delay.'];
      break;
    case 'no_show':
      subject = `Are you joining? ${title}`;
      lines = register === 'casual'
        ? [`I'm on the call for ${title}${at ? ` (${at})` : ''}. Still able to join? Happy to move it if today doesn't work.`]
        : [`I'm on the call for ${title}${at ? `, which was set for ${at}` : ''}. Are you still able to join?`, "If today doesn't work any more, I'm happy to find another time."];
      break;
    case 'reschedule':
    default:
      subject = `Can we move ${title}?`;
      lines = register === 'casual'
        ? [`Something's come up and I can't make ${title}${at ? ` at ${at}` : ''}. Could we move it? Send me a time that works and I'll update the invite.`]
        : [`Something has come up and I can't make ${title}${at ? ` at ${at}` : ''}. Could we find another time?`, "Let me know a few times that work for you and I'll update the invite.", 'Sorry for the short notice.'];
      break;
  }
  const body = [hello, '', ...lines, '', signature].join('\n');
  return { kind: input.kind, to, subject, body };
}

/**
 * A mailto: link for the draft. Every part is percent-encoded (spaces as %20,
 * line breaks as %0D%0A, which mail clients on both macOS and Windows read
 * as new lines). Null when the link would be too long for Windows' shell.
 * @param {{ to: string[], subject: string, body: string }} draft
 * @returns {string | null}
 */
export function mailtoUrl(draft) {
  const to = (draft.to ?? []).map((e) => encodeURIComponent(e).replace(/%40/g, '@')).join(',');
  const params = [];
  if (draft.subject) params.push(`subject=${encodeURIComponent(draft.subject)}`);
  if (draft.body) params.push(`body=${encodeURIComponent(draft.body.replace(/\r?\n/g, '\r\n'))}`);
  const url = `mailto:${to}${params.length ? `?${params.join('&')}` : ''}`;
  return url.length <= MAILTO_MAX_LENGTH ? url : null;
}

/**
 * The same draft in Gmail's compose window.
 * @param {{ to: string[], subject: string, body: string }} draft
 * @param {string} [account]
 */
export function reminderGmailUrl(draft, account) {
  return gmailComposeUrl({ to: draft.to, subject: draft.subject, body: draft.body, ...(account ? { account } : {}) });
}

/**
 * The text that goes on the clipboard: the subject line, then the body.
 * @param {{ subject: string, body: string }} draft
 */
export function clipboardText(draft) {
  return `${draft.subject}\n\n${draft.body}`;
}
