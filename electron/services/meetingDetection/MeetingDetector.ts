/**
 * Watches for a call starting and asks once per call whether to start
 * Natively (the notification is the caller's: `onDetected`).
 *
 * Every `pollMs` it reads the signals (detectMeeting.ts). A call must hold for
 * `confirmMs` before it is announced, so a microphone test or a two-second
 * voice note isn't (a chat app's, `messagingConfirmMs`: voice notes there run
 * longer); it is announced once, and only announced again after it
 * has been gone for `rearmMs` (a new call). While a Natively meeting runs,
 * whatever call is on counts as handled, so stopping Natively mid-call doesn't
 * prompt for that same call.
 *
 * Timers and clock are injected for the tests; polling runs only while enabled.
 */
import { detectMeeting, type DetectInput, type Detection } from './detectMeeting';

export interface MeetingDetectorDeps {
    /** Everything detectMeeting needs, read fresh on each poll. */
    read: () => DetectInput;
    isMeetingActive: () => boolean;
    onDetected: (detection: Detection) => void;
    /**
     * An announced call is no longer seen (once, until it is seen again),
     * after a grace: a call found by its browser tab or title gets
     * `browserGoneGraceMs` (without microphone information a tab counts only
     * while it plays sound, and a quiet stretch is not the end of the call),
     * an app holding the microphone `appGoneGraceMs` (a mute or a device
     * switch can release it for a poll or two; 2026-11-09).
     */
    onGone?: (id: string) => void;
    /** An announced call missed at least one poll and is seen again. */
    onBack?: (id: string) => void;
    now?: () => number;
    setInterval?: (fn: () => void, ms: number) => unknown;
    clearInterval?: (handle: unknown) => void;
}

export interface MeetingDetectorOptions {
    pollMs?: number;
    confirmMs?: number;
    /** A chat app's call (WhatsApp, Slack…): long enough that a voice note is not one. */
    messagingConfirmMs?: number;
    /** How long a browser-found call may go unseen before it counts as gone. */
    browserGoneGraceMs?: number;
    /** How long an app's call (it held the microphone) may go unseen before it counts as gone. */
    appGoneGraceMs?: number;
    /**
     * How many failed reads in a row are skipped (state kept) before the
     * detector takes the signals as they come: a read that keeps failing is
     * the OS's answer, not a blip.
     */
    maxSkippedReads?: number;
    rearmMs?: number;
}

interface CallRecord {
    firstSeen: number;
    lastSeen: number;
    announced: boolean;
    goneReported?: boolean;
    via?: Detection['via'];
}

export class MeetingDetector {
    private readonly pollMs: number;
    private readonly confirmMs: number;
    private readonly messagingConfirmMs: number;
    private readonly rearmMs: number;
    private readonly browserGoneGraceMs: number;
    private readonly appGoneGraceMs: number;
    private readonly maxSkippedReads: number;
    private readonly now: () => number;
    private timer: unknown = null;
    private calls = new Map<string, CallRecord>();
    private lastTickAt = -1;
    /** The OS gave a microphone list on an earlier read: a null one now is a failed read, not "can't say". */
    private hadMicList = false;
    /** Reads skipped in a row as failed. */
    private skippedReads = 0;

    constructor(private readonly deps: MeetingDetectorDeps, options: MeetingDetectorOptions = {}) {
        this.pollMs = options.pollMs ?? 2_000;
        this.confirmMs = options.confirmMs ?? 4_000;
        this.messagingConfirmMs = options.messagingConfirmMs ?? 20_000;
        this.rearmMs = options.rearmMs ?? 60_000;
        this.browserGoneGraceMs = options.browserGoneGraceMs ?? 20_000;
        this.appGoneGraceMs = options.appGoneGraceMs ?? 10_000;
        this.maxSkippedReads = options.maxSkippedReads ?? 15;
        this.now = deps.now ?? Date.now;
    }

    setEnabled(on: boolean): void {
        if (on && this.timer === null) {
            const set = this.deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
            this.timer = set(() => this.tick(), this.pollMs);
        } else if (!on && this.timer !== null) {
            (this.deps.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>)))(this.timer);
            this.timer = null;
            this.calls.clear();
            this.hadMicList = false;
            this.skippedReads = 0;
        }
    }

    get enabled(): boolean {
        return this.timer !== null;
    }

    /** Whether call `id` was seen at the latest poll (false while reads are failing: not known). */
    isPresent(id: string): boolean {
        const call = this.calls.get(id);
        return this.skippedReads === 0 && !!call && call.lastSeen === this.lastTickAt;
    }

    /** One poll. Public for the tests. */
    tick(): void {
        const now = this.now();
        let detection: Detection | null = null;
        // A read that throws, or a null microphone list where the OS gave one
        // before (CoreAudio's process list or the Windows consent store failing
        // for a moment), says nothing about the call: the poll is skipped and
        // every call keeps its state. Read as "no call" it withdrew every offer
        // at once (2026-11-09).
        let failed = false;
        try {
            const input = this.deps.read();
            if (input.micUsers !== null) this.hadMicList = true;
            else if (this.hadMicList) failed = true;
            if (!failed) detection = detectMeeting(input);
        } catch (err) {
            console.warn('[MeetingDetector] reading the signals failed:', (err as Error)?.message);
            failed = true;
        }
        if (failed) {
            if (this.skippedReads < this.maxSkippedReads) {
                this.skippedReads++;
                return;
            }
            // Failing for good: take it as the OS's answer from here on.
            this.hadMicList = false;
        }
        this.skippedReads = 0;
        if (detection) {
            const known = this.calls.get(detection.id);
            // Missed at least one poll (or reported gone) and back: a withdrawn
            // offer for it may come back (wireMeetingDetection).
            const back = !!known && known.announced && (known.goneReported === true || known.lastSeen < this.lastTickAt);
            const call = known ?? { firstSeen: now, lastSeen: now, announced: false };
            call.lastSeen = now;
            call.goneReported = false;
            call.via = detection.via;
            this.calls.set(detection.id, call);
            if (back) {
                try { this.deps.onBack?.(detection.id); } catch (err) { console.warn('[MeetingDetector] onBack failed:', (err as Error)?.message); }
            }
            if (this.deps.isMeetingActive()) {
                call.announced = true;
            } else if (!call.announced && now - call.firstSeen >= (detection.messaging ? this.messagingConfirmMs : this.confirmMs)) {
                call.announced = true;
                try {
                    this.deps.onDetected(detection);
                } catch (err) {
                    console.warn('[MeetingDetector] onDetected failed:', (err as Error)?.message);
                }
            }
        }
        this.lastTickAt = now;
        for (const [id, call] of this.calls) {
            // An announced call missing from this poll: whoever waits on it
            // (the offer's automatic start) hears at once.
            const grace = call.via === 'browser' ? this.browserGoneGraceMs : this.appGoneGraceMs;
            if (call.announced && call.lastSeen < now && now - call.lastSeen >= grace && !call.goneReported) {
                call.goneReported = true;
                try { this.deps.onGone?.(id); } catch (err) { console.warn('[MeetingDetector] onGone failed:', (err as Error)?.message); }
            }
            // Gone long enough: the next one is a new call. Gone briefly before
            // being announced: start the confirmation over.
            if (now - call.lastSeen >= this.rearmMs || (!call.announced && call.lastSeen < now)) this.calls.delete(id);
        }
    }
}
