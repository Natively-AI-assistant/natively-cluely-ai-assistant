/**
 * Is the user in a call right now, and which? Decided from:
 *
 *   - who holds a microphone (native getMicUsers), minus Natively itself;
 *   - the browsers' meeting tabs (liveMeetings, from the Companion extension);
 *   - window titles (native getVisibleWindows), read only when needed.
 *
 * A meeting app holding the microphone is a call (Zoom, Teams, Webex, Slack,
 * Discord, FaceTime). A browser holding it is a call only with evidence of a
 * meeting in it: a meeting tab, or a window titled like one; a browser recording
 * a voice note is not a meeting. Without microphone information (macOS before
 * 14, or no native module), a meeting tab playing sound counts.
 *
 * Pure: platform and readers are passed in, so both OS branches are tested.
 */
import { appOfProcess, isSelf, meetingNameOfTitle, meetingServiceOfTitle, type ProcessRef, type SelfIdentity } from './meetingApps';
import type { LiveMeeting } from './liveMeetings';
import type { MeetingProvider } from './meetingLinks';

export interface WindowRef {
    pid: number;
    owner: string;
    title: string;
    path?: string;
}

export interface Detection {
    /** Stable for the call: one prompt per id. */
    id: string;
    /** What the user would call it: "Zoom", "Google Meet". */
    app: string;
    via: 'app' | 'browser';
    /** The meeting's name when a title carries one. */
    title?: string;
    /** meetingLinks key, when known (a meeting tab). */
    key?: string;
}

export interface DetectInput {
    platform: string;
    /** null: this OS can't say who holds the microphone. */
    micUsers: ProcessRef[] | null;
    /** Called at most once, only when a title is needed. */
    windows: () => WindowRef[] | null;
    live: LiveMeeting[];
    self: SelfIdentity;
}

const SERVICE_NAME: Record<MeetingProvider, string> = { meet: 'Google Meet', zoom: 'Zoom', teams: 'Microsoft Teams', webex: 'Webex' };

function tabDetection(tab: LiveMeeting): Detection {
    return {
        id: tab.key ? `tab:${tab.key}` : `tab:${tab.provider}`,
        app: SERVICE_NAME[tab.provider],
        via: 'browser',
        ...(tab.title ? { title: tab.title } : {}),
        ...(tab.key ? { key: tab.key } : {}),
    };
}

export function detectMeeting(input: DetectInput): Detection | null {
    const { platform, live, self } = input;
    let cachedWindows: WindowRef[] | null | undefined;
    const windows = () => (cachedWindows === undefined ? (cachedWindows = input.windows()) : cachedWindows) ?? [];

    if (input.micUsers === null) {
        // No microphone information: a meeting tab with the call's sound playing.
        const audible = live.find((m) => m.via === 'browser' && m.audible);
        return audible ? tabDetection(audible) : null;
    }

    const holders = input.micUsers
        .filter((p) => !isSelf(platform, p, self))
        .map((p) => ({ proc: p, app: appOfProcess(platform, p) }))
        .filter((h) => h.app !== null);

    // A meeting app in a call.
    const meetingApp = holders.find((h) => h.app!.kind === 'meeting');
    if (meetingApp) {
        const name = meetingApp.app!.name;
        const own = windows().filter((w) => appOfProcess(platform, { pid: w.pid, path: w.path, bundleId: undefined })?.name === name);
        const title = own.map((w) => meetingNameOfTitle(name, w.title)).find(Boolean);
        return { id: `app:${name}`, app: name, via: 'app', ...(title ? { title } : {}) };
    }

    // A browser in a call: its meeting tab, or a window titled like a meeting.
    const browser = holders.find((h) => h.app!.kind === 'browser');
    if (!browser) return null;
    const tab = live.find((m) => m.via === 'browser' && m.audible) ?? live.find((m) => m.via === 'browser' && m.focused) ?? live.find((m) => m.via === 'browser');
    if (tab) return tabDetection(tab);
    const browserName = browser.app!.name;
    for (const w of windows()) {
        if (appOfProcess(platform, { pid: w.pid, path: w.path })?.name !== browserName) continue;
        const service = meetingServiceOfTitle(w.title);
        if (service) return { id: `browser:${browserName}:${service}`, app: service, via: 'browser' };
    }
    return null;
}
