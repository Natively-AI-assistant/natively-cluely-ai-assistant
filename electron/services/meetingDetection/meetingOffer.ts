/**
 * The "meeting detected" offer (2026-10-15): one offer per detected call, shown
 * on two synced surfaces, with an optional automatic start.
 *
 *   - The launcher's own panel (a corner notice in the launcher window), when
 *     the launcher has a live renderer: it shows while the launcher is on
 *     screen.
 *   - The OS notification (the one detection always showed), unless the user
 *     is looking at the launcher right now: a call usually starts with the call
 *     app in front and Natively hidden.
 *
 * Start on either surface starts Natively; Not now on either clears both. With
 * "Start automatically" on (Settings › Calendar, default off), Natively starts
 * itself `countdownMs` after the offer unless Not now was pressed. An offer
 * nobody answers clears itself after `expireMs`.
 *
 * Never shown at all while Undetectable blocks native prompts or a disguise is
 * on (the caller, wireMeetingDetection, checks before offering): the same rule
 * the notification always followed, so the countdown never runs unseen either.
 *
 * Pure: timers, clock and surfaces are injected, so the state machine is tested
 * without Electron.
 */

export interface MeetingStartRequestLike {
    title?: string;
    calendarEventId?: string;
    via: 'detected' | 'reminder';
}

/** What the launcher's panel shows. */
export interface MeetingOfferView {
    id: string;
    /** The calendar event's title when one is on, else the call's own name, else null. */
    title: string | null;
    /** "Zoom", "Google Meet". */
    app: string;
    /** The notification's sentence, for the panel's second line. */
    body: string;
    /** Wall time of the automatic start, or null when it is off. */
    autoStartAt: number | null;
}

export interface OfferNotification {
    title: string;
    body: string;
    action: string;
    onStart: () => void;
    /** The user closed the notification (Not now). */
    onDismiss?: () => void;
}

export interface MeetingOfferDeps {
    isMeetingActive: () => boolean;
    requestStart: (req: MeetingStartRequestLike) => void;
    /** Settings › Calendar › Start automatically. */
    autoStart: () => boolean;
    /** The launcher's panel: an offer to show, or null to clear it. */
    showPanel: (offer: MeetingOfferView | null) => void;
    /** Shows the OS notification; false when the OS has none. */
    notify: (n: OfferNotification) => boolean;
    /** Closes the notification this controller showed last, if it is still up. */
    closeNotification: () => void;
    /** The launcher is on screen and in front: its panel is enough. */
    launcherFocused: () => boolean;
    /**
     * Undetectable or a disguise is on now: nothing may show (no panel, no
     * notification) and a pending offer is dropped. Checked at every surface,
     * not only when a call is first detected, since the user can turn it on
     * while an offer waits.
     */
    promptsBlocked?: () => boolean;
    /** Whether the detected call is still on (MeetingDetector.isPresent); checked right before an automatic start. */
    callStillOn?: (callId: string) => boolean;
    now?: () => number;
    setTimeout?: (fn: () => void, ms: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
    log?: (line: string) => void;
}

export const OFFER_COUNTDOWN_MS = 10_000;
export const OFFER_EXPIRE_MS = 120_000;
/** Not now for a call holds this long: the same app's (or tab's) call is not offered again meanwhile. */
export const OFFER_NOT_NOW_MS = 10 * 60_000;
/** The countdown ended while the call was not seen at the last poll: looked at again this often. */
export const OFFER_RECHECK_MS = 2_000;
/**
 * A call gone this long (continuously, from the detector's gone report) is
 * over: its Not now no longer holds, and it is not "the same call" any more.
 * Gone less, and seen again, it is taken as the same call (a long mute, a
 * headset connecting): a withdrawn offer comes back on the panel without a
 * second notification, and a Not now still holds.
 */
export const SAME_CALL_GAP_MS = 2 * 60_000;

/** The notification's text for an offer (exported for the tests). */
export function offerNotificationText(body: string, autoStart: boolean, countdownMs: number): { title: string; body: string; action: string } {
    if (!autoStart) return { title: 'Start Natively?', body, action: 'Start Natively' };
    const seconds = Math.max(1, Math.round(countdownMs / 1000));
    return { title: 'Starting Natively', body: `${body}\nNatively starts in ${seconds} seconds.`, action: 'Start now' };
}

/**
 * Whether a notification's close means Not now. macOS emits close only when the
 * user closes it; Windows also closes a toast that timed out into the Action
 * Center (reason "timedOut"), which is not a no.
 */
export function closeMeansNotNow(platform: string, reason: string | undefined): boolean {
    if (platform === 'win32') return reason === 'userCanceled';
    return true;
}

type OfferInput = { app: string; title?: string | null; body: string; start: MeetingStartRequestLike; callId?: string };

/** A Not now: until when it holds, and since when its call has been gone (null: on now). */
export interface NotNowHold {
    until: number;
    goneAt: number | null;
}

/**
 * Whether a Not now still holds for this call id (2026-11-09). A desktop call
 * is named by its app ("app:Zoom"), so the id alone does not tell one call
 * from the next: the hold covers the same call only, ending OFFER_NOT_NOW_MS
 * after it was pressed or once the call has been gone `goneEndMs`
 * continuously, whichever is first (the next meeting in the same app is
 * offered). Prunes ended holds.
 */
export function notNowHolds(notNow: Map<string, NotNowHold>, callId: string | null | undefined, nowMs: number, goneEndMs: number = SAME_CALL_GAP_MS): boolean {
    for (const [id, hold] of notNow) {
        if (hold.until <= nowMs || (hold.goneAt !== null && nowMs - hold.goneAt >= goneEndMs)) notNow.delete(id);
    }
    return !!callId && notNow.has(callId);
}

interface Current {
    input: OfferInput;
    view: MeetingOfferView;
    /** The detector's id for the call this offer is about. */
    callId: string | null;
    start: MeetingStartRequestLike;
    countdown: unknown;
    expiry: unknown;
    /** Whether its OS notification was shown (it says whether Natively starts by itself). */
    notified: boolean;
}

export class MeetingOffers {
    private current: Current | null = null;
    /** Not now per call id (notNowHolds). */
    private notNow = new Map<string, NotNowHold>();
    /** The offer withdrawn because its call went quiet, unanswered: restored if the same call is back (SAME_CALL_GAP_MS). */
    private withdrawn: { callId: string; at: number; input: OfferInput } | null = null;
    private seq = 0;
    private readonly now: () => number;
    private readonly setT: (fn: () => void, ms: number) => unknown;
    private readonly clearT: (h: unknown) => void;

    constructor(
        private readonly deps: MeetingOfferDeps,
        private readonly options: { countdownMs?: number; expireMs?: number; notNowMs?: number; recheckMs?: number; sameCallGapMs?: number } = {},
    ) {
        this.now = deps.now ?? Date.now;
        this.setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
        this.clearT = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    }

    private get countdownMs(): number {
        return this.options.countdownMs ?? OFFER_COUNTDOWN_MS;
    }

    /** The offer on screen, if any. */
    view(): MeetingOfferView | null {
        return this.current?.view ?? null;
    }

    private get sameCallGapMs(): number {
        return this.options.sameCallGapMs ?? SAME_CALL_GAP_MS;
    }

    /**
     * A new call: replaces any earlier offer. Null (nothing shown) when Not now
     * was pressed for this same call (notNowHolds). The same call back after
     * its offer was withdrawn (gone less than SAME_CALL_GAP_MS) gets its offer
     * back on the panel, with a fresh countdown, but no second notification.
     */
    offer(input: OfferInput): MeetingOfferView | null {
        const now = this.now();
        if (notNowHolds(this.notNow, input.callId, now, this.sameCallGapMs)) {
            // Seen, so on: the hold runs on while the call does.
            const hold = this.notNow.get(input.callId!);
            if (hold) hold.goneAt = null;
            this.deps.log?.(`call ${input.callId}: not offered, Not now was pressed for this call`);
            return null;
        }
        const w = this.withdrawn;
        const restored = !!w && !!input.callId && w.callId === input.callId && now - w.at < this.sameCallGapMs;
        this.clear('replaced');
        this.withdrawn = null;
        const auto = (() => { try { return this.deps.autoStart(); } catch { return false; } })();
        const id = `offer-${++this.seq}`;
        const view: MeetingOfferView = {
            id,
            title: input.start.title ?? input.title ?? null,
            app: input.app,
            body: input.body,
            autoStartAt: auto ? this.now() + this.countdownMs : null,
        };
        const current: Current = {
            input,
            view,
            callId: input.callId ?? null,
            start: input.start,
            countdown: auto ? this.setT(() => this.fire(id), this.countdownMs) : null,
            expiry: this.setT(() => { if (this.current?.view.id === id) this.clear('expired'); }, this.options.expireMs ?? OFFER_EXPIRE_MS),
            notified: false,
        };
        this.current = current;
        try { this.deps.showPanel(view); } catch { /* the notification still shows */ }
        let focused = false;
        try { focused = this.deps.launcherFocused(); } catch { /* not focused */ }
        if (restored) {
            this.deps.log?.(`offer ${id}: the same call is back, offer restored without a notification${auto ? ', starts automatically' : ''}`);
        } else if (!focused) {
            current.notified = this.notifyFor(id, input, auto);
            this.deps.log?.(`offer ${id}: notification ${current.notified ? 'shown' : 'not supported'}${auto ? ', starts automatically' : ''}`);
        } else {
            this.deps.log?.(`offer ${id}: launcher in front, panel only${auto ? ', starts automatically' : ''}`);
        }
        return view;
    }

    private blocked(): boolean {
        try {
            return this.deps.promptsBlocked?.() === true;
        } catch {
            return true;
        }
    }

    private notifyFor(id: string, input: OfferInput, auto: boolean): boolean {
        if (this.blocked()) return false;
        const text = offerNotificationText(input.body, auto, this.countdownMs);
        const startReq = input.start;
        return this.deps.notify({
            ...text,
            // A notification's Start counts only while its own offer is live:
            // a Windows toast that timed out into the Action Center can be
            // clicked hours later, after the offer expired or was replaced
            // (2026-11-09). A meeting already running wins.
            onStart: () => {
                if (this.current?.view.id !== id) {
                    this.deps.log?.(`offer ${id}: Start ignored, the offer is no longer up`);
                    return;
                }
                this.clear('started');
                if (!this.deps.isMeetingActive()) this.deps.requestStart(startReq);
            },
            onDismiss: () => this.dismiss(id),
        });
    }

    /**
     * Start automatically was switched off: a countdown running now stops,
     * and the offer stays as a plain Start / Not now (its notification, if
     * one said Natively starts by itself, is replaced by the plain one).
     */
    autoStartOff(): void {
        const cur = this.current;
        if (!cur || cur.countdown === null) return;
        this.clearT(cur.countdown);
        cur.countdown = null;
        this.showWithoutCountdown(cur);
    }

    private showWithoutCountdown(cur: Current): void {
        if (this.blocked()) {
            this.clear('privacy');
            return;
        }
        cur.view = { ...cur.view, autoStartAt: null };
        try { this.deps.showPanel(cur.view); } catch { /* window gone */ }
        if (cur.notified) {
            try { this.deps.closeNotification(); } catch { /* already gone */ }
            cur.notified = this.notifyFor(cur.view.id, cur.input, false);
        }
        this.deps.log?.(`offer ${cur.view.id}: Start automatically turned off, countdown stopped`);
    }

    /** Start pressed on the panel. False when that offer is gone. */
    start(id: string): boolean {
        const cur = this.current;
        if (!cur || cur.view.id !== id) return false;
        this.clear('started');
        if (this.deps.isMeetingActive()) return false;
        this.deps.requestStart(cur.start);
        return true;
    }

    /**
     * The detector no longer sees the call (after its grace): an offer about it
     * (and its countdown) goes, kept for callBack; a Not now for it starts
     * counting the call's absence.
     */
    callGone(callId: string): void {
        const hold = this.notNow.get(callId);
        if (hold && hold.goneAt === null) hold.goneAt = this.now();
        if (this.current && this.current.callId === callId) this.withdraw();
    }

    /**
     * The call is seen again within the detector's minute: an offer it lost
     * unanswered comes back on the panel, with a fresh countdown when Start
     * automatically is on, but without a second notification (until
     * 2026-11-09 it raised a new one each time). Never over a meeting.
     */
    callBack(callId: string): void {
        const hold = this.notNow.get(callId);
        if (hold) hold.goneAt = null;
        const w = this.withdrawn;
        if (!w || w.callId !== callId || this.current) return;
        if (this.deps.isMeetingActive()) { this.withdrawn = null; return; }
        this.offer(w.input);
    }

    /** The call went quiet before anyone answered: withdrawn, kept for callBack. */
    private withdraw(): void {
        const cur = this.current;
        if (!cur) return;
        this.clear('call ended');
        if (cur.callId) this.withdrawn = { callId: cur.callId, at: this.now(), input: cur.input };
    }

    /** Not now, on either surface: this call is not offered again while it goes on (notNowHolds). */
    dismiss(id: string): void {
        const cur = this.current;
        if (cur?.view.id === id) {
            if (cur.callId) this.notNow.set(cur.callId, { until: this.now() + (this.options.notNowMs ?? OFFER_NOT_NOW_MS), goneAt: null });
            this.clear('dismissed');
        }
    }

    /** A meeting started some other way, or detection was switched off. */
    clear(reason = 'cleared'): void {
        // Anything but the call going quiet answers it for good.
        if (reason !== 'call ended' && reason !== 'replaced') this.withdrawn = null;
        const cur = this.current;
        if (!cur) return;
        this.current = null;
        if (cur.countdown !== null) this.clearT(cur.countdown);
        this.clearT(cur.expiry);
        try { this.deps.showPanel(null); } catch { /* window gone */ }
        // Both surfaces go together (closing one that already closed is a no-op).
        try { this.deps.closeNotification(); } catch { /* already gone */ }
        this.deps.log?.(`offer ${cur.view.id}: ${reason}`);
    }

    private fire(id: string): void {
        const cur = this.current;
        if (!cur || cur.view.id !== id) return;
        if (this.blocked()) {
            this.clear('privacy');
            return;
        }
        // The setting may have been turned off during the countdown.
        let auto = false;
        try { auto = this.deps.autoStart(); } catch { auto = false; }
        if (!auto) {
            cur.countdown = null;
            this.showWithoutCountdown(cur);
            return;
        }
        // The call may have ended between the detector's polls. Not seen at
        // the last one: no start yet, and the offer stays up; it is looked at
        // again each poll until the call is heard (it starts then) or the
        // detector reports it gone after its grace (callGone withdraws it).
        // Withdrawing here at once made a quiet second re-offer the call.
        let stillOn = true;
        try { stillOn = cur.callId === null || !this.deps.callStillOn || this.deps.callStillOn(cur.callId); } catch { stillOn = false; }
        if (!stillOn) {
            cur.countdown = this.setT(() => this.fire(id), this.options.recheckMs ?? OFFER_RECHECK_MS);
            return;
        }
        this.clear('auto-started');
        if (this.deps.isMeetingActive()) return;
        this.deps.requestStart(cur.start);
    }
}

// ── Calendar reminder timing (Settings › Calendar) ───────────────────────

export const REMINDER_MINUTE_CHOICES = [1, 2, 5] as const;
export const DEFAULT_REMINDER_MINUTES = 2;
/** Settings › Calendar › Remind me before meetings: Off (2026-11-09). */
export const REMINDERS_OFF = 0;
/** Every value the setting takes: Off or a lead time. */
export const REMINDER_SETTING_CHOICES: readonly number[] = [REMINDERS_OFF, ...REMINDER_MINUTE_CHOICES];

/** The saved reminder lead time (0 = Off), or the default for anything else. */
export function reminderMinutes(raw: unknown): number {
    return typeof raw === 'number' && REMINDER_SETTING_CHOICES.includes(raw) ? raw : DEFAULT_REMINDER_MINUTES;
}

/** "starts in 1 minute" / "starts in 2 minutes". */
export function reminderLeadText(minutes: number): string {
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** One occurrence of an event: a recurring event's instances differ by start. */
export function reminderKey(event: { id?: string; startTime?: string }): string {
    return `${event.id ?? ''}|${event.startTime ?? ''}`;
}

/**
 * When each event's reminder fires, `leadMinutes` before its start: only
 * future reminders within a day, and never one for an occurrence already
 * reminded (a shorter lead chosen after a reminder fired would repeat it).
 * None when reminders are Off, and none for a meeting the user declined
 * (calendarSessionMatch and the Launcher skip those too).
 */
export function planReminders<E extends { id?: string; startTime?: string; selfResponse?: string }>(
    events: readonly E[],
    nowMs: number,
    leadMinutes: number,
    reminded: ReadonlySet<string>,
): Array<{ event: E; delayMs: number }> {
    const out: Array<{ event: E; delayMs: number }> = [];
    if (!(leadMinutes > 0)) return out;
    for (const event of events) {
        if (!event.startTime) continue;
        if (event.selfResponse === 'declined') continue;
        const start = new Date(event.startTime).getTime();
        if (!Number.isFinite(start)) continue;
        if (reminded.has(reminderKey(event))) continue;
        const delayMs = start - leadMinutes * 60_000 - nowMs;
        if (delayMs > 0 && delayMs < 24 * 60 * 60_000) out.push({ event, delayMs });
    }
    return out;
}

/** Forget occurrences that started over a day ago, so the set stays small. */
export function pruneReminded(reminded: Set<string>, nowMs: number): void {
    for (const key of reminded) {
        const start = new Date(key.slice(key.lastIndexOf('|') + 1)).getTime();
        if (!Number.isFinite(start) || start < nowMs - 24 * 60 * 60_000) reminded.delete(key);
    }
}

/** How far a reminder may drift from its lead time and still say "starts in N minutes". */
export const REMINDER_DRIFT_MS = 60_000;
/** A reminder still up this long after its meeting started is closed. */
export const REMINDER_CLOSE_AFTER_START_MS = 5 * 60_000;

export type ReminderFire =
    | { kind: 'show' }
    /** Fired before its time (the wall clock moved back): wait `delayMs` more. */
    | { kind: 'early'; delayMs: number }
    | { kind: 'skip'; reason: 'off' | 'started' | 'late' };

/**
 * A reminder's timer fired: checked against the wall clock, since a timer
 * does not count the time a Mac spends asleep. "Starts in 2 minutes" is said
 * only when that is still true to within REMINDER_DRIFT_MS; a late one (the
 * lid opened a minute before the meeting) or one for a meeting already started
 * is skipped, not reworded. Off (0) shows nothing.
 */
export function reminderFire(startMs: number, nowMs: number, leadMinutes: number): ReminderFire {
    if (!(leadMinutes > 0)) return { kind: 'skip', reason: 'off' };
    if (!Number.isFinite(startMs) || nowMs >= startMs) return { kind: 'skip', reason: 'started' };
    const off = startMs - nowMs - leadMinutes * 60_000;
    if (off > REMINDER_DRIFT_MS) return { kind: 'early', delayMs: off };
    if (off < -REMINDER_DRIFT_MS) return { kind: 'skip', reason: 'late' };
    return { kind: 'show' };
}

export type ReminderAction = 'start' | 'dismiss' | 'late';

/**
 * What a reminder says and which buttons it has. During a Natively meeting
 * there is no "Start Natively?" (App.tsx ignores a start while one runs): a
 * meeting with other people keeps only Running late, as its one button, for
 * the back-to-back case, and one without has nothing to offer and is not
 * shown (null).
 */
export function reminderContent(input: {
    title: string;
    lead: string;
    lastTime: string | null;
    hasAttendees: boolean;
    meetingActive: boolean;
}): { title: string; body: string; actions: Array<{ kind: ReminderAction; text: string }> } | null {
    const late = input.hasAttendees ? [{ kind: 'late' as const, text: 'Running late' }] : [];
    if (input.meetingActive) {
        if (!input.hasAttendees) return null;
        // Running late alone: macOS shows only the first action as a button
        // (the rest go in a menu), and the notification's own close dismisses.
        return {
            title: 'Meeting starting soon',
            body: input.lastTime ? `"${input.title}" starts in ${input.lead}.\n${input.lastTime}` : `"${input.title}" starts in ${input.lead}.`,
            actions: late,
        };
    }
    return {
        title: 'Meeting starting soon',
        body: input.lastTime ? `"${input.title}" starts in ${input.lead}.\n${input.lastTime}` : `"${input.title}" starts in ${input.lead}. Start Natively?`,
        actions: [{ kind: 'start', text: 'Start Meeting' }, { kind: 'dismiss', text: 'Dismiss' }, ...late],
    };
}

/**
 * Whether a reminder's Start still means this meeting: until it ends (an hour
 * after its start when it has no end). A reminder tapped in the Notification
 * Center the next day does nothing.
 */
export function reminderStartAllowed(event: { startTime?: string; endTime?: string }, nowMs: number): boolean {
    const start = new Date(event.startTime ?? '').getTime();
    if (!Number.isFinite(start)) return false;
    const end = new Date(event.endTime ?? '').getTime();
    return nowMs < (Number.isFinite(end) && end > start ? end : start + 60 * 60_000);
}
