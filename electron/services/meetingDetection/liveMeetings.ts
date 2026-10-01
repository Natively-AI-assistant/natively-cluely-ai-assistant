/**
 * The meetings the user is in right now, as far as Natively can see: each
 * source (a browser's Companion extension, and in phase 2 the meeting apps'
 * own windows) reports its whole current list, and this keeps the union.
 *
 * Calendar linking reads it (SessionCalendarLinker): a live meeting whose key
 * is an event's meeting link makes the session that event. Best first: one
 * making sound (the call's audio) beats one in front, which beats the rest.
 */
import { EventEmitter } from 'events';
import type { MeetingProvider } from './meetingLinks';

export interface LiveMeeting {
    /** meetingLinks key (`meet:abc-defg-hij`), when the source knows which meeting. */
    key?: string;
    provider: MeetingProvider;
    /** A browser tab (the Companion extension) or a meeting app's window. */
    via: 'browser' | 'app';
    /** The tab or window title, for display (a notification, logs). */
    title?: string;
    /** Sound is playing in it: the call's audio. */
    audible?: boolean;
    /** It is the tab in front of its window, or the window in front. */
    focused?: boolean;
    /** When the source last reported it. */
    seenAt: number;
}

/** What the linker reads; LiveMeetings in the app, a fake in tests. */
export interface LiveMeetingSource {
    list(): LiveMeeting[];
    keys(): string[];
    on(event: 'change', listener: () => void): unknown;
    off(event: 'change', listener: () => void): unknown;
}

const rank = (m: LiveMeeting) => (m.audible ? 2 : 0) + (m.focused ? 1 : 0);

export class LiveMeetings extends EventEmitter implements LiveMeetingSource {
    private bySource = new Map<unknown, LiveMeeting[]>();
    private last = '[]';

    /** A source's complete current list (an empty list or null removes it). */
    set(source: unknown, meetings: LiveMeeting[] | null): void {
        if (meetings && meetings.length > 0) this.bySource.set(source, meetings);
        else this.bySource.delete(source);
        this.changed();
    }

    clearAll(): void {
        this.bySource.clear();
        this.changed();
    }

    list(): LiveMeeting[] {
        return [...this.bySource.values()].flat().sort((a, b) => rank(b) - rank(a) || b.seenAt - a.seenAt);
    }

    /** Distinct keys, best first. */
    keys(): string[] {
        return [...new Set(this.list().flatMap((m) => (m.key ? [m.key] : [])))];
    }

    private changed(): void {
        // Only a change in WHAT is live (not a re-report of it) notifies.
        const now = JSON.stringify(this.list().map(({ seenAt: _seenAt, ...m }) => m));
        if (now === this.last) return;
        this.last = now;
        this.emit('change');
    }
}

export const liveMeetings = new LiveMeetings();
