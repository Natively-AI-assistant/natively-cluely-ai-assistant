/**
 * Which calendar event a Natively session belongs to, decided from time alone.
 *
 * Every start, not just one from the calendar notification, asks this which
 * event is on now. The answer names the meeting (its title), who was in it (its
 * attendees: the follow-up's recipients and, for a 1:1, the other speaker's
 * name) and what it was for. A wrong answer poisons all of that, so it links
 * only on a clear winner and says "ambiguous" otherwise; the meeting notes then
 * offer the candidates rather than guessing.
 *
 * How the others do it (researched 2026-09-27): Krisp matches the recording's
 * time to the event's; Granola links the note you open at or after an event's
 * start and pre-arms one opened early; bots (Otter, Fireflies, Fathom) are the
 * event, so need no matching. Natively has no meeting-app signal at start, so
 * time and the event's own shape (other people on it) are the evidence.
 *
 * Pure, with no Electron and no I/O, so the tests run it directly.
 */

export interface MatchableAttendee {
    email: string;
    name?: string;
    response?: string;
}

export interface MatchableEvent {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    link?: string;
    attendees?: MatchableAttendee[];
    /** The user's own RSVP on the event ('declined' events never match). */
    selfResponse?: string;
}

/** What a meeting keeps of its event, so nothing later depends on the event still being "upcoming". */
export interface CalendarEventSnapshot {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    link?: string;
    attendees: MatchableAttendee[];
    /** How the link was made: at start, from the notification, when an early start reached the event, or by the user. */
    linkedBy: 'start' | 'notification' | 'late' | 'user';
}

/** A session started up to this long before an event can belong to it. */
export const MATCH_LEAD_MS = 10 * 60_000;
/** An in-progress event this close to its end yields to one that is starting. */
export const ENDING_SOON_MS = 5 * 60_000;
/** Two candidates must be at least this far apart in start time for one to win outright. */
export const CLEAR_MARGIN_MS = 5 * 60_000;
/** An unlinked session re-checks when an event this soon reaches its window. */
export const LATE_LINK_LOOKAHEAD_MS = 30 * 60_000;

export type SessionMatch<E extends MatchableEvent = MatchableEvent> =
    | { kind: 'linked'; event: E }
    | { kind: 'ambiguous'; candidates: E[] }
    | { kind: 'none'; next?: E };

const timeOf = (iso: string) => new Date(iso).getTime();
const declined = (e: MatchableEvent) => e.selfResponse === 'declined';
/** Someone other than the user is on it (and hasn't declined): a meeting, not a focus block. */
export const hasOthers = (e: MatchableEvent) =>
    (e.attendees ?? []).some((a) => !!a.email && a.response !== 'declined');

/**
 * The event a session starting at `nowMs` belongs to.
 *
 * 1. Candidates: not declined, and `nowMs` within [start − 10 min, end].
 * 2. An in-progress event ending within 5 min yields to any other candidate
 *    (back-to-back: starting at 10:28 is for the 10:30, not the 10:00–10:30).
 * 3. Events with other people beat solo blocks.
 * 4. One left: linked. Several: the nearest start wins by 5 min or more, unless
 *    one is under way and the other hasn't started, where joining late and
 *    joining early are equally likely: ambiguous.
 * No candidate: `next` is the soonest event with others starting within 30 min,
 * for a re-check when it reaches its window.
 */
export function matchEventForSession<E extends MatchableEvent>(events: E[], nowMs: number): SessionMatch<E> {
    const valid = events.filter((e) => Number.isFinite(timeOf(e.startTime)) && Number.isFinite(timeOf(e.endTime)) && !declined(e));
    let candidates = valid.filter((e) => nowMs >= timeOf(e.startTime) - MATCH_LEAD_MS && nowMs <= timeOf(e.endTime));

    if (candidates.length === 0) {
        const next = valid
            .filter((e) => hasOthers(e))
            .filter((e) => {
                const start = timeOf(e.startTime);
                return start - MATCH_LEAD_MS > nowMs && start - nowMs <= LATE_LINK_LOOKAHEAD_MS;
            })
            .sort((a, b) => timeOf(a.startTime) - timeOf(b.startTime))[0];
        return next ? { kind: 'none', next } : { kind: 'none' };
    }

    const notEnding = candidates.filter((e) => !(timeOf(e.startTime) <= nowMs && timeOf(e.endTime) - nowMs <= ENDING_SOON_MS));
    if (notEnding.length > 0) candidates = notEnding;
    const withOthers = candidates.filter(hasOthers);
    if (withOthers.length > 0) candidates = withOthers;

    if (candidates.length === 1) return { kind: 'linked', event: candidates[0] };

    const byDistance = [...candidates].sort(
        (a, b) => Math.abs(nowMs - timeOf(a.startTime)) - Math.abs(nowMs - timeOf(b.startTime)),
    );
    const [first, second] = byDistance;
    const firstStarted = timeOf(first.startTime) <= nowMs;
    const secondStarted = timeOf(second.startTime) <= nowMs;
    const margin = Math.abs(nowMs - timeOf(second.startTime)) - Math.abs(nowMs - timeOf(first.startTime));
    if (firstStarted === secondStarted && margin >= CLEAR_MARGIN_MS) return { kind: 'linked', event: first };
    return { kind: 'ambiguous', candidates: byDistance };
}

/** The event as a meeting keeps it. */
export function toEventSnapshot(event: MatchableEvent, linkedBy: CalendarEventSnapshot['linkedBy']): CalendarEventSnapshot {
    return {
        id: event.id,
        title: event.title,
        startTime: event.startTime,
        endTime: event.endTime,
        ...(event.link ? { link: event.link } : {}),
        attendees: (event.attendees ?? [])
            .filter((a) => !!a.email)
            .map((a) => ({ email: a.email, ...(a.name ? { name: a.name } : {}), ...(a.response ? { response: a.response } : {}) })),
        linkedBy,
    };
}

/** A display name worth putting on a speaker: a real name, not an address. */
const personName = (name?: string) => {
    const clean = (name ?? '').replace(/\s+/g, ' ').trim();
    return clean && !clean.includes('@') ? clean.slice(0, 80) : null;
};

/**
 * Speaker names a linked meeting can give its transcript, keyed like the
 * user's own renames (SpeakerLabelService): the mic is always the user, so
 * `me` takes their name; in a 1:1 (exactly one other attendee who hasn't
 * declined, with a real display name) the system audio is that person, so
 * `speaker_1` takes theirs. In a group call the other voices share one
 * channel and stay "Speaker 1". Null when there is nothing to name.
 */
export function calendarSpeakerLabels(snapshot: CalendarEventSnapshot, userName?: string): Record<string, string> | null {
    const labels: Record<string, string> = {};
    const me = personName(userName);
    if (me) labels.me = me;
    const others = snapshot.attendees.filter((a) => a.response !== 'declined');
    if (others.length === 1) {
        const them = personName(others[0].name);
        if (them && them !== me) labels.speaker_1 = them;
    }
    return Object.keys(labels).length > 0 ? labels : null;
}

const EMPTY_SNAPSHOT: CalendarEventSnapshot = { id: '', title: '', startTime: '', endTime: '', attendees: [], linkedBy: 'user' };
const sameLabels = (a: Record<string, string>, b: Record<string, string>) =>
    JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/**
 * A meeting moved to another event (or to none) from its notes: the speaker
 * labels the OLD link gave it follow to the new one, so a wrong 1:1 guess does
 * not leave the wrong person's name behind. Labels the user set (anything other
 * than what the old link produced) are theirs and stay: null, no change. Also
 * null when nothing would change. Unlinking keeps only `me`.
 */
export function relinkSpeakerLabels(
    current: Record<string, string> | undefined,
    oldSnapshot: CalendarEventSnapshot | undefined,
    newSnapshot: CalendarEventSnapshot | null,
    userName?: string,
): Record<string, string> | null {
    const labelsFor = (snap: CalendarEventSnapshot | null | undefined) => calendarSpeakerLabels(snap ?? EMPTY_SNAPSHOT, userName) ?? {};
    const now = current ?? {};
    const untouched = Object.keys(now).length === 0 || sameLabels(now, labelsFor(oldSnapshot));
    if (!untouched) return null;
    const next = labelsFor(newSnapshot);
    return sameLabels(now, next) ? null : next;
}
