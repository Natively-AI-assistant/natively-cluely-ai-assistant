// people.ts
//
// Who a meeting was with, read from what the meeting already holds: the linked
// calendar event's attendees (name and address), the names the meeting app
// reported (Meet, Zoom, Teams via the Companion extension), and the names the
// user or the speaker matcher gave the voices. Everyone is keyed by address
// when one is known; a name-only entry joins the attendee it plainly is (same
// full name, or the only attendee with that first name).
//
// Also: which email domains are companies (personal mail is not), how a
// domain reads as a company name, whose action items are whose, and a one-line
// recap of a meeting from its saved notes.
//
// Pure: no Electron, no database, no platform branches.

import { emailDomain, isGenericEmailDomain } from '../meeting/meetingNotesContext';
import { clipText, readPreviousNotes } from '../meeting/recurringMeetings';

export type PersonVia = 'attendee' | 'participant' | 'speaker';

export interface MeetingPersonRef {
  /** Lower-cased address, when the calendar gave one. */
  email?: string;
  /** As shown to the user; may be '' for an address with no name. */
  name: string;
  via: PersonVia;
}

export interface MeetingPeopleSource {
  calendarEvent?: { attendees?: Array<{ email?: string; name?: string; response?: string }> } | null;
  callParticipants?: string[] | null;
  speakerLabels?: Record<string, string> | null;
  /** The user, never listed as someone they met. */
  user?: { email?: string; name?: string } | null;
}

const NAME_MAX = 80;
const PLACEHOLDER_NAMES = /^(me|you|them|user|interviewer|speaker\s*\d*|unknown|guest|participant\s*\d*|other side)$/i;

/** Lower-case, accents folded, punctuation dropped, single spaces: two spellings of one name compare equal. */
export function nameKey(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\((?:you|me|host|guest|organi[sz]er)\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A display name as typed, trimmed, with a meeting app's "(You)"/"(Host)" dropped. */
export function cleanPersonName(name: unknown): string {
  if (typeof name !== 'string') return '';
  const clean = name
    .replace(/\s*\((?:you|me|host|guest|organi[sz]er)\)\s*/gi, ' ')
    .replace(/[\r\n\t<>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean || clean.includes('@') || PLACEHOLDER_NAMES.test(clean)) return '';
  return clean.slice(0, NAME_MAX);
}

/** True for a meeting app's own marker that a name is the person recording ("Dana (You)"). */
function isSelfMarked(name: unknown): boolean {
  return typeof name === 'string' && /\((?:you|me)\)/i.test(name);
}

export function normaliseEmail(email: unknown): string {
  if (typeof email !== 'string') return '';
  const clean = email.trim().toLowerCase().replace(/^mailto:/, '');
  return emailDomain(clean) ? clean.slice(0, 160) : '';
}

export function firstNameKey(name: unknown): string {
  return nameKey(name).split(' ')[0] || '';
}

// Country and regional variants of the big personal-mail providers
// (yahoo.co.uk, hotmail.fr, outlook.de, gmx.de, web.de...). The exact list in
// meetingNotesContext covers the common .com ones.
const FREE_MAIL_FAMILIES = /^(?:yahoo|ymail|hotmail|outlook|live|msn|windowslive|aol|gmx|yandex|mail|icloud|me|proton|protonmail|zoho|rocketmail|rediffmail|libero|web|t-online|orange|free|laposte|seznam|wp|o2|naver|daum|hanmail|163|126|qq|sina|sohu|yeah)\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/;

/** Personal mail: an address there says nothing about where someone works. */
export function isFreeMailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  return isGenericEmailDomain(d) || FREE_MAIL_FAMILIES.test(d) || /(^|\.)gmail\.[a-z.]+$/.test(d) || /(^|\.)googlemail\.[a-z.]+$/.test(d);
}

// Second-level labels under which a company registers (acme.co.uk, acme.com.au).
const COMPOUND_SLD = /^(?:co|com|org|net|ac|gov|edu|ltd|plc|or|ne|go)$/;

/** The part of a domain a company owns: eng.acme.com and acme.com are both "acme.com". */
export function registrableDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const labels = domain.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length < 2) return null;
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  const take = labels.length >= 3 && tld.length === 2 && COMPOUND_SLD.test(sld) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/** The company domain for an address, or null for personal mail or anything that is not an address. */
export function companyDomainForEmail(email: unknown): string | null {
  const domain = emailDomain(typeof email === 'string' ? email.trim().toLowerCase() : email);
  if (!domain || isFreeMailDomain(domain)) return null;
  const reg = registrableDomain(domain);
  return reg && !isFreeMailDomain(reg) ? reg : null;
}

/**
 * Short labels read as initials (hp.com is HP, ibm.com is IBM, bmw.com is
 * BMW) unless three letters spell like a word, consonant-vowel-consonant
 * (box.com is Box, sun.com is Sun). A guess either way; the user can rename.
 */
function looksLikeInitials(w: string): boolean {
  if (!/^[a-z]+$/.test(w) || w.length > 3) return false;
  if (w.length <= 2) return true;
  return !/^[^aeiouy][aeiou][^aeiouy]$/.test(w);
}

/** "acme.com" → "Acme", "blue-river.co.uk" → "Blue River". The user can rename it. */
export function companyNameFromDomain(domain: string): string {
  const reg = registrableDomain(domain) || domain;
  const label = reg.split('.')[0] || reg;
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => (looksLikeInitials(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * Everyone in one meeting, the user excluded, each once. Attendees first
 * (they carry addresses); a call or speaker name that is plainly one of them
 * joins that attendee instead of becoming a second person.
 */
export function peopleInMeeting(src: MeetingPeopleSource): MeetingPersonRef[] {
  const userEmail = normaliseEmail(src.user?.email);
  const userKey = nameKey(src.user?.name);
  const userFirst = userKey.split(' ')[0] || '';
  const isUserName = (name: string) => {
    const k = nameKey(name);
    if (!k) return false;
    if (userKey && k === userKey) return true;
    // A one-word name equal to the user's first name is the user ("Evin" in the call).
    return !!userFirst && !k.includes(' ') && k === userFirst;
  };

  const out: MeetingPersonRef[] = [];
  const byEmail = new Map<string, MeetingPersonRef>();
  for (const a of Array.isArray(src.calendarEvent?.attendees) ? src.calendarEvent!.attendees! : []) {
    if (!a || a.response === 'declined') continue;
    const email = normaliseEmail(a.email);
    if (!email || email === userEmail || byEmail.has(email)) continue;
    const name = cleanPersonName(a.name);
    // The user's other address (same full name as the calendar account).
    if (name && userKey.includes(' ') && nameKey(name) === userKey) continue;
    const ref: MeetingPersonRef = { email, name, via: 'attendee' };
    byEmail.set(email, ref);
    out.push(ref);
  }

  const attendeeFor = (name: string): MeetingPersonRef | undefined => {
    const k = nameKey(name);
    if (!k) return undefined;
    const exact = out.filter((p) => p.email && nameKey(p.name) === k);
    if (exact.length === 1) return exact[0];
    // "Dana" in the call, "Dana Fox <dana@…>" on the invite: only when no other attendee shares the first name.
    const first = k.split(' ')[0];
    const sameFirst = out.filter((p) => p.email && firstNameKey(p.name) === first);
    if (sameFirst.length === 1 && (!k.includes(' ') || !nameKey(sameFirst[0].name).includes(' '))) return sameFirst[0];
    // The local part of an address with no name: "dana.fox@" is Dana Fox.
    const byLocal = out.filter((p) => p.email && !p.name && nameKey((p.email.split('@')[0] || '').replace(/[._-]+/g, ' ')) === k);
    return byLocal.length === 1 ? byLocal[0] : undefined;
  };

  const addName = (raw: unknown, via: PersonVia) => {
    if (isSelfMarked(raw)) return;
    const name = cleanPersonName(raw);
    if (!name || isUserName(name)) return;
    const attendee = attendeeFor(name);
    if (attendee) {
      if (!attendee.name) attendee.name = name;
      return;
    }
    const k = nameKey(name);
    if (out.some((p) => !p.email && nameKey(p.name) === k)) return;
    out.push({ name, via });
  };

  for (const n of Array.isArray(src.callParticipants) ? src.callParticipants : []) addName(n, 'participant');
  const labels = src.speakerLabels && typeof src.speakerLabels === 'object' ? src.speakerLabels : {};
  for (const [id, label] of Object.entries(labels)) {
    if (id === 'me' || id === 'user') continue;
    addName(label, 'speaker');
  }
  return out;
}

/**
 * Whether an action item's owner is this person. A full-name match always
 * counts; a first name only when nobody else in that meeting shares it.
 */
export function ownerIsPerson(owner: unknown, person: { name: string }, othersInMeeting: Array<{ name: string }> = []): boolean {
  const o = nameKey(typeof owner === 'string' ? owner.replace(/\([^)]*\)/g, ' ') : owner);
  const k = nameKey(person.name);
  if (!o || !k) return false;
  if (o === k) return true;
  const kTokens = k.split(' ');
  // "Dana Fox and Tom": a full name inside a shared owner.
  if (kTokens.length >= 2 && ` ${o} `.includes(` ${k} `)) return true;
  const oTokens = o.split(' ');
  if (oTokens[0] !== kTokens[0]) return false;
  // "Dana Lee" is not Dana Fox.
  if (oTokens.length >= 2 && kTokens.length >= 2 && oTokens[1] !== kTokens[1]) return false;
  if (oTokens.length >= 2 && kTokens.length >= 2) return true;
  // A first name alone: only when nobody else in that meeting shares it.
  const first = kTokens[0];
  return !othersInMeeting.some((p) => nameKey(p.name) !== k && firstNameKey(p.name) === first);
}

export interface OpenActionItem {
  text: string;
  owner?: string;
  deadline?: string;
}

/** The open action items in a meeting's saved notes (V3 or older shapes). */
export function openActionItems(detailedSummary: unknown): OpenActionItem[] {
  return readPreviousNotes(detailedSummary).openActions.map((a) => ({
    text: a.text,
    ...(a.owner ? { owner: a.owner } : {}),
    ...(a.deadline ? { deadline: a.deadline } : {}),
  }));
}

export const RECAP_MAX_CHARS = 180;

/** One line about a meeting from its saved notes: the overview's first sentence, else its first takeaway. '' for none. */
export function oneLineRecap(detailedSummary: unknown, fallbackTitle?: string): string {
  const notes = readPreviousNotes(detailedSummary, fallbackTitle);
  const first = (notes.overview.split(/(?<=[.!?])\s+/)[0] || '').trim();
  const line = first || notes.takeaways[0] || notes.decisions[0] || '';
  return line ? clipText(line.replace(/^[-*•]\s*/, '').replace(/\*\*/g, ''), RECAP_MAX_CHARS) : '';
}
