// meetingBrief.ts
//
// The brief before a meeting, from what Natively already holds locally:
//
//   who is coming     each attendee, when the user last met them (the newest
//                     saved meeting whose invite had their address) and what
//                     they still owe from those meetings
//   last time         the previous meeting of the series (recurringMeetings),
//                     for a recurring event
//   what you owe      the user's open items from meetings with these people
//   talking points    three or four things worth raising. Written by the model
//                     only when the user pressed "Brief me" and the notes may
//                     go to the configured model (AssistService); otherwise
//                     drawn from the items above, with no model call.
//
// Pure apart from nothing: every input is passed in. No platform branches.

import { buildLastTimeRecap, findPreviousSeriesMeeting, type LastTimeRecap } from '../meeting/recurringMeetings';
import { displayName, ownerIsPerson, type UserIdentity } from './assistPeople';
import { ASSIST_LONGEST_LOOKBACK_DAYS, clip, latestTaskStates, meetingEmails, meetingTitle, readOpenQuestions, type AssistMeeting } from './assistNotes';
import { collectOwedItems, type DoneMap, type OwedItem } from './owedItems';

/** The upcoming event, as the calendar list gives it. */
export interface BriefEvent {
  id: string;
  title?: string;
  startTime: string;
  endTime?: string;
  attendees?: Array<{ email: string; name?: string; response?: string }>;
  recurringEventId?: string;
  organizer?: { email?: string; name?: string; self?: boolean };
  description?: string;
}

export interface BriefPerson {
  email: string;
  name: string;
  /** The newest saved meeting with them, if any. */
  lastMet: { meetingId: string; title: string; startMs: number } | null;
  /** How many saved meetings they were on (within the lookback). */
  meetingsCount: number;
  /** Open items they own from meetings with the user, newest first, at most three. */
  theirOpenItems: Array<{ text: string; meetingId: string; deadline?: string }>;
}

/** An email thread with the attendees, from Gmail when it is connected (outputs/gmailIpc.gmailBriefContext). */
export interface BriefEmail {
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

export interface MeetingBrief {
  eventId: string;
  title: string;
  startTime: string;
  people: BriefPerson[];
  lastTime: LastTimeRecap | null;
  yourOpenItems: OwedItem[];
  talkingPoints: string[];
  /** 'model' when the model wrote the talking points; 'notes' when drawn from the items. */
  talkingPointsFrom: 'model' | 'notes';
  generatedAt: number;
  /** Recent email threads with these people, newest first. Only when Gmail is connected and has some. */
  recentEmails?: BriefEmail[];
}

export const BRIEF_MAX_EMAILS = 8;

export const BRIEF_LOOKBACK_DAYS = ASSIST_LONGEST_LOOKBACK_DAYS;
export const BRIEF_MAX_PEOPLE = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The people on the invite, minus the user and anyone who declined, one per address. */
export function briefAttendees(event: BriefEvent, identity: UserIdentity): Array<{ email: string; name?: string }> {
  const self = new Set(identity.emails.map((e) => e.toLowerCase()));
  const seen = new Set<string>();
  const out: Array<{ email: string; name?: string }> = [];
  const push = (email: unknown, name: unknown) => {
    const e = String(email ?? '').trim();
    const key = e.toLowerCase();
    if (!e.includes('@') || self.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push({ email: e, ...(typeof name === 'string' && name.trim() ? { name: name.trim() } : {}) });
  };
  for (const a of Array.isArray(event.attendees) ? event.attendees : []) {
    if (a?.response === 'declined') continue;
    push(a?.email, a?.name);
  }
  if (event.organizer && !event.organizer.self) push(event.organizer.email, event.organizer.name);
  return out;
}

export function assembleMeetingBrief(input: {
  event: BriefEvent;
  meetings: AssistMeeting[];
  identity: UserIdentity;
  nowMs: number;
  done?: DoneMap;
}): MeetingBrief {
  const { event, identity, nowMs } = input;
  const eventStart = Date.parse(event.startTime);
  const before = Number.isFinite(eventStart) ? Math.min(eventStart, nowMs) : nowMs;
  const meetings = input.meetings
    .filter((m) => m && Number.isFinite(m.startMs) && m.startMs < before && before - m.startMs <= BRIEF_LOOKBACK_DAYS * DAY_MS)
    .sort((a, b) => b.startMs - a.startMs);

  const people: BriefPerson[] = briefAttendees(event, identity).slice(0, BRIEF_MAX_PEOPLE).map((a) => {
    const email = a.email.toLowerCase();
    const theirs = meetings.filter((m) => meetingEmails(m).has(email));
    const latest = theirs[0];
    // Each of their tasks at its newest state (assistNotes.latestTaskStates),
    // so one closed in a later meeting never shows from an older open copy;
    // only tasks raised in a meeting they were on. Newest first, three at most.
    const theirOpenItems: BriefPerson['theirOpenItems'] = [...latestTaskStates(meetings, (act) => (ownerIsPerson(act.owner, a) ? 'them' : null), { selfEmails: identity.emails }).values()]
      .filter((st) => !st.done && st.meetings.some((m) => meetingEmails(m).has(email)))
      .sort((x, y) => y.meeting.startMs - x.meeting.startMs)
      .slice(0, 3)
      .map((st) => ({ text: st.action.text, meetingId: st.meeting.id, ...(st.action.deadline ? { deadline: st.action.deadline } : {}) }));
    return {
      email: a.email,
      name: displayName(a),
      lastMet: latest ? { meetingId: latest.id, title: meetingTitle(latest), startMs: latest.startMs } : null,
      meetingsCount: theirs.length,
      theirOpenItems,
    };
  });

  const previous = findPreviousSeriesMeeting({
    startMs: Number.isFinite(eventStart) ? eventStart : nowMs,
    calendarEventId: event.id,
    calendarEvent: {
      id: event.id,
      ...(event.title ? { title: event.title } : {}),
      attendees: (event.attendees ?? []).map((x) => ({ email: x.email, ...(x.name ? { name: x.name } : {}), ...(x.response ? { response: x.response } : {}) })),
      ...(event.recurringEventId ? { recurringEventId: event.recurringEventId } : {}),
    },
  }, meetings);
  const lastTime = buildLastTimeRecap(previous);

  const emails = new Set(people.map((p) => p.email.toLowerCase()));
  const yourOpenItems = emails.size > 0
    ? collectOwedItems(meetings, identity, { nowMs, done: input.done, lookbackDays: BRIEF_LOOKBACK_DAYS, withEmails: emails, limit: 6 })
    : [];

  const brief: MeetingBrief = {
    eventId: event.id,
    title: String(event.title ?? '').trim() || 'Meeting',
    startTime: event.startTime,
    people,
    lastTime,
    yourOpenItems,
    talkingPoints: [],
    talkingPointsFrom: 'notes',
    generatedAt: nowMs,
  };
  brief.talkingPoints = fallbackTalkingPoints(brief, previous);
  return brief;
}

/** Talking points from the items alone (no model): close out, chase, carry over. At most four. */
export function fallbackTalkingPoints(brief: MeetingBrief, previous?: AssistMeeting | null): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const c = clip(s, 110);
    if (c && !out.some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c);
  };
  for (const item of brief.yourOpenItems.slice(0, 2)) add(`Update them on: ${item.text}`);
  for (const p of brief.people) {
    for (const item of p.theirOpenItems.slice(0, 1)) add(`Ask ${p.name.split(/\s+/)[0]} about: ${item.text}`);
    if (out.length >= 4) break;
  }
  if (previous && out.length < 4) {
    for (const q of readOpenQuestions(previous.detailedSummary).slice(0, 2)) add(`Still open from last time: ${q}`);
  }
  return out.slice(0, 4);
}

/** The text the model reads to write talking points: the brief, nothing from any transcript. */
export function briefPromptInput(brief: MeetingBrief, description?: string): string {
  const lines: string[] = [`Upcoming meeting: ${clip(brief.title, 120)}`];
  const desc = clip(String(description ?? ''), 600);
  if (desc) lines.push(`Invite description: ${desc}`);
  if (brief.people.length) {
    lines.push('People:');
    for (const p of brief.people) {
      const met = p.lastMet ? `last met ${new Date(p.lastMet.startMs).toISOString().slice(0, 10)} in "${clip(p.lastMet.title, 80)}"` : 'no earlier meeting saved';
      lines.push(`- ${p.name}: ${met}`);
      for (const it of p.theirOpenItems) lines.push(`  - they owe: ${clip(it.text, 160)}${it.deadline ? ` (by ${it.deadline})` : ''}`);
    }
  }
  if (brief.lastTime) {
    lines.push(`Last meeting of this series (${brief.lastTime.date.slice(0, 10)}):`);
    for (const b of brief.lastTime.bullets) lines.push(`- ${b}`);
  }
  if (brief.yourOpenItems.length) {
    lines.push('The user still owes:');
    for (const it of brief.yourOpenItems) lines.push(`- ${clip(it.text, 160)}${it.deadline ? ` (by ${it.deadline})` : ''}${it.overdue ? ' (overdue)' : ''}`);
  }
  if (brief.recentEmails?.length) {
    lines.push('Recent emails with these people:');
    for (const m of brief.recentEmails.slice(0, BRIEF_MAX_EMAILS)) {
      const day = Number.isFinite(Date.parse(m.date)) ? ` (${new Date(Date.parse(m.date)).toISOString().slice(0, 10)})` : '';
      const from = clip(String(m.from ?? ''), 60);
      const snippet = clip(String(m.snippet ?? ''), 200);
      lines.push(`- "${clip(String(m.subject ?? ''), 100)}"${from ? ` from ${from}` : ''}${day}${snippet ? `: ${snippet}` : ''}`);
    }
  }
  return lines.join('\n');
}

/** Natively's own instruction for the talking points (one small JSON call). */
export const BRIEF_TALKING_POINTS_SYSTEM = `You help someone get ready for a meeting that starts soon.
From the notes below, write three or four talking points they could raise. Each one is a single short line in plain words, at most 18 words, specific to these people and these items: what to close out, what to chase, what to decide.
Use only what the notes say. Never invent a fact, a number, a name or a date. If the notes are thin, write fewer points rather than generic ones.
No greetings, no advice about meetings in general, no markdown.`;

export const BRIEF_TALKING_POINTS_SHAPE = '{"talkingPoints":["string"]}';

/** Validates the model's JSON: 1-4 non-empty strings, each cut to 140 characters. */
export function validateTalkingPoints(raw: unknown): { ok: boolean; data?: string[]; errors: string[]; repaired: boolean } {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as any).talkingPoints) ? (raw as any).talkingPoints : null;
  if (!list) return { ok: false, errors: ['talkingPoints must be an array of strings'], repaired: false };
  const points = list
    .filter((x: unknown) => typeof x === 'string')
    .map((x: string) => clip(x.replace(/^[-*•\d.)\s]+/, ''), 140))
    .filter(Boolean)
    .slice(0, 4);
  if (points.length === 0) return { ok: false, errors: ['no talking points'], repaired: false };
  return { ok: true, data: points, errors: [], repaired: points.length !== list.length };
}

/** What the model call depends on: a new hash means the cached points are stale. */
export function briefInputHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
