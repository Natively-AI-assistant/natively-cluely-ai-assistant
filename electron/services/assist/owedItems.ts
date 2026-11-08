// owedItems.ts
//
// The open action items the user owns, across recent meetings: Brief me's
// "Yours to do" (meetingBrief). The launcher's own list of them ("You owe",
// then Loose Ends) came out 2026-10-17.
//
// An item is the user's when its owner is the user ("Me", their name or first
// name, their address: assistPeople.ownerIsUser). Items the notes already mark
// done are left out, and so is anything ticked in that list before it came out
// (kept locally, AssistService). A ticked item comes back only when a LATER
// meeting raises it again, which is a new promise, not the old one.
//
// The same promise carried from meeting to meeting (a weekly sync) shows once:
// linked to the newest meeting that mentions it, aged from the first.
//
// Order: overdue first (the most overdue at the top), then those with a
// deadline (soonest first), then the rest, oldest first.
//
// Pure, no I/O, no platform branches.

import { ownerIsUser, type UserIdentity } from './assistPeople';
import { ASSIST_LONGEST_LOOKBACK_DAYS, DAY_MS, latestTaskStates, meetingTitle, normalizeItemText, parseDeadline, type AssistMeeting } from './assistNotes';

export interface OwedItem {
  /** Stable across meetings: the item's text, normalised. What "done" is stored under. */
  key: string;
  text: string;
  owner?: string;
  deadline?: string;
  /** End of the deadline's day, or null when the deadline is not a date Natively can read. */
  dueMs: number | null;
  overdue: boolean;
  /** The newest meeting that mentions it (where it is opened from). */
  meetingId: string;
  meetingTitle: string;
  meetingStartMs: number;
  /** When it was first raised. */
  sinceMs: number;
}

/** Ticked items: key -> when it was ticked. */
export type DoneMap = Record<string, number>;

export const OWED_LOOKBACK_DAYS = 30;
export const OWED_MAX_ITEMS = 50;

/**
 * What a tick is stored under: the task's text and the meeting that first
 * raised it, so the same words from an unrelated meeting are another task.
 */
export function owedItemKey(text: string, originMeetingId: string): string {
  return `owed:${originMeetingId}:${normalizeItemText(text).slice(0, 200)}`;
}

/** The text-only key ticks had before 2026-10-15's review; still read, never written. */
export function legacyOwedItemKey(text: string): string {
  return `owed:${normalizeItemText(text).slice(0, 200)}`;
}

export interface CollectOwedOptions {
  nowMs: number;
  done?: DoneMap;
  lookbackDays?: number;
  limit?: number;
  /** Only tasks raised in a meeting whose invite includes one of these addresses (the brief: items involving these people). */
  withEmails?: Set<string>;
  /** The user's IANA time zone, for reading deadlines; this machine's clock when absent. */
  timeZone?: string;
}

/** Sort as the list shows: overdue, then due soonest, then oldest. */
export function compareOwed(a: OwedItem, b: OwedItem): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  const ad = a.dueMs ?? Infinity;
  const bd = b.dueMs ?? Infinity;
  if (ad !== bd) return ad - bd;
  if (a.sinceMs !== b.sinceMs) return a.sinceMs - b.sinceMs;
  return a.text.localeCompare(b.text);
}

export function collectOwedItems(meetings: AssistMeeting[], identity: UserIdentity, opts: CollectOwedOptions): OwedItem[] {
  const lookbackMs = (opts.lookbackDays ?? OWED_LOOKBACK_DAYS) * DAY_MS;
  const done = opts.done ?? {};
  // Chains are ALWAYS built over the longest assist lookback, whatever this
  // view shows, so a task's key (the meeting that first raised it) is the
  // same in the launcher (30 days) and in Brief me (180), and does not move
  // as the view's window slides past that meeting. The view's own window
  // only decides what is shown: tasks last mentioned inside it.
  const chainMs = Math.max(lookbackMs, ASSIST_LONGEST_LOOKBACK_DAYS * DAY_MS);
  const inChainWindow = meetings.filter((m) => m && Number.isFinite(m.startMs) && m.startMs <= opts.nowMs && opts.nowMs - m.startMs <= chainMs);
  // Each task's newest state first (assistNotes.latestTaskStates): the user's
  // tasks share one owner key, so "Me" and "Evin" are the same task, and a
  // later RELATED meeting that marks it done closes it; an unrelated one
  // with the same words does not.
  const states = latestTaskStates(inChainWindow, (a) => (ownerIsUser(a.owner, identity) ? 'user' : null), { selfEmails: identity.emails });
  const out: OwedItem[] = [];
  for (const st of states.values()) {
    if (st.done) continue;
    if (opts.nowMs - st.meeting.startMs > lookbackMs) continue;
    if (opts.withEmails && opts.withEmails.size > 0) {
      const withThem = st.meetings.some((m) => {
        const emails = new Set((m.calendarEvent?.attendees ?? []).map((a) => String(a?.email ?? '').toLowerCase()));
        const org = (m.calendarEvent as any)?.organizer?.email;
        if (org) emails.add(String(org).toLowerCase());
        return [...opts.withEmails!].some((e) => emails.has(e));
      });
      if (!withThem) continue;
    }
    const key = owedItemKey(st.action.text, st.meetings[0].id);
    // Ticks saved before keys named the raising meeting were stored by text alone.
    const tickedAt = done[key] ?? done[legacyOwedItemKey(st.action.text)];
    // Ticked here: hidden, unless a meeting after the tick raised it again.
    if (typeof tickedAt === 'number' && st.meeting.startMs <= tickedAt) continue;
    // Read against the meeting that SET the deadline, not a later repeat without one.
    const dueMs = parseDeadline(st.action.deadline, st.deadlineFromMs, opts.timeZone);
    out.push({
      key,
      text: st.action.text,
      ...(st.action.owner ? { owner: st.action.owner } : {}),
      ...(st.action.deadline ? { deadline: st.action.deadline } : {}),
      dueMs,
      overdue: dueMs !== null && dueMs < opts.nowMs,
      meetingId: st.meeting.id,
      meetingTitle: meetingTitle(st.meeting),
      meetingStartMs: st.meeting.startMs,
      sinceMs: st.firstSeenMs,
    });
  }
  return out.sort(compareOwed).slice(0, opts.limit ?? OWED_MAX_ITEMS);
}
