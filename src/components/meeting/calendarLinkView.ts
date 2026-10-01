/*
  The arithmetic behind the notes' calendar menu (CalendarLinkChip): which
  events the recording overlapped, who else was in each, and where each sits on
  the menu's timeline strip. Pure, so it is tested without a DOM.
*/

export interface LinkableEvent {
    id: string;
    startTime: string;
    endTime: string;
    attendees: Array<{ email: string; name?: string; response?: string }>;
}

/** When the recording ran, epoch ms (from main: the meeting's start_time + duration). */
export interface RecordingSpan {
    startMs: number;
    endMs: number;
}

const MIN = 60_000;

export const eventMs = (e: Pick<LinkableEvent, 'startTime' | 'endTime'>): [number, number] => {
    const a = Date.parse(e.startTime);
    const b = Date.parse(e.endTime);
    return [a, Number.isFinite(b) && b > a ? b : a];
};

/** Whole minutes of the event the recording covers; 0 when they don't meet. */
export function overlapMinutes(e: LinkableEvent, span: RecordingSpan | null | undefined): number {
    if (!span) return 0;
    const [a, b] = eventMs(e);
    return Math.max(0, Math.round((Math.min(b, span.endMs) - Math.max(a, span.startMs)) / MIN));
}

/** Events the recording overlapped, then the rest, each keeping the order it came in (nearest first). */
export function splitByRecording<T extends LinkableEvent>(events: T[], span: RecordingSpan | null | undefined): { during: T[]; around: T[] } {
    if (!span) return { during: [], around: events };
    const during: T[] = [];
    const around: T[] = [];
    for (const e of events) (overlapMinutes(e, span) > 0 ? during : around).push(e);
    return { during, around };
}

/** The attendees other than the user (matched on the connected calendar's address). */
export function otherAttendees<A extends { email: string }>(attendees: A[], selfEmail: string | undefined): A[] {
    const self = (selfEmail || '').trim().toLowerCase();
    return attendees.filter((a) => !!a.email && a.email.trim().toLowerCase() !== self);
}

export const displayName = (a: { email: string; name?: string }) => a.name?.trim() || a.email;
export const firstName = (a: { email: string; name?: string }) =>
    (a.name?.trim() || a.email.split('@')[0]).split(/\s+/)[0];

export function initials(a: { email: string; name?: string }, letters: 1 | 2 = 2): string {
    const parts = (a.name?.trim() || a.email.split('@')[0]).split(/[\s._-]+/).filter(Boolean);
    const s = ((parts[0]?.[0] || '?') + (letters === 2 && parts.length > 1 ? parts[1][0] : '')).toUpperCase();
    return s;
}

/** Up to `max` names and how many more there are. */
export function namesAndRest<A extends { email: string; name?: string }>(people: A[], max: number, name: (a: A) => string = displayName): { names: string[]; rest: number } {
    return { names: people.slice(0, max).map(name), rest: Math.max(0, people.length - max) };
}

/** 45 → { h: 0, m: 45 }; 90 → { h: 1, m: 30 }. */
export function durationParts(ms: number): { h: number; m: number } {
    const total = Math.max(0, Math.round(ms / MIN));
    return { h: Math.floor(total / 60), m: total % 60 };
}

export interface TimelineLayout {
    /** 0..1 across the strip. */
    at: (ms: number) => number;
    /** Fraction of the strip a span takes. */
    width: (fromMs: number, toMs: number) => number;
    /** Clock marks on whole half-hours or hours, never more than 6. */
    ticks: number[];
    /** Events in start order, one lane each, top to bottom. */
    lanes: string[];
}

/**
 * The strip spans the recording and every event. Ticks land on half-hours,
 * or on hours (then every 2 h) when that would be more than 6 marks.
 * Null when there is nothing to draw against.
 */
export function timelineLayout(events: LinkableEvent[], span: RecordingSpan | null | undefined): TimelineLayout | null {
    if (!span || span.endMs < span.startMs || !events.length) return null;
    const bounds = events.map(eventMs).filter(([a]) => Number.isFinite(a));
    const lo = Math.min(span.startMs, ...bounds.map(([a]) => a));
    const hi = Math.max(span.endMs, ...bounds.map(([, b]) => b));
    const range = Math.max(hi - lo, MIN);
    const stepMin = [30, 60, 120, 240, 480].find((s) => Math.floor(range / (s * MIN)) + 1 <= 6) ?? 480;
    // The first local clock time at or after lo that is a whole multiple of the step.
    const hour = new Date(lo);
    hour.setMinutes(0, 0, 0);
    let t = hour.getTime();
    const onStep = (ms: number) => {
        const d = new Date(ms);
        return (d.getHours() * 60 + d.getMinutes()) % stepMin === 0;
    };
    while (t < lo || !onStep(t)) t += 30 * MIN;
    const ticks: number[] = [];
    for (; t <= hi && ticks.length < 6; t += stepMin * MIN) ticks.push(t);
    const lanes = [...events].sort((p, q) => eventMs(p)[0] - eventMs(q)[0]).map((e) => e.id);
    return {
        at: (ms) => (ms - lo) / range,
        width: (a, b) => Math.max(0, b - a) / range,
        ticks,
        lanes,
    };
}
