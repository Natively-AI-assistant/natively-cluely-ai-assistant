/**
 * Meeting detection in the running app: the detector, its signals, and the
 * "Start Natively?" notification.
 *
 * A call is announced with an OS notification (the launcher may be hidden and
 * the call app in front). Its button, or a click on it, starts Natively
 * through the renderer's own start path (requestStart: saved devices,
 * retention, the mic-permission recovery), linked to the calendar event when
 * the call's meeting link names one. It is never shown while Undetectable
 * blocks native prompts or a disguise is on: a notification is its own OS
 * window, and says "Natively".
 */
import { MeetingDetector } from './MeetingDetector';
import { liveMeetings, type LiveMeetingSource } from './liveMeetings';
import type { Detection } from './detectMeeting';
import type { ProcessRef, SelfIdentity } from './meetingApps';
import {
    matchEventByMeetingKeys,
    matchEventForSession,
    withoutOtherMeetings,
    type MatchableEvent,
} from '../calendar/calendarSessionMatch';

export interface MeetingStartRequest {
    title?: string;
    calendarEventId?: string;
    /** Where the start came from: this notification, or the calendar reminder. */
    via: 'detected' | 'reminder';
}

export interface NativeSignals {
    getMicUsers?: () => ProcessRef[] | null;
    getVisibleWindows?: () => Array<{ pid: number; owner: string; title: string; path?: string }> | null;
}

export interface OsNotification {
    title: string;
    body: string;
    action: string;
    onStart: () => void;
}

export interface MeetingDetectionDeps {
    platform: string;
    native: NativeSignals | null;
    self: SelfIdentity;
    isMeetingActive: () => boolean;
    /** Undetectable's native-prompt gate, or a disguise. */
    promptsBlocked: () => boolean;
    /** The calendar's recent list (CalendarManager.getCachedEvents), or null. */
    events: () => MatchableEvent[] | null;
    requestStart: (req: MeetingStartRequest) => void;
    notify: (n: OsNotification) => boolean;
    live?: LiveMeetingSource;
    now?: () => number;
}

/** What the notification says, and which event a start links to. */
export function describeDetection(d: Detection, events: MatchableEvent[] | null, nowMs: number): { body: string; start: MeetingStartRequest } {
    const list = events ?? [];
    // The call's own link names the event: say so, and start linked to it.
    const exact = d.key ? matchEventByMeetingKeys(list, [d.key], nowMs) : null;
    if (exact) {
        return { body: `"${exact.title}" is on in ${d.app}.`, start: { title: exact.title, calendarEventId: exact.id, via: 'detected' } };
    }
    // Otherwise name the meeting on the calendar now, if exactly one fits; the
    // session links to it at start by the same rule.
    const byTime = matchEventForSession(withoutOtherMeetings(list, d.key ? [d.key] : []), nowMs);
    const name = byTime.kind === 'linked' ? byTime.event.title : d.title;
    return { body: name ? `"${name}" is on in ${d.app}.` : `A ${d.app} call started.`, start: { via: 'detected' } };
}

export function wireMeetingDetection(deps: MeetingDetectionDeps): MeetingDetector {
    const live = deps.live ?? liveMeetings;
    const now = deps.now ?? Date.now;
    const detector = new MeetingDetector({
        read: () => ({
            platform: deps.platform,
            micUsers: deps.native?.getMicUsers ? deps.native.getMicUsers() ?? null : null,
            windows: () => deps.native?.getVisibleWindows?.() ?? null,
            live: live.list(),
            self: deps.self,
        }),
        isMeetingActive: deps.isMeetingActive,
        onDetected: (d) => {
            if (deps.promptsBlocked()) {
                console.log(`[MeetingDetection] ${d.app} call detected; prompt skipped (Undetectable or a disguise is on)`);
                return;
            }
            const { body, start } = describeDetection(d, deps.events(), now());
            const shown = deps.notify({
                title: 'Start Natively?',
                body,
                action: 'Start Natively',
                onStart: () => {
                    // The call may have been started from the launcher meanwhile.
                    if (!deps.isMeetingActive()) deps.requestStart(start);
                },
            });
            console.log(`[MeetingDetection] ${d.app} call detected (${d.via}${d.key ? `, ${d.key.split(':')[0]}` : ''}); notification ${shown ? 'shown' : 'not supported'}`);
        },
        now,
    });
    return detector;
}

/**
 * The OS notification, as Electron shows it on macOS and Windows: one button
 * and a click both start; silent, since it lands as a call begins. The last
 * one is kept referenced (Electron drops an unreferenced Notification) and is
 * closed when the next arrives.
 */
let current: { close(): void } | null = null;
export function electronNotify(n: OsNotification): boolean {
    const { Notification } = require('electron');
    if (!Notification.isSupported()) return false;
    try {
        current?.close();
    } catch { /* already gone */ }
    const notif = new Notification({
        title: n.title,
        body: n.body,
        silent: true,
        actions: [{ type: 'button', text: n.action }],
        closeButtonText: 'Not now',
    });
    let started = false;
    const start = () => {
        if (started) return;
        started = true;
        n.onStart();
    };
    notif.on('click', start);
    // Electron 43: the index is `details.actionIndex`; the positional one is deprecated.
    notif.on('action', (details: any, legacyIndex?: number) => {
        const index = typeof details?.actionIndex === 'number' ? details.actionIndex : legacyIndex;
        if (index === 0) start();
    });
    notif.on('close', () => {
        if (current === notif) current = null;
    });
    // macOS refuses an app that isn't allowed to notify (UNErrorDomain 1): an
    // unsigned or ad-hoc-signed build, or the user switched Natively off in
    // System Settings › Notifications. Nothing else to show then; say why.
    notif.on('failed', (_e: unknown, error: string) => {
        console.warn(`[MeetingDetection] the OS did not show the notification: ${error}`);
        if (current === notif) current = null;
    });
    current = notif;
    notif.show();
    return true;
}

// The running detector and the browsers' tab channel, so the Settings toggle
// (ipcHandlers: set-meeting-detection-enabled) turns both on and off.
let registered: { detector: MeetingDetector; tabs: { setMeetingTabsWanted(on: boolean): void } | null } | null = null;

export function registerMeetingDetection(detector: MeetingDetector, tabs: { setMeetingTabsWanted(on: boolean): void } | null): void {
    registered = { detector, tabs };
}

export function setMeetingDetectionActive(on: boolean): void {
    registered?.detector.setEnabled(on);
    registered?.tabs?.setMeetingTabsWanted(on);
}
