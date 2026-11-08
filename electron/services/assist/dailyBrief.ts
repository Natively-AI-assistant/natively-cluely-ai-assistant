// dailyBrief.ts
//
// Today, in the launcher: the day's remaining meetings in order, each with one
// line of context from what Natively already holds.
//
// The context line, first that applies:
//   - a recurring meeting with notes from last time: "Last time: <first point>"
//   - people the user met before: "Last met Priya on Wed 8 Oct: <title>"
//   - an invite with people and nothing saved with any of them: "First meeting with Priya"
//   - otherwise none
// Nothing here calls a model. Dates are written in the caller's time zone
// (the machine's, unless a test passes one).
//
// Pure, no I/O, no platform branches.

import { buildLastTimeRecap, findPreviousSeriesMeeting } from '../meeting/recurringMeetings';
import { firstNameOf, type UserIdentity } from './assistPeople';
import { clip, meetingEmails, meetingTitle, type AssistMeeting } from './assistNotes';
import { briefAttendees, type BriefEvent } from './meetingBrief';

export interface DailyBriefMeeting {
  eventId: string;
  title: string;
  startTime: string;
  endTime?: string;
  attendeeCount: number;
  recurring: boolean;
  context: string | null;
  /** The saved meeting the context line comes from, to open it. */
  contextMeetingId: string | null;
}

export interface DailyBrief {
  meetings: DailyBriefMeeting[];
}

function shortDay(ms: number, timeZone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { ...(timeZone ? { timeZone } : {}), weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(ms));
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${part('weekday')} ${part('day')} ${part('month')}`;
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** Start and end of the day `nowMs` falls in, in the machine's time zone. */
export function localDayBounds(nowMs: number): { startMs: number; endMs: number } {
  const d = new Date(nowMs);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return { startMs: start, endMs: end };
}

export function contextLineFor(event: BriefEvent, meetings: AssistMeeting[], identity: UserIdentity, nowMs: number, timeZone?: string): { text: string | null; meetingId: string | null } {
  const startMs = Date.parse(event.startTime);
  const before = Number.isFinite(startMs) ? Math.min(startMs, nowMs) : nowMs;
  const earlier = meetings.filter((m) => m && Number.isFinite(m.startMs) && m.startMs < before).sort((a, b) => b.startMs - a.startMs);

  const previous = findPreviousSeriesMeeting({
    startMs: Number.isFinite(startMs) ? startMs : nowMs,
    calendarEventId: event.id,
    calendarEvent: {
      id: event.id,
      ...(event.title ? { title: event.title } : {}),
      attendees: (event.attendees ?? []).map((x) => ({ email: x.email, ...(x.name ? { name: x.name } : {}), ...(x.response ? { response: x.response } : {}) })),
      ...(event.recurringEventId ? { recurringEventId: event.recurringEventId } : {}),
    },
  }, earlier);
  const recap = buildLastTimeRecap(previous);
  if (recap && recap.bullets[0]) return { text: clip(`Last time: ${recap.bullets[0]}`, 110), meetingId: recap.meetingId };

  const people = briefAttendees(event, identity);
  if (people.length === 0) return { text: null, meetingId: null };
  for (const m of earlier) {
    const emails = meetingEmails(m);
    const met = people.filter((p) => emails.has(p.email.toLowerCase()));
    if (met.length === 0) continue;
    const who = met.length === 1 ? firstNameOf(met[0]) : `${firstNameOf(met[0])} and ${met.length - 1 === 1 ? firstNameOf(met[1]) : `${met.length - 1} others`}`;
    return { text: clip(`Last met ${who} on ${shortDay(m.startMs, timeZone)}: ${meetingTitle(m)}`, 110), meetingId: m.id };
  }
  const who = people.length === 1 ? firstNameOf(people[0]) : `${firstNameOf(people[0])} and ${people.length - 1 === 1 ? firstNameOf(people[1]) : `${people.length - 1} others`}`;
  return { text: `First meeting with ${who}`, meetingId: null };
}

export function buildDailyBrief(input: {
  events: BriefEvent[];
  meetings: AssistMeeting[];
  identity: UserIdentity;
  nowMs: number;
  /** Today's bounds; the machine's day when absent. */
  day?: { startMs: number; endMs: number };
  timeZone?: string;
}): DailyBrief {
  const day = input.day ?? localDayBounds(input.nowMs);
  const todays = (Array.isArray(input.events) ? input.events : [])
    .filter((e) => {
      if (!e || typeof e.id !== 'string' || typeof e.startTime !== 'string') return false;
      const s = Date.parse(e.startTime);
      const end = e.endTime ? Date.parse(e.endTime) : s;
      // Still to come or under way, and starting today.
      return Number.isFinite(s) && s >= day.startMs && s < day.endMs && (Number.isFinite(end) ? end : s) >= input.nowMs;
    })
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  const seen = new Set<string>();
  const meetings: DailyBriefMeeting[] = [];
  for (const e of todays) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const ctx = contextLineFor(e, input.meetings, input.identity, input.nowMs, input.timeZone);
    meetings.push({
      eventId: e.id,
      title: String(e.title ?? '').trim() || 'Meeting',
      startTime: e.startTime,
      ...(e.endTime ? { endTime: e.endTime } : {}),
      attendeeCount: briefAttendees(e, input.identity).length,
      recurring: !!e.recurringEventId || /_\d{8}(T\d{6}Z?)?$/.test(e.id),
      context: ctx.text,
      contextMeetingId: ctx.meetingId,
    });
  }
  return { meetings };
}
