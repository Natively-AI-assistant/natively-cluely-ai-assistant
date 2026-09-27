// src/lib/followUpRecipients.mjs
//
// Who a meeting's follow-up goes to, and the Gmail draft that sends it.
//
// Recipients are the meeting's calendar attendees (the snapshot the meeting
// kept when it was linked; the user's own entry is never in it), minus anyone
// who declined, one entry per address. That is what Fathom does with its
// recap: everyone on the invite.
//
// The draft opens in Gmail's compose window rather than a mailto: link. The
// account is a Google one (it is the calendar), Gmail needs no desktop mail
// client (often missing on Windows, where mailto also caps out near 2,000
// characters), and https is the one scheme open-external allows.
//
// Pure, with no DOM, so the tests run it directly.

/**
 * @typedef {{ email: string, name?: string, response?: string }} Attendee
 */

/**
 * Everyone the follow-up should go to: attendees with an address who have not
 * declined, first occurrence of each address kept.
 * @param {Attendee[] | undefined | null} attendees
 * @returns {Attendee[]}
 */
export function followUpRecipients(attendees) {
  const seen = new Set();
  const out = [];
  for (const a of Array.isArray(attendees) ? attendees : []) {
    const email = typeof a?.email === 'string' ? a.email.trim() : '';
    if (!email || !email.includes('@') || a.response === 'declined') continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ email, ...(a.name && a.name.trim() ? { name: a.name.trim() } : {}) });
  }
  return out;
}

/**
 * How a recipient reads in the card: their name, else the part of the
 * address before the "@".
 * @param {Attendee} a
 */
export const recipientName = (a) => (a.name && a.name.trim()) || a.email.split('@')[0];

/**
 * "Priya Nair", "Priya Nair and Rob Lane", "Priya Nair, Rob Lane +2".
 * @param {Attendee[]} recipients
 * @param {number} [shown]
 */
export function recipientSummary(recipients, shown = 2) {
  const names = recipients.map(recipientName);
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]}, ${names[1]}`;
  return `${names.slice(0, shown).join(', ')} +${names.length - shown}`;
}

/**
 * Gmail's compose window, filled in. `account` pins which signed-in Google
 * account it opens in (the calendar's), so a second Gmail account in the
 * browser does not send it from the wrong address.
 * @param {{ to?: string[], subject?: string, body?: string, account?: string }} draft
 * @returns {string}
 */
export function gmailComposeUrl({ to = [], subject = '', body = '', account } = {}) {
  const params = ['view=cm', 'fs=1'];
  if (account) params.push(`authuser=${encodeURIComponent(account)}`);
  if (to.length > 0) params.push(`to=${to.map((e) => encodeURIComponent(e)).join(',')}`);
  if (subject) params.push(`su=${encodeURIComponent(subject)}`);
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return `https://mail.google.com/mail/?${params.join('&')}`;
}
