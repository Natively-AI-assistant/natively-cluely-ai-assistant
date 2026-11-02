// Resume a saved meeting (2026-11-02), as Granola's "Resume": recording starts
// again INTO THE SAME MEETING. Same id, so the meeting list keeps one row; the
// new transcript is added after the old one; the user's notes, the title and
// the calendar link are kept; Stop rewrites the notes over the whole meeting
// and keeps the previous notes as an earlier version.
//
// Where Resume is offered follows the surface the meeting was taken on
// (Settings › Overlay's switcher, utils/meetingSurface.ts):
//
//   overlay   on the meeting page, left of "Ask about this meeting".
//   notepad   only in the notepad, on the row with "Ask anything".
//
// Meetings saved before the surface was stored count as overlay meetings.
//
// Pure: no electron, no database. The same on macOS and Windows
// (MeetingResume2026_11_02.test.mjs).

export type MeetingSurfaceKind = 'overlay' | 'notepad';

/** The surface a saved meeting was taken on; anything else (older meetings) is the overlay. */
export function savedMeetingSurface(value: unknown): MeetingSurfaceKind {
    return value === 'notepad' ? 'notepad' : 'overlay';
}

/** Where a saved meeting's Resume button lives. */
export function resumeSpot(surface: unknown): 'page' | 'notepad' {
    return savedMeetingSurface(surface) === 'notepad' ? 'notepad' : 'page';
}

/** The notes are being written (Stop's pass, a recovery or a Regenerate). */
export function isNotesPendingStatus(status: unknown): boolean {
    return typeof status === 'string' && ['queued', 'chunking', 'summarizing_chunks', 'reducing', 'validating'].includes(status);
}

/** Why Resume (or opening a saved meeting in the notepad) cannot run right now. */
export type ResumeBlock = 'not-found' | 'meeting-running';

/**
 * A running meeting owns the microphone and the notepad. Notes still being
 * written do NOT block a resume (Granola resumes at once): the resume takes the
 * meeting over and the pass writing them stops before it saves
 * (MeetingPersistence.claimWriter); the resumed Stop writes the notes over the
 * whole meeting.
 */
export function resumeBlockReason(input: { exists: boolean; meetingActive: boolean }): ResumeBlock | null {
    if (!input.exists) return 'not-found';
    if (input.meetingActive) return 'meeting-running';
    return null;
}

/** Opening a saved meeting in the notepad: the same rule as Resume. */
export const openInNotepadBlockReason = resumeBlockReason;

/** The saved meeting a resumed session continues. */
export interface ResumeBase {
    meetingId: string;
    transcript: any[];
    usage: any[];
    /** The meeting's original start (kept). */
    startTime: number;
    /** How long it ran before the resume. */
    durationMs: number;
    title?: string;
    calendarEventId?: string;
    calendarEvent?: any;
    source?: 'manual' | 'calendar';
    userNotes?: string;
    surface: MeetingSurfaceKind;
    /** What the saved notes carry into the resumed notes (resumeCarryFrom). */
    carry?: ResumeCarry;
}

/**
 * What a resumed meeting's notes keep from the saved meeting (2026-11-02), as
 * Regenerate keeps them: the speaker names (the user's renames, the calendar's
 * and the call's), the people who were in the call, what was shared on screen
 * in the first part, and a follow-up draft already written. Without this the
 * resumed Stop wrote the notes from the second part's session alone, and the
 * first part's names and screens were lost.
 */
export interface ResumeCarry {
    speakerLabels?: Record<string, string>;
    callParticipants?: string[];
    sharedScreens?: any[];
    followUpDraft?: unknown;
}

const labelMap = (v: unknown): Record<string, string> | undefined => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out: Record<string, string> = {};
    for (const [k, name] of Object.entries(v as Record<string, unknown>)) {
        if (typeof name === 'string' && name.trim()) out[k] = name;
    }
    return Object.keys(out).length > 0 ? out : undefined;
};
const nameList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : []);
const screenList = (v: unknown): any[] => (Array.isArray(v) ? v.filter((e) => e && typeof e === 'object' && typeof (e as any).text === 'string' && typeof (e as any).at === 'number') : []);

/** Both lists, earlier first, each entry once (screens by time and text, names by name). */
function mergeScreens(earlier: any[], later: any[]): any[] {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const e of [...earlier, ...later]) {
        const key = `${e.at}|${e.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(e);
    }
    return out.sort((a, b) => a.at - b.at).slice(0, 200);
}
const mergeNames = (earlier: string[], later: string[]): string[] => [...new Set([...earlier, ...later])];

/**
 * The carry from the saved row's notes and, for a row still waiting for its
 * notes (the placeholder, whose notes are empty), what Stop saved with it
 * (its recovery metadata: the screens, and an earlier resume's carry).
 */
export function resumeCarryFrom(detailed: unknown, pending?: { sharedScreens?: unknown; resumeCarry?: unknown } | null): ResumeCarry | undefined {
    const d = (detailed && typeof detailed === 'object') ? detailed as Record<string, unknown> : {};
    const earlier = (pending?.resumeCarry && typeof pending.resumeCarry === 'object') ? pending.resumeCarry as ResumeCarry : {};
    const carry: ResumeCarry = {};
    const labels = { ...(labelMap(earlier.speakerLabels) ?? {}), ...(labelMap(d.speakerLabels) ?? {}) };
    if (Object.keys(labels).length > 0) carry.speakerLabels = labels;
    const people = mergeNames(nameList(earlier.callParticipants), nameList(d.callParticipants));
    if (people.length > 0) carry.callParticipants = people;
    const screens = mergeScreens(screenList(earlier.sharedScreens), [...screenList(d.sharedScreens), ...screenList(pending?.sharedScreens)]);
    if (screens.length > 0) carry.sharedScreens = screens;
    const draft = d.followUpDraft ?? earlier.followUpDraft;
    if (draft !== undefined && draft !== null) carry.followUpDraft = draft;
    return Object.keys(carry).length > 0 ? carry : undefined;
}

/** The screens the resumed notes are written from: the first part's, then this part's. */
export function resumedSharedScreens(carry: ResumeCarry | undefined | null, current: unknown): any[] {
    return mergeScreens(screenList(carry?.sharedScreens), screenList(current));
}

/**
 * The resumed meeting's saved notes with the carry applied: names the saved
 * meeting had win over ones worked out again (a rename the user made always
 * wins, as for a single meeting); both parts' people; a follow-up draft kept
 * unless the new notes wrote one.
 */
export function applyResumeCarry<T extends Record<string, any>>(summary: T, carry: ResumeCarry | undefined | null): T {
    if (!carry || !summary || typeof summary !== 'object') return summary;
    const out: Record<string, any> = { ...summary };
    if (carry.speakerLabels) out.speakerLabels = { ...(labelMap(summary.speakerLabels) ?? {}), ...carry.speakerLabels };
    if (carry.callParticipants?.length) out.callParticipants = mergeNames(carry.callParticipants, nameList(summary.callParticipants));
    if (carry.sharedScreens?.length) out.sharedScreens = mergeScreens(carry.sharedScreens, screenList(summary.sharedScreens));
    if (out.followUpDraft === undefined && carry.followUpDraft !== undefined) out.followUpDraft = carry.followUpDraft;
    return out as T;
}

/** The saved meeting, as the database gives it, made into what a resume needs. */
export function resumeBaseFrom(
    details: { id: string; title?: string; transcript?: any[]; usage?: any[]; calendarEventId?: string | null; calendarEvent?: any; source?: string | null; userNotes?: string | null; surface?: unknown } | null,
    timing: { startTime: number; durationMs: number } | null,
): ResumeBase | null {
    if (!details || typeof details.id !== 'string' || !details.id) return null;
    const startTime = timing && Number.isFinite(timing.startTime) && timing.startTime > 0 ? timing.startTime : Date.now();
    const durationMs = timing && Number.isFinite(timing.durationMs) && timing.durationMs > 0 ? timing.durationMs : 0;
    const base: ResumeBase = {
        meetingId: details.id,
        transcript: Array.isArray(details.transcript) ? [...details.transcript] : [],
        usage: Array.isArray(details.usage) ? [...details.usage] : [],
        startTime,
        durationMs,
        surface: savedMeetingSurface(details.surface),
    };
    const title = typeof details.title === 'string' ? details.title.trim() : '';
    if (title) base.title = title;
    if (typeof details.calendarEventId === 'string' && details.calendarEventId) base.calendarEventId = details.calendarEventId;
    if (details.calendarEvent && typeof details.calendarEvent === 'object') base.calendarEvent = details.calendarEvent;
    if (details.source === 'manual' || details.source === 'calendar') base.source = details.source;
    if (typeof details.userNotes === 'string' && details.userNotes.trim()) base.userNotes = details.userNotes;
    return base;
}

/**
 * The whole meeting at a resumed Stop: the saved lines, then the new ones
 * (oldest first, in case a clock moved), the answers likewise, the original
 * start, and the two running times added (the gap between them is not counted).
 */
export function mergeResumedMeeting<T extends { timestamp?: number }>(
    base: Pick<ResumeBase, 'transcript' | 'usage' | 'startTime' | 'durationMs'>,
    live: { transcript: T[]; usage: any[]; durationMs: number },
): { transcript: T[]; usage: any[]; startTime: number; durationMs: number } {
    const byTime = (a: { timestamp?: number }, b: { timestamp?: number }) => (Number(a?.timestamp) || 0) - (Number(b?.timestamp) || 0);
    // A stable sort keeps the order within each part when timestamps tie.
    const transcript = [...(base.transcript as T[]), ...live.transcript].map((s, i) => ({ s, i }))
        .sort((x, y) => byTime(x.s, y.s) || x.i - y.i).map(({ s }) => s);
    const usage = [...base.usage, ...live.usage].map((u, i) => ({ u, i }))
        .sort((x, y) => byTime(x.u, y.u) || x.i - y.i).map(({ u }) => u);
    return {
        transcript,
        usage,
        startTime: base.startTime,
        durationMs: Math.max(0, base.durationMs) + Math.max(0, live.durationMs),
    };
}

/** What a resumed meeting's notes are written with: its title (unless a placeholder), event and source. */
export function resumeMetadata(base: ResumeBase, isPlaceholderTitle: (t: string) => boolean): { title?: string; calendarEventId?: string; calendarEvent?: any; source?: 'manual' | 'calendar' } {
    const meta: { title?: string; calendarEventId?: string; calendarEvent?: any; source?: 'manual' | 'calendar' } = {};
    if (base.title && !isPlaceholderTitle(base.title)) meta.title = base.title;
    if (base.calendarEventId) meta.calendarEventId = base.calendarEventId;
    if (base.calendarEvent && (!base.calendarEventId || base.calendarEvent.id === base.calendarEventId)) meta.calendarEvent = base.calendarEvent;
    if (base.source) meta.source = base.source;
    return meta;
}

/**
 * Where the resumed part starts (2026-11-02): its own start and running time,
 * not the whole meeting's (whose start is the first part's and whose time
 * leaves out the gap between the parts). Lines from before it are the saved
 * part: they keep the speaker ids they were saved with.
 */
export interface ResumePart {
    startTime: number;
    durationMs: number;
}

export function isResumePart(v: unknown): v is ResumePart {
    const p = v as ResumePart;
    return !!p && typeof p === 'object' && Number.isFinite(p.startTime) && p.startTime > 0 && Number.isFinite(p.durationMs) && p.durationMs >= 0;
}

/** A line saved before the resume (it was said before the resumed part started). */
export function isSavedPartLine(line: { timestamp?: unknown } | null | undefined, part: ResumePart | null | undefined): boolean {
    if (!part) return false;
    const ts = Number(line?.timestamp);
    return !(Number.isFinite(ts) && ts >= part.startTime);
}

const SPEAKER_N = /^Speaker (\d+)$/i;

/**
 * Every speaker id the saved part already uses: its call ids, the ids its
 * names are kept under, and the room voices it numbered ("Speaker 3" is
 * speaker_3). The resumed part numbers its new people past these, so a new
 * voice never takes a number someone in the first part has (and that the user
 * may have renamed).
 */
export function savedPartSpeakerIds(lines: Array<{ speaker?: unknown; speakerId?: unknown; timestamp?: unknown }>, part: ResumePart | null | undefined, savedLabels?: Record<string, string> | null): Set<string> {
    const used = new Set<string>(Object.keys(savedLabels ?? {}));
    for (const l of lines) {
        if (!isSavedPartLine(l, part)) continue;
        if (typeof l.speakerId === 'string' && l.speakerId) used.add(l.speakerId);
        const m = typeof l.speaker === 'string' ? SPEAKER_N.exec(l.speaker.trim()) : null;
        if (m) used.add(`speaker_${m[1]}`);
    }
    return used;
}

const nextFree = (used: Set<string>): string => {
    let n = 2;
    while (used.has(`speaker_${n}`)) n++;
    return `speaker_${n}`;
};

/**
 * The resumed part's call names (nameCallLines over its lines only) fitted to
 * the saved part's: a person the saved meeting already names keeps that id
 * (and so the user's rename of it); anyone new gets an id no saved line uses.
 * Returns the whole meeting's lines, the saved part's untouched.
 */
export function fitResumedCallNames<T extends { speakerId?: string }>(
    full: T[],
    resumedIndexes: number[],
    named: { transcript: T[]; labels: Record<string, string>; confidence: Record<string, number>; participants: string[] },
    reserved: Set<string>,
    savedLabels?: Record<string, string> | null,
): { transcript: T[]; labels: Record<string, string>; confidence: Record<string, number>; participants: string[] } {
    const key = (name: string) => name.trim().toLowerCase();
    const savedIdOf = new Map<string, string>();
    for (const [id, name] of Object.entries(savedLabels ?? {})) {
        if (typeof name === 'string' && name.trim() && !savedIdOf.has(key(name))) savedIdOf.set(key(name), id);
    }
    const used = new Set(reserved);
    const idFor = new Map<string, string>();
    for (const [id, name] of Object.entries(named.labels)) {
        const same = typeof name === 'string' ? savedIdOf.get(key(name)) : undefined;
        const target = same ?? (used.has(id) ? nextFree(used) : id);
        used.add(target);
        idFor.set(id, target);
    }
    const labels: Record<string, string> = {};
    const confidence: Record<string, number> = {};
    for (const [id, name] of Object.entries(named.labels)) labels[idFor.get(id)!] = name;
    for (const [id, c] of Object.entries(named.confidence)) if (idFor.has(id)) confidence[idFor.get(id)!] = c;
    const targets = new Set(idFor.values());
    const transcript = [...full];
    resumedIndexes.forEach((fullIndex, i) => {
        const line = named.transcript[i];
        const id = line?.speakerId;
        if (id && idFor.has(id)) { transcript[fullIndex] = { ...line, speakerId: idFor.get(id)! } as T; return; }
        // A provider voice id that equals a name's new id would read as that
        // person (nameCallLines drops the same clash): the line keeps its channel.
        if (id && (targets.has(id) || reserved.has(id))) {
            const { speakerId: _clash, ...rest } = line as T & { speakerId?: string };
            transcript[fullIndex] = rest as T;
            return;
        }
        transcript[fullIndex] = line;
    });
    return { transcript, labels, confidence, participants: named.participants };
}
