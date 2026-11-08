// assistNotes.ts
//
// The saved meetings the assist features read, and what they read out of the
// notes: action items (with owner, deadline and status), decisions and open
// questions. Reads the V3 notes and the older V2 shape, like
// recurringMeetings.readPreviousNotes, but keeps every field the assist lists
// need (the status, so a ticked item never comes back).
//
// Pure, no I/O, no platform branches.

import type { CalendarEventSnapshot } from '../calendar/calendarSessionMatch';
import { seriesIdOf } from '../meeting/recurringMeetings';

/** One saved meeting as the assist features need it (DatabaseManager.getMeetingsWithNotesSince). */
export interface AssistMeeting {
  id: string;
  title?: string;
  startMs: number;
  durationMs?: number;
  calendarEventId?: string | null;
  calendarEvent?: Partial<CalendarEventSnapshot> | null;
  detailedSummary?: any;
  summaryStatus?: string | null;
  isProcessed?: boolean;
}

export interface NoteAction {
  text: string;
  owner?: string;
  deadline?: string;
  done: boolean;
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** True when the meeting's notes are written (not processing, not failed). */
export function notesReady(m: AssistMeeting): boolean {
  if (m.isProcessed === false) return false;
  if (m.summaryStatus && m.summaryStatus !== 'completed') return false;
  return !!m.detailedSummary && typeof m.detailedSummary === 'object';
}

/** Action items from the notes, newest shape first (V3, then structured V2, then plain strings). */
export function readActions(detailed: any): NoteAction[] {
  const d = detailed && typeof detailed === 'object' ? detailed : {};
  const source: any[] = Array.isArray(d.actionItemsV3) && d.actionItemsV3.length
    ? d.actionItemsV3
    : Array.isArray(d.actionItemsStructured) && d.actionItemsStructured.length
      ? d.actionItemsStructured
      : Array.isArray(d.actionItems) ? d.actionItems : [];
  const out: NoteAction[] = [];
  for (const a of source) {
    if (typeof a === 'string') {
      const text = clean(a);
      if (text) out.push({ text, done: false });
      continue;
    }
    if (!a || typeof a !== 'object') continue;
    const text = clean(a.text);
    if (!text) continue;
    const done = a.status === 'done' || a.completed === true || a.done === true;
    out.push({
      text,
      ...(clean(a.owner) ? { owner: clean(a.owner) } : {}),
      ...(clean(a.deadline) ? { deadline: clean(a.deadline) } : {}),
      done,
    });
  }
  return out;
}

export function readDecisions(detailed: any): string[] {
  const d = detailed && typeof detailed === 'object' ? detailed : {};
  return (Array.isArray(d.decisions) ? d.decisions : [])
    .map((x: any) => clean(typeof x === 'string' ? x : x?.text))
    .filter(Boolean);
}

export function readOpenQuestions(detailed: any): string[] {
  const d = detailed && typeof detailed === 'object' ? detailed : {};
  return (Array.isArray(d.openQuestions) ? d.openQuestions : [])
    .filter((q: any) => !(q && typeof q === 'object' && q.status === 'answered'))
    .map((q: any) => clean(typeof q === 'string' ? q : q?.text))
    .filter(Boolean);
}

/** The title the notes gave the meeting, else the stored one. */
export function meetingTitle(m: AssistMeeting): string {
  const d = m.detailedSummary;
  const fromNotes = d && typeof d === 'object' ? clean(d.title) : '';
  if (fromNotes && !/^meeting notes$/i.test(fromNotes)) return fromNotes;
  return clean(m.title) || clean(m.calendarEvent?.title) || 'Meeting';
}

/** Addresses on the meeting's invite (attendees who did not decline, and the organizer), lower case. */
export function meetingEmails(m: AssistMeeting): Set<string> {
  const out = new Set<string>();
  const ev = m.calendarEvent;
  for (const a of Array.isArray(ev?.attendees) ? ev!.attendees : []) {
    if (a && typeof a.email === 'string' && a.email.includes('@') && a.response !== 'declined') out.add(a.email.toLowerCase());
  }
  const org = (ev as any)?.organizer;
  if (org && typeof org.email === 'string' && org.email.includes('@') && !org.self) out.add(org.email.toLowerCase());
  return out;
}

/** Text as two items compare: case, spaces and trailing punctuation ignored. */
export function normalizeItemText(text: string): string {
  return clean(text).toLowerCase().replace(/[.!?;:,]+$/, '').replace(/\s+/g, ' ');
}

/** Cut on a word boundary to `max` characters, ellipsis included. */
export function clip(text: string, max: number): string {
  const c = clean(text);
  if (c.length <= max) return c;
  const cut = c.slice(0, Math.max(1, max - 1));
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The longest any assist list looks back (Brief me: 180 days). Task keys are
 * chained over this window (owedItems.collectOwedItems), so a task keeps one
 * key whichever list reads it.
 */
export const ASSIST_LONGEST_LOOKBACK_DAYS = 180;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A calendar day in the user's time zone (month 0-11). */
interface CivilDay { y: number; m: number; d: number }

/** The day `ms` falls on in `timeZone` (an IANA name), or on this machine's clock when absent. */
export function civilDayOf(ms: number, timeZone?: string): CivilDay {
  if (!timeZone) {
    const d = new Date(ms);
    return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(ms));
    const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return { y: n('year'), m: n('month') - 1, d: n('day') };
  } catch {
    return civilDayOf(ms);
  }
}

/** How far `timeZone` is ahead of UTC at the instant `ms`, in ms. */
function zoneOffsetMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(ms));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The civil day `n` days after `c` (month and year roll over). */
function addDays(c: CivilDay, n: number): CivilDay {
  const t = new Date(Date.UTC(c.y, c.m, c.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}

const weekdayOf = (c: CivilDay) => new Date(Date.UTC(c.y, c.m, c.d)).getUTCDay();

/** The last millisecond of civil day `c` in `timeZone` (machine clock when absent), daylight saving included. */
export function endOfCivilDay(c: CivilDay, timeZone?: string): number {
  const next = addDays(c, 1);
  if (!timeZone) return new Date(next.y, next.m, next.d).getTime() - 1;
  try {
    const guess = Date.UTC(next.y, next.m, next.d);
    let start = guess - zoneOffsetMs(guess, timeZone);
    // The offset at midnight itself (differs from the guess's on a change day).
    start = guess - zoneOffsetMs(start, timeZone);
    return start - 1;
  } catch {
    return endOfCivilDay(c);
  }
}

/**
 * When a deadline as the notes wrote it falls: the end of that day in the
 * user's time zone (`timeZone`, an IANA name; this machine's clock when
 * absent), read against the day of the meeting it was set in, in that same
 * zone. A meeting at 23:30 on Thursday sets "today" to Thursday, never to the
 * UTC Friday it already is.
 *
 * Understands ISO dates, "Oct 20" / "20 October", weekdays ("Friday", "by
 * Fri": the next one on or after the meeting's day), "today", "tomorrow",
 * "end of week" / "EOW", "next week", "end of month". Null when it cannot tell
 * (the item is then ordered by age).
 */
export function parseDeadline(deadline: string | undefined | null, meetingStartMs: number, timeZone?: string): number | null {
  const text = clean(deadline).toLowerCase().replace(/^(by|before|due|on|until)\s+/, '');
  if (!text || !Number.isFinite(meetingStartMs)) return null;
  const base = civilDayOf(meetingStartMs, timeZone);
  const end = (c: CivilDay) => endOfCivilDay(c, timeZone);
  const toFriday = () => (5 - weekdayOf(base) + 7) % 7;

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return end({ y: Number(iso[1]), m: Number(iso[2]) - 1, d: Number(iso[3]) });
  if (/\b(today|eod|end of day|tonight)\b/.test(text)) return end(base);
  if (/\btomorrow\b/.test(text)) return end(addDays(base, 1));
  if (/\b(end of (the )?week|eow|this week)\b/.test(text)) return end(addDays(base, toFriday()));
  if (/\bnext week\b/.test(text)) return end(addDays(base, toFriday() + 7));
  if (/\b(end of (the )?month|eom)\b/.test(text)) return end(addDays({ y: base.y, m: base.m + 1, d: 1 }, -1));
  // "Oct 20", "20 Oct", "October 20th"
  const monthDay = text.match(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/) || null;
  const dayMonth = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\b/) || null;
  const pick = monthDay && MONTHS.includes(monthDay[1])
    ? { month: MONTHS.indexOf(monthDay[1]), day: Number(monthDay[2]) }
    : dayMonth && MONTHS.includes(dayMonth[2])
      ? { month: MONTHS.indexOf(dayMonth[2]), day: Number(dayMonth[1]) }
      : null;
  if (pick && pick.day >= 1 && pick.day <= 31) {
    let year = base.y;
    // A date well before the meeting is next year's ("Jan 5" said in December).
    if (Date.UTC(year, pick.month, pick.day) < Date.UTC(base.y, base.m, base.d) - 60 * DAY_MS) year += 1;
    return end({ y: year, m: pick.month, d: pick.day });
  }
  for (let i = 0; i < WEEKDAYS.length; i++) {
    const full = WEEKDAYS[i];
    if (new RegExp(`\\b(${full}|${full.slice(0, 3)})\\b`).test(text)) {
      const ahead = (i - weekdayOf(base) + 7) % 7;
      const nextWeek = /\bnext\b/.test(text) ? 7 : 0;
      return end(addDays(base, ahead + nextWeek));
    }
  }
  return null;
}

/**
 * One task's newest state across meetings. A task is its normalised text and
 * its owner, raised in one chain of RELATED meetings (meetingsRelated: the
 * same meeting, the same calendar series, or one sharing an attendee other
 * than the user). Meetings are read oldest first, so a later "done" closes an
 * earlier open copy in the same chain (and a later open copy reopens it). The
 * same words in an unrelated meeting are another task: "Send the deck" done
 * for client B never closes client A's. A done copy with no owner closes
 * every owner's copy of that text in a related chain.
 *
 * A repeat that gives no deadline keeps the earlier deadline AND the meeting
 * that set it (`deadlineFromMs`), so "Friday" is still read against the week
 * it was said in.
 */
export interface TaskState {
  /** Normalised text + "|" + owner key + "#" + the id of the meeting that first raised it. */
  key: string;
  textKey: string;
  action: NoteAction;
  /** The newest meeting that mentions it. */
  meeting: AssistMeeting;
  /** Every meeting that mentions it, oldest first (meetings[0] raised it). */
  meetings: AssistMeeting[];
  firstSeenMs: number;
  /** When the meeting that set the current deadline started (what the deadline is read against). */
  deadlineFromMs: number;
  done: boolean;
}

/**
 * Two meetings are related when they are the same one, of the same calendar
 * series, or share an attendee who is not the user (`selfEmails`: the user's
 * own addresses never make two meetings related).
 */
export function meetingsRelated(a: AssistMeeting, b: AssistMeeting, selfEmails: readonly string[] = []): boolean {
  if (a.id === b.id) return true;
  const sa = seriesIdOf(a.calendarEvent?.id ?? a.calendarEventId, a.calendarEvent?.recurringEventId);
  const sb = seriesIdOf(b.calendarEvent?.id ?? b.calendarEventId, b.calendarEvent?.recurringEventId);
  if (sa && sa === sb) return true;
  const self = new Set(selfEmails.map((e) => String(e).toLowerCase()));
  const ea = meetingEmails(a);
  for (const e of meetingEmails(b)) if (!self.has(e) && ea.has(e)) return true;
  return false;
}

const ownerKeyOf = (owner?: string) => clean(owner).toLowerCase().replace(/[^\p{L}\p{N}@.\s]/gu, ' ').replace(/\s+/g, ' ').trim();

export function latestTaskStates(
  meetings: AssistMeeting[],
  ownerKey: (action: NoteAction) => string | null = (a) => ownerKeyOf(a.owner),
  opts: { selfEmails?: readonly string[] } = {},
): Map<string, TaskState> {
  const self = opts.selfEmails ?? [];
  const inChain = (st: TaskState, m: AssistMeeting) => st.meetings.some((x) => meetingsRelated(x, m, self));
  const states: TaskState[] = [];
  const ordered = [...meetings].filter((m) => m && Number.isFinite(m.startMs) && notesReady(m)).sort((a, b) => a.startMs - b.startMs);
  for (const m of ordered) {
    for (const action of readActions(m.detailedSummary)) {
      const textKey = normalizeItemText(action.text);
      if (!textKey) continue;
      if (action.done && !clean(action.owner)) {
        for (const st of states) {
          if (st.textKey === textKey && inChain(st, m)) { st.done = true; st.meeting = m; st.meetings.push(m); }
        }
        continue;
      }
      const owner = ownerKey(action);
      if (owner === null) continue;
      const base = `${textKey}|${owner}`;
      // The newest chain of this task that this meeting belongs to.
      let prev: TaskState | undefined;
      for (let i = states.length - 1; i >= 0; i--) {
        if (states[i].key.startsWith(`${base}#`) && inChain(states[i], m)) { prev = states[i]; break; }
      }
      if (!prev) {
        if (action.done) continue; // done with nothing open in its chain: nothing to close
        states.push({ key: `${base}#${m.id}`, textKey, action, meeting: m, meetings: [m], firstSeenMs: m.startMs, deadlineFromMs: m.startMs, done: false });
        continue;
      }
      const keepDeadline = !action.deadline && !!prev.action.deadline;
      prev.action = { ...action, ...(keepDeadline ? { deadline: prev.action.deadline } : {}) };
      prev.deadlineFromMs = keepDeadline ? prev.deadlineFromMs : m.startMs;
      if (prev.done && !action.done) prev.firstSeenMs = m.startMs; // reopened
      prev.meeting = m;
      prev.meetings.push(m);
      prev.done = action.done;
    }
  }
  return new Map(states.map((st) => [st.key, st]));
}

export { DAY_MS };
