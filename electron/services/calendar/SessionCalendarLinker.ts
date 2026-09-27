/**
 * Links a starting Natively session to its calendar event (calendarSessionMatch.ts
 * decides which), by filling in the session's meeting metadata in place: the
 * session keeps this same object, and the meeting is saved from it at stop.
 *
 *   calendarEventId   the event's id (the conversation key and trace already read it)
 *   calendarEvent     a snapshot: title, times, link and attendees, kept with the
 *                     meeting so the follow-up and speaker names never depend on
 *                     the event still being "upcoming"
 *   title, source     the event's title (only when the start gave none), 'calendar'
 *
 * It decides at once from the list the Launcher and Settings keep fresh, so it
 * never delays a start. With no fresh list, a bounded fetch finishes the job
 * while the meeting is still this one. A session started early, before any
 * event's window, re-checks when the next meeting reaches it. Every late write
 * first checks that the meeting is still running and still this one (each
 * start takes a new token; ending the meeting spends it), so it can never land
 * on the next meeting.
 */
import { matchEventForSession, toEventSnapshot, MATCH_LEAD_MS, type MatchableEvent } from './calendarSessionMatch';

/** How old the cached list may be for a start to trust it. */
const CACHE_MAX_AGE_MS = 10 * 60_000;
/** How long a start may wait on Google when there is no fresh list. */
const FETCH_BUDGET_MS = 8_000;

let lateTimer: ReturnType<typeof setTimeout> | null = null;
/** The current start's token; a late write for an older one is dropped. */
let linkToken = 0;

/** Drops a pending re-check and spends the token. Called when a meeting ends and before a new one links. */
export function cancelSessionCalendarLink(): void {
    if (lateTimer) clearTimeout(lateTimer);
    lateTimer = null;
    linkToken++;
}

/** Where the linker reads events from: CalendarManager in the app, a fake in tests. */
export interface CalendarSource {
    getConnectionStatus(): { connected: boolean };
    getCachedEvents(maxAgeMs: number): MatchableEvent[] | null;
    getUpcomingEvents(): Promise<MatchableEvent[]>;
}

function defaultCalendar(): CalendarSource | null {
    try {
        const { CalendarManager } = require('../CalendarManager');
        return CalendarManager.getInstance();
    } catch {
        return null;
    }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), ms);
        promise.then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(null); });
    });
}

/**
 * Fills `metadata` in from the calendar. `isActive` says a meeting is running;
 * together with this start's token it guards every write that happens after
 * this call returns.
 */
export function linkSessionToCalendar(metadata: any, isActive: () => boolean, source: CalendarSource | null = defaultCalendar()): void {
    cancelSessionCalendarLink();
    const token = linkToken;
    if (!metadata || typeof metadata !== 'object') return;
    const cm = source;
    if (!cm || !cm.getConnectionStatus().connected) return;
    const stillThisMeeting = () => isActive() && token === linkToken;

    const apply = (events: MatchableEvent[]) => {
        // Started from the calendar notification: the event is known; keep its snapshot.
        if (metadata.calendarEventId) {
            if (metadata.calendarEvent) return;
            const known = events.find((e) => e.id === metadata.calendarEventId);
            if (known) metadata.calendarEvent = toEventSnapshot(known, 'notification');
            return;
        }
        const match = matchEventForSession(events, Date.now());
        if (match.kind === 'linked') {
            link(match.event, 'start');
        } else if (match.kind === 'ambiguous') {
            console.log(`[SessionCalendarLinker] ${match.candidates.length} events fit this start equally; left unlinked (the notes offer them).`);
        } else if (match.next) {
            scheduleLateLink(match.next);
        }
    };

    const link = (event: MatchableEvent, linkedBy: 'start' | 'late') => {
        metadata.calendarEventId = event.id;
        metadata.calendarEvent = toEventSnapshot(event, linkedBy);
        metadata.source = 'calendar';
        if (!metadata.title) metadata.title = event.title;
        console.log(`[SessionCalendarLinker] linked to "${event.title}" (${linkedBy}).`);
    };

    // Started early: when the next meeting reaches its window, look again.
    const scheduleLateLink = (next: MatchableEvent) => {
        const at = new Date(next.startTime).getTime() - MATCH_LEAD_MS;
        lateTimer = setTimeout(async () => {
            lateTimer = null;
            if (!stillThisMeeting() || metadata.calendarEventId) return;
            const fresh = cm.getCachedEvents(CACHE_MAX_AGE_MS) ?? await withTimeout(cm.getUpcomingEvents(), FETCH_BUDGET_MS);
            if (!fresh || !stillThisMeeting() || metadata.calendarEventId) return;
            const match = matchEventForSession(fresh, Date.now());
            if (match.kind === 'linked') link(match.event, 'late');
        }, Math.max(0, at - Date.now()) + 1_000);
    };

    const cached = cm.getCachedEvents(CACHE_MAX_AGE_MS);
    if (cached) {
        apply(cached);
        return;
    }
    void withTimeout(cm.getUpcomingEvents(), FETCH_BUDGET_MS).then((events) => {
        if (events && stillThisMeeting()) apply(events);
    });
}
