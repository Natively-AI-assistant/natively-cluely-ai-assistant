/**
 * Meeting detection in the running app: the detector, its signals, and the
 * "Start Natively?" offer.
 *
 * A call is announced on the launcher's own panel and, unless the launcher is
 * in front, with an OS notification (the launcher may be hidden and the call
 * app in front); meetingOffer.ts keeps the two in step and runs the optional
 * automatic start. Start starts Natively through the renderer's own start
 * path (requestStart: saved devices, retention, the mic-permission recovery),
 * linked to the calendar event when the call's meeting link names one. Nothing
 * is offered while Undetectable blocks native prompts or a disguise is on: a
 * notification is its own OS window, and says "Natively".
 */
import { MeetingDetector } from './MeetingDetector';
import { liveMeetings, type LiveMeetingSource } from './liveMeetings';
import type { Detection } from './detectMeeting';
import type { ProcessRef, SelfIdentity } from './meetingApps';
import { MeetingOffers, closeMeansNotNow, type MeetingOfferView } from './meetingOffer';
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
    /** macOS < 14 fallback: whether the default input is being captured (meeting_signals.input_in_use). */
    inputInUse?: () => boolean | null;
}

export interface OsNotification {
    title: string;
    body: string;
    action: string;
    onStart: () => void;
    /** The user closed it (Not now). */
    onDismiss?: () => void;
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
    /** "Last time: …" for a recurring event (recurringMeetings.lastTimeNotificationLine), or null. */
    lastTimeLine?: (event: MatchableEvent) => string | null;
    /** The launcher's "meeting detected" panel: an offer, or null to clear it. */
    showPanel?: (offer: MeetingOfferView | null) => void;
    /** Closes the last notification shown (electronNotify's). */
    closeNotification?: () => void;
    /** The launcher is on screen and in front: its panel is enough. */
    launcherFocused?: () => boolean;
    /** Settings › Calendar › Start automatically (default off). */
    autoStart?: () => boolean;
    setTimeout?: (fn: () => void, ms: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
}

/** What the notification says, and which event a start links to. */
export function describeDetection(
    d: Detection,
    events: MatchableEvent[] | null,
    nowMs: number,
    lastTimeLine?: (event: MatchableEvent) => string | null,
): { body: string; start: MeetingStartRequest } {
    const list = events ?? [];
    // A recurring meeting's notification also recalls last time, on its own line.
    const withLastTime = (body: string, event: MatchableEvent | null): string => {
        if (!event || !lastTimeLine) return body;
        let line: string | null = null;
        try { line = lastTimeLine(event); } catch { /* never blocks the prompt */ }
        return line ? `${body}\n${line}` : body;
    };
    // The call's own link names the event: say so, and start linked to it.
    const exact = d.key ? matchEventByMeetingKeys(list, [d.key], nowMs) : null;
    if (exact) {
        return { body: withLastTime(`"${exact.title}" is on in ${d.app}.`, exact), start: { title: exact.title, calendarEventId: exact.id, via: 'detected' } };
    }
    // Otherwise name the meeting on the calendar now, if exactly one fits; the
    // session links to it at start by the same rule.
    const byTime = matchEventForSession(withoutOtherMeetings(list, d.key ? [d.key] : []), nowMs);
    const linked = byTime.kind === 'linked' ? byTime.event : null;
    const name = linked ? linked.title : d.title;
    return { body: withLastTime(name ? `"${name}" is on in ${d.app}.` : `A ${d.app} call started.`, linked), start: { via: 'detected' } };
}

export function wireMeetingDetection(deps: MeetingDetectionDeps): MeetingDetector {
    const live = deps.live ?? liveMeetings;
    const now = deps.now ?? Date.now;
    const offers = new MeetingOffers({
        isMeetingActive: deps.isMeetingActive,
        requestStart: (req) => deps.requestStart(req),
        autoStart: deps.autoStart ?? (() => false),
        showPanel: deps.showPanel ?? (() => {}),
        notify: deps.notify,
        closeNotification: deps.closeNotification ?? (() => {}),
        launcherFocused: deps.launcherFocused ?? (() => false),
        promptsBlocked: () => deps.promptsBlocked(),
        // An automatic start only for a call still on (the detector's last poll).
        callStillOn: (callId) => detector.isPresent(callId),
        now,
        ...(deps.setTimeout ? { setTimeout: deps.setTimeout } : {}),
        ...(deps.clearTimeout ? { clearTimeout: deps.clearTimeout } : {}),
        log: (line) => console.log(`[MeetingDetection] ${line}`),
    });
    lastOffers = offers;
    const detector = new MeetingDetector({
        read: () => ({
            platform: deps.platform,
            micUsers: deps.native?.getMicUsers ? deps.native.getMicUsers() ?? null : null,
            windows: () => deps.native?.getVisibleWindows?.() ?? null,
            ...(deps.native?.inputInUse ? { inputInUse: deps.native.inputInUse() ?? false } : {}),
            live: live.list(),
            self: deps.self,
        }),
        isMeetingActive: deps.isMeetingActive,
        // The call ended before anyone answered: its offer and countdown go.
        onGone: (id) => offers.callGone(id),
        // Back within the minute: an offer it lost unanswered is shown again,
        // unless Undetectable or a disguise was turned on in between.
        onBack: (id) => {
            if (deps.promptsBlocked()) return;
            offers.callBack(id);
        },
        onDetected: (d) => {
            if (deps.promptsBlocked()) {
                console.log(`[MeetingDetection] ${d.app} call detected; prompt skipped (Undetectable or a disguise is on)`);
                return;
            }
            const { body, start } = describeDetection(d, deps.events(), now(), deps.lastTimeLine);
            console.log(`[MeetingDetection] ${d.app} call detected (${d.via}${d.key ? `, ${d.key.split(':')[0]}` : ''})`);
            // The call may be started from the launcher meanwhile: the offer
            // checks for a running meeting before it starts one.
            offers.offer({ app: d.app, title: d.title ?? null, body, start, callId: d.id });
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
// Notifications this app closed itself: their close event (which may come
// later, asynchronously) is not the user's Not now.
const closedByApp = new WeakSet<object>();

/** Closes the last notification shown, without reading it as Not now. */
export function closeDetectedNotification(): void {
    const n = current;
    if (!n) return;
    current = null;
    closedByApp.add(n);
    try { n.close(); } catch { /* already gone */ }
}

export function electronNotify(n: OsNotification): boolean {
    const { Notification } = require('electron');
    if (!Notification.isSupported()) return false;
    closeDetectedNotification();
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
    // Not now: the close button, on macOS any close by the user; on Windows a
    // toast that timed out into the Action Center is not a no.
    notif.on('close', (details: any) => {
        if (started || closedByApp.has(notif)) return;
        if (closeMeansNotNow(process.platform, details?.reason)) n.onDismiss?.();
    });
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
// The offer controller of the running detector, for the panel's IPC.
let lastOffers: MeetingOffers | null = null;

/** The launcher panel's Start / Not now (ipcHandlers: meeting-offer:start, meeting-offer:dismiss). */
export function getMeetingOffers(): MeetingOffers | null {
    return lastOffers;
}

export function registerMeetingDetection(detector: MeetingDetector, tabs: { setMeetingTabsWanted(on: boolean): void } | null): void {
    registered = { detector, tabs };
}

export function setMeetingDetectionActive(on: boolean): void {
    registered?.detector.setEnabled(on);
    if (!on) lastOffers?.clear('detection off');
    registered?.tabs?.setMeetingTabsWanted(on);
}
