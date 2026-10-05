/**
 * Watches for a call starting and asks once per call whether to start
 * Natively (the notification is the caller's: `onDetected`).
 *
 * Every `pollMs` it reads the signals (detectMeeting.ts). A call must hold for
 * `confirmMs` before it is announced, so a microphone test or a two-second
 * voice note isn't; it is announced once, and only announced again after it
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
    now?: () => number;
    setInterval?: (fn: () => void, ms: number) => unknown;
    clearInterval?: (handle: unknown) => void;
}

export interface MeetingDetectorOptions {
    pollMs?: number;
    confirmMs?: number;
    rearmMs?: number;
}

interface CallRecord {
    firstSeen: number;
    lastSeen: number;
    announced: boolean;
}

export class MeetingDetector {
    private readonly pollMs: number;
    private readonly confirmMs: number;
    private readonly rearmMs: number;
    private readonly now: () => number;
    private timer: unknown = null;
    private calls = new Map<string, CallRecord>();

    constructor(private readonly deps: MeetingDetectorDeps, options: MeetingDetectorOptions = {}) {
        this.pollMs = options.pollMs ?? 2_000;
        this.confirmMs = options.confirmMs ?? 4_000;
        this.rearmMs = options.rearmMs ?? 60_000;
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
        }
    }

    get enabled(): boolean {
        return this.timer !== null;
    }

    /** One poll. Public for the tests. */
    tick(): void {
        const now = this.now();
        let detection: Detection | null = null;
        try {
            detection = detectMeeting(this.deps.read());
        } catch (err) {
            console.warn('[MeetingDetector] reading the signals failed:', (err as Error)?.message);
        }
        if (detection) {
            const call = this.calls.get(detection.id) ?? { firstSeen: now, lastSeen: now, announced: false };
            call.lastSeen = now;
            this.calls.set(detection.id, call);
            if (this.deps.isMeetingActive()) {
                call.announced = true;
            } else if (!call.announced && now - call.firstSeen >= this.confirmMs) {
                call.announced = true;
                try {
                    this.deps.onDetected(detection);
                } catch (err) {
                    console.warn('[MeetingDetector] onDetected failed:', (err as Error)?.message);
                }
            }
        }
        for (const [id, call] of this.calls) {
            // Gone long enough: the next one is a new call. Gone briefly before
            // being announced: start the confirmation over.
            if (now - call.lastSeen >= this.rearmMs || (!call.announced && call.lastSeen < now)) this.calls.delete(id);
        }
    }
}
