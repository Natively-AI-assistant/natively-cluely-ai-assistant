/**
 * The Companion extension's meeting tabs → liveMeetings.
 *
 * Each connected browser sends `{type:'meeting-tabs', tabs:[…]}` while the app
 * wants them (PhoneMirrorService.setMeetingTabsWanted): its whole list of open
 * meeting tabs, as keys the extension computed itself (meetingLinks.ts) plus
 * the tab title and whether it is audible or in front. Never a full address.
 * Everything is re-validated here: a malformed key or an oversized title is
 * dropped, not trusted.
 */
import { providerOfKey } from './meetingLinks';
import { liveMeetings, type LiveMeeting, type LiveMeetings } from './liveMeetings';
import { callRoster, type CallRoster, type PersonReport } from './callRoster';

const MAX_TABS = 8;
const MAX_TITLE = 120;

/** A browser's reported tabs as live meetings; anything malformed is left out. */
export function meetingTabsToLive(raw: unknown, now: number): LiveMeeting[] {
    if (!Array.isArray(raw)) return [];
    const out: LiveMeeting[] = [];
    for (const tab of raw.slice(0, MAX_TABS)) {
        if (!tab || typeof tab !== 'object') continue;
        const t = tab as Record<string, unknown>;
        const provider = providerOfKey(t.key);
        if (!provider) continue;
        const title = typeof t.title === 'string'
            ? t.title.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE)
            : '';
        out.push({
            key: t.key as string,
            provider,
            via: 'browser',
            ...(title ? { title } : {}),
            audible: t.audible === true,
            focused: t.active === true,
            seenAt: now,
        });
    }
    return out;
}

const MAX_PEOPLE = 100;
const MAX_NAME = 80;

/**
 * A meeting page's report (`{type:'meeting-people', key, people:[{name, speaking}]}`)
 * re-validated: a well-formed key, names cleaned and bounded, the user's own
 * tile left out (the page marks it `self`). Null for anything malformed.
 */
export function meetingPeopleReport(raw: Record<string, unknown>): { key: string; people: PersonReport[] } | null {
    if (!providerOfKey(raw?.key) || !Array.isArray(raw.people)) return null;
    const people: PersonReport[] = [];
    const seen = new Set<string>();
    for (const p of raw.people.slice(0, MAX_PEOPLE)) {
        if (!p || typeof p !== 'object') continue;
        const person = p as Record<string, unknown>;
        if (person.self === true || typeof person.name !== 'string') continue;
        const name = person.name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        people.push({ name, speaking: person.speaking === true });
    }
    return { key: raw.key as string, people };
}

/** The slice of PhoneMirrorService this needs. */
export interface MeetingTabsChannel {
    onMeetingTabs(listener: ((socket: object | null, tabs: unknown) => void) | null): void;
    onMeetingPeople?(listener: ((socket: object, report: Record<string, unknown>) => void) | null): void;
    setMeetingTabsWanted(on: boolean): void;
}

/**
 * Feeds every connected browser's meeting tabs into `meetings`, keyed by its
 * socket; a closed socket's tabs go with it. `wanted` false asks the browsers
 * to stop and forgets what they sent.
 */
export function wireExtensionMeetingTabs(
    channel: MeetingTabsChannel,
    wanted: boolean,
    meetings: LiveMeetings = liveMeetings,
    roster: CallRoster = callRoster,
): void {
    // The calls each socket reported people for, so its going ends their open spans.
    const callsBySocket = new Map<object, Set<string>>();
    const endCalls = (socket: object) => {
        for (const key of callsBySocket.get(socket) ?? []) roster.end(key);
        callsBySocket.delete(socket);
    };
    channel.onMeetingTabs((socket, tabs) => {
        if (socket === null) {
            meetings.clearAll();
            for (const s of [...callsBySocket.keys()]) endCalls(s);
            return;
        }
        if (tabs === null) endCalls(socket);
        meetings.set(socket, tabs === null ? null : meetingTabsToLive(tabs, Date.now()));
    });
    channel.onMeetingPeople?.((socket, raw) => {
        const report = meetingPeopleReport(raw);
        if (!report) return;
        roster.report(report.key, report.people, Date.now());
        const keys = callsBySocket.get(socket) ?? new Set<string>();
        keys.add(report.key);
        callsBySocket.set(socket, keys);
    });
    channel.setMeetingTabsWanted(wanted);
}
