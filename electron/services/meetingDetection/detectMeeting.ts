/**
 * Is the user in a call right now, and which? Decided from:
 *
 *   - who holds a microphone (native getMicUsers), minus Natively itself;
 *   - the browsers' meeting tabs (liveMeetings, from the Companion extension);
 *   - window titles (native getVisibleWindows), read only when needed.
 *
 * A meeting app holding the microphone is a call (Zoom, Teams, Webex,
 * FaceTime…). A chat app that also calls (WhatsApp, Slack, Discord, Telegram,
 * Signal…) counts only while it holds the microphone, and is marked
 * `messaging` so the detector waits longer (a voice note holds it too). A
 * browser holding it is a call only with evidence of a meeting in it: a meeting
 * tab, or a window titled like one; a browser recording a voice note is not a
 * meeting. Without microphone information (macOS before
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
    /** A chat app's call (meetingApps' `messaging`): announced after a longer hold. */
    messaging?: true;
}

export interface DetectInput {
    platform: string;
    /** null: this OS can't say who holds the microphone. */
    micUsers: ProcessRef[] | null;
    /**
     * Fallback for macOS before 14, where there is no per-process microphone
     * list (micUsers is null): true when the default input device is being
     * captured by something (meeting_signals.input_in_use). With it, a known
     * meeting app that has a window up is taken as the call.
     */
    inputInUse?: boolean;
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
        if (audible) return tabDetection(audible);
        // macOS before 14: no per-process list, but the OS can still say the
        // microphone is live. If it is, and a known meeting app has a window up,
        // that app is the call (a weaker signal than holding the mic by pid).
        if (input.inputInUse) {
            for (const w of windows()) {
                const app = appOfProcess(platform, { pid: w.pid, path: w.path });
                if (app && (app.kind === 'meeting' || app.kind === 'messaging')) {
                    const title = meetingNameOfTitle(app.name, w.title);
                    return {
                        id: `app:${app.name}`,
                        app: app.name,
                        via: 'app',
                        ...(title ? { title } : {}),
                        ...(app.kind === 'messaging' ? { messaging: true as const } : {}),
                    };
                }
            }
        }
        return null;
    }

    const holders = input.micUsers
        .filter((p) => !isSelf(platform, p, self))
        .map((p) => ({ proc: p, app: appOfProcess(platform, p) }))
        .filter((h) => h.app !== null);

    // A meeting app in a call; else a chat app holding the microphone.
    const meetingApp = holders.find((h) => h.app!.kind === 'meeting') ?? holders.find((h) => h.app!.kind === 'messaging');
    if (meetingApp) {
        const name = meetingApp.app!.name;
        const own = windows().filter((w) => appOfProcess(platform, { pid: w.pid, path: w.path, bundleId: undefined })?.name === name);
        const title = own.map((w) => meetingNameOfTitle(name, w.title)).find(Boolean);
        return {
            id: `app:${name}`,
            app: name,
            via: 'app',
            ...(title ? { title } : {}),
            ...(meetingApp.app!.kind === 'messaging' ? { messaging: true as const } : {}),
        };
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
