/**
 * Decides when a running meeting is over, so Natively stops by itself the way
 * the user's Stop does (main: the same endMeeting path, so the notes are
 * written). Layered, cheapest and surest first:
 *
 *   a. The app that held the microphone for the call (Zoom, Teams, a browser
 *      in a Meet tab…) lets it go, the linked calendar event ends within
 *      ±5 min of now, and the other side was heard for at least 3 min:
 *      the call is over. No model call.
 *   b. The same release without that calendar match: a small model reads the
 *      last ~100 words and answers ENDED or NOT_ENDED (endOfCallCheck.ts).
 *      No answer, a failure or NOT_ENDED: keep going, (d) still applies.
 *   c. The Companion extension's tab for this call is gone: the call is over.
 *   d. Nothing said by anyone for N minutes: a notice in the overlay says
 *      Natively stops in 1 minute, with Keep going; then it stops.
 *
 * Never while the user is typing in the overlay, nor within 60 s of Keep
 * going (or any other resume). Every decision is logged with its reasons.
 *
 * Platform-independent: who holds the microphone, the calendar, the tabs, the
 * clock and the model check are all injected, so both OS branches and every
 * timing are tested without Electron (MeetingAutoStop2026_10_15.test.mjs).
 */

export type MeetingEndReason =
    | 'mic_released_calendar_end'
    | 'mic_released_call_ended'
    | 'extension_call_closed'
    | 'inactivity';

export type EndCheckVerdict = 'ENDED' | 'NOT_ENDED';

export interface MeetingEndSignals {
    /**
     * The apps holding a microphone now, minus Natively, as display names
     * ("Zoom", "Google Chrome"); meeting apps first. null: this OS (or this
     * build) cannot say who holds the microphone.
     */
    micApps(): string[] | null;
    /** The linked calendar event's end (ms), or null when none is linked. */
    calendarEventEnd(): number | null;
    /** The Companion extension's call this session is in (`meet:abc-defg-hij`), or null. */
    callKey(): string | null;
    /** Whether a browser tab for that call is open now; null: no extension information. */
    callTabOpen(key: string): boolean | null;
    /** Display names for the two channels, for the model check ("Evin", "Priya"). */
    speakerNames(): { me: string; them: string };
    /**
     * A count that grows whenever the user uses Natively in the meeting (an
     * answer asked for, a chat, a screenshot): a change counts as activity, so
     * a meeting used without audio is not "silent".
     */
    activityCount?(): number;
}

export interface MeetingEndDetectorDeps {
    signals: MeetingEndSignals;
    /** The end-of-call model check; resolves NOT_ENDED on anything but a clear ENDED. */
    checkEnded: ((transcript: string) => Promise<{ verdict: EndCheckVerdict; why: string }>) | null;
    /** Stop the meeting through the user's own Stop path. */
    stop: (reason: MeetingEndReason, detail: string) => void;
    /** Show (stopsAt ms) or clear (null) the overlay's "stops in 1 minute" notice. */
    warn: (stopsAt: number | null) => void;
    log?: (line: string) => void;
    now?: () => number;
    setInterval?: (fn: () => void, ms: number) => unknown;
    clearInterval?: (handle: unknown) => void;
}

export interface MeetingEndDetectorOptions {
    pollMs?: number;
    /** The call's app must be off the microphone this long before it counts as released. */
    releaseConfirmMs?: number;
    /** ±window around the calendar event's end. */
    calendarWindowMs?: number;
    /** At least this much of the other side's audio (first to last line). */
    minSystemTranscriptMs?: number;
    /** The call's tab must be gone this long. */
    tabGoneConfirmMs?: number;
    /** No new transcript for this long ends the meeting (the notice comes 1 min before). */
    inactivityMs?: number;
    warningMs?: number;
    /** Typing in the overlay holds every stop for this long after the last key. */
    typingGuardMs?: number;
    /** Keep going (or any resume) holds every stop for this long. */
    resumeCooldownMs?: number;
    /** Words of transcript the model check reads. */
    checkWords?: number;
    /** Fewer words than this: nothing to judge, the model is not asked. */
    minCheckWords?: number;
    /**
     * A meeting younger than this never ends by the release or model layers
     * (a mic blip in the first minutes is not an ending); only inactivity can
     * stop it. 0 here by default; the app passes 3 minutes.
     */
    minMeetingMs?: number;
    /** The inactivity stop is off (Undetectable: a stop would show the launcher on its own). */
    inactivityEnabled?: boolean;
}

interface Line {
    channel: 'me' | 'them';
    text: string;
    at: number;
}

const MAX_LINES = 400;

export class MeetingEndDetector {
    private readonly o: Required<MeetingEndDetectorOptions>;
    private readonly now: () => number;
    private timer: unknown = null;

    private startedAt = 0;
    private finished = false;
    private lines: Line[] = [];
    private firstThemAt: number | null = null;
    private lastThemAt: number | null = null;
    private lastActivityAt = 0;
    private lastTypingAt = -Infinity;
    private lastResumeAt = -Infinity;

    private callApp: string | null = null;
    private releasedSince: number | null = null;
    private releaseChecked = false;
    private checkInFlight = false;

    private tabSeen = false;
    private tabGoneSince: number | null = null;

    private warningStopsAt: number | null = null;
    private lastHoldLogAt = -Infinity;
    private lastActivityCount: number | null = null;

    constructor(private readonly deps: MeetingEndDetectorDeps, options: MeetingEndDetectorOptions = {}) {
        this.o = {
            pollMs: options.pollMs ?? 2_000,
            releaseConfirmMs: options.releaseConfirmMs ?? 6_000,
            calendarWindowMs: options.calendarWindowMs ?? 5 * 60_000,
            minSystemTranscriptMs: options.minSystemTranscriptMs ?? 3 * 60_000,
            tabGoneConfirmMs: options.tabGoneConfirmMs ?? 10_000,
            inactivityMs: options.inactivityMs ?? 15 * 60_000,
            warningMs: options.warningMs ?? 60_000,
            typingGuardMs: options.typingGuardMs ?? 15_000,
            resumeCooldownMs: options.resumeCooldownMs ?? 60_000,
            checkWords: options.checkWords ?? 100,
            minCheckWords: options.minCheckWords ?? 8,
            // Off here by default (the detector's own contract); the app passes 3 minutes (wireMeetingAutoStop).
            minMeetingMs: options.minMeetingMs ?? 0,
            inactivityEnabled: options.inactivityEnabled ?? true,
        };
        this.now = deps.now ?? Date.now;
    }

    /** A meeting started: watch it. */
    start(): void {
        this.stopWatching();
        const now = this.now();
        this.startedAt = now;
        this.finished = false;
        this.lines = [];
        this.firstThemAt = this.lastThemAt = null;
        this.lastActivityAt = now;
        this.lastTypingAt = this.lastResumeAt = -Infinity;
        this.callApp = null;
        this.releasedSince = null;
        this.releaseChecked = false;
        this.checkInFlight = false;
        this.tabSeen = false;
        this.tabGoneSince = null;
        this.warningStopsAt = null;
        this.lastActivityCount = this.readActivityCount();
        const set = this.deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
        this.timer = set(() => this.tick(), this.o.pollMs);
        (this.timer as { unref?: () => void })?.unref?.();
        this.log(`watching (inactivity ${this.o.inactivityEnabled ? `${Math.round(this.o.inactivityMs / 60_000)} min` : 'off'})`);
    }

    /** The meeting ended (by the user or by this): stop watching, clear the notice. */
    dispose(): void {
        this.stopWatching();
        this.clearWarning();
        this.finished = true;
    }

    get watching(): boolean {
        return this.timer !== null;
    }

    /** A transcript line from either channel. Interim lines count as activity only. */
    noteTranscript(channel: 'me' | 'them', text: string, final: boolean): void {
        if (!this.watching) return;
        const now = this.now();
        const clean = String(text || '').trim();
        if (!clean) return;
        this.lastActivityAt = now;
        this.clearWarning();
        if (!final) return;
        this.lines.push({ channel, text: clean, at: now });
        if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
        if (channel === 'them') {
            if (this.firstThemAt === null) this.firstThemAt = now;
            this.lastThemAt = now;
        }
    }

    /** The user asked or typed something in the overlay, took a screenshot… */
    noteActivity(): void {
        if (!this.watching) return;
        this.lastActivityAt = this.now();
        this.clearWarning();
    }

    /** A keystroke in the overlay's input. */
    noteTyping(): void {
        if (!this.watching) return;
        this.lastTypingAt = this.now();
        this.noteActivity();
    }

    /**
     * Undetectable switched during the meeting: the inactivity stop follows it
     * (a stop shows the launcher). Off clears a notice already on screen; back on
     * counts the silence from now, so it never stops at once.
     */
    setInactivityEnabled(on: boolean): void {
        if (this.o.inactivityEnabled === on) return;
        (this.o as { inactivityEnabled: boolean }).inactivityEnabled = on;
        if (on) this.lastActivityAt = this.now();
        else this.clearWarning();
        this.log(`inactivity stop ${on ? 'on' : 'off'}`);
    }

    /** Keep going on the notice (or any other resume): hold every stop for a minute. */
    noteResume(): void {
        if (!this.watching) return;
        this.lastResumeAt = this.now();
        this.lastActivityAt = this.lastResumeAt;
        this.clearWarning();
        this.log('resumed by the user; no stop for 60 s');
    }

    /** The last `checkWords` words, oldest first, one named line per turn. */
    recentTranscript(): string {
        const names = this.deps.signals.speakerNames();
        const out: string[] = [];
        let words = 0;
        for (let i = this.lines.length - 1; i >= 0 && words < this.o.checkWords; i--) {
            const line = this.lines[i];
            let parts = line.text.split(/\s+/).filter(Boolean);
            if (words + parts.length > this.o.checkWords) parts = parts.slice(parts.length - (this.o.checkWords - words));
            words += parts.length;
            out.unshift(`${line.channel === 'me' ? names.me : names.them}: ${parts.join(' ')}`);
        }
        return out.join('\n');
    }

    /** One poll. Public for the tests. */
    tick(): void {
        if (!this.watching || this.finished) return;
        const now = this.now();
        this.observeMic(now);
        this.observeTab(now);
        const count = this.readActivityCount();
        if (count !== null && count !== this.lastActivityCount) {
            this.lastActivityCount = count;
            this.noteActivity();
        }

        const hold = this.holdReason(now);
        if (hold) {
            // Typing or a fresh resume is activity too: no notice counts down under it.
            if (this.warningStopsAt !== null) this.clearWarning();
            if (now - this.lastHoldLogAt >= 60_000 && (this.releaseConfirmed(now) || this.tabGone(now) || this.inactiveFor(now) >= this.o.inactivityMs - this.o.warningMs)) {
                this.lastHoldLogAt = now;
                this.log(`stop held: ${hold}`);
            }
            return;
        }

        // c. The extension says the call's tab is gone.
        if (this.tabGone(now)) {
            this.finish('extension_call_closed', `the call's browser tab closed ${Math.round((now - this.tabGoneSince!) / 1000)} s ago`);
            return;
        }

        // a / b. The call's app let go of the microphone.
        if (this.releaseConfirmed(now)) {
            const end = this.deps.signals.calendarEventEnd();
            const heardMs = this.firstThemAt !== null && this.lastThemAt !== null ? this.lastThemAt - this.firstThemAt : 0;
            const calendarMatch = end !== null && Math.abs(now - end) <= this.o.calendarWindowMs;
            if (calendarMatch && heardMs >= this.o.minSystemTranscriptMs) {
                this.finish('mic_released_calendar_end', `${this.callApp} released the microphone; the calendar event ends ${fmtOffset(end! - now)}; other side heard for ${Math.round(heardMs / 1000)} s`);
                return;
            }
            if (!this.releaseChecked && !this.checkInFlight) {
                this.releaseChecked = true;
                const why = end === null ? 'no linked calendar event'
                    : !calendarMatch ? `calendar event ends ${fmtOffset(end - now)}, outside ±${Math.round(this.o.calendarWindowMs / 60_000)} min`
                    : `other side heard for only ${Math.round(heardMs / 1000)} s`;
                this.runCheck(why);
            }
        }

        // d. Nobody has said anything for a while.
        if (!this.o.inactivityEnabled) return;
        const idle = this.inactiveFor(now);
        if (this.warningStopsAt !== null) {
            if (now >= this.warningStopsAt) {
                this.finish('inactivity', `nothing said for ${Math.round(idle / 60_000)} min; the notice was up for ${Math.round(this.o.warningMs / 1000)} s`);
            }
            return;
        }
        if (idle >= this.o.inactivityMs - this.o.warningMs) {
            this.warningStopsAt = now + this.o.warningMs;
            this.log(`nothing said for ${Math.round(idle / 1000)} s; notice shown, stopping in ${Math.round(this.o.warningMs / 1000)} s unless something is said or Keep going`);
            try { this.deps.warn(this.warningStopsAt); } catch { /* the notice is best-effort */ }
        }
    }

    // ── signals ──────────────────────────────────────────────────────────

    private observeMic(now: number): void {
        let apps: string[] | null = null;
        try {
            apps = this.deps.signals.micApps();
        } catch (err) {
            this.log(`reading the microphone holders failed: ${(err as Error)?.message}`);
        }
        if (apps === null) return; // nothing to go on: neither a hold nor a release
        if (this.callApp === null) {
            if (apps.length > 0) {
                this.callApp = apps[0];
                this.log(`the call's app is ${this.callApp} (holds the microphone)`);
            }
            return;
        }
        if (apps.includes(this.callApp)) {
            if (this.releasedSince !== null) this.log(`${this.callApp} holds the microphone again`);
            this.releasedSince = null;
            this.releaseChecked = false;
        } else if (this.releasedSince === null) {
            this.releasedSince = now;
            this.log(`${this.callApp} let go of the microphone`);
        }
    }

    private observeTab(now: number): void {
        let key: string | null = null;
        let open: boolean | null = null;
        try {
            key = this.deps.signals.callKey();
            open = key ? this.deps.signals.callTabOpen(key) : null;
        } catch { /* no extension information this tick */ }
        if (!key || open === null) {
            this.tabGoneSince = null;
            return;
        }
        if (open) {
            if (!this.tabSeen) this.log(`the call's browser tab is open (${key.split(':')[0]})`);
            this.tabSeen = true;
            this.tabGoneSince = null;
        } else if (this.tabSeen && this.tabGoneSince === null) {
            this.tabGoneSince = now;
            this.log(`the call's browser tab is gone (${key.split(':')[0]})`);
        }
    }

    private readActivityCount(): number | null {
        try {
            const n = this.deps.signals.activityCount?.();
            return typeof n === 'number' && Number.isFinite(n) ? n : null;
        } catch {
            return null;
        }
    }

    private releaseConfirmed(now: number): boolean {
        return this.callApp !== null && this.releasedSince !== null && now - this.releasedSince >= this.o.releaseConfirmMs;
    }

    private tabGone(now: number): boolean {
        return this.tabGoneSince !== null && now - this.tabGoneSince >= this.o.tabGoneConfirmMs;
    }

    private inactiveFor(now: number): number {
        return now - this.lastActivityAt;
    }

    private holdReason(now: number): string | null {
        if (now - this.lastTypingAt < this.o.typingGuardMs) return 'the user is typing in the overlay';
        if (now - this.lastResumeAt < this.o.resumeCooldownMs) return 'the user chose to keep going under a minute ago';
        return null;
    }

    private runCheck(why: string): void {
        const words = this.recentTranscript();
        const count = words ? words.split(/\s+/).length : 0;
        if (!this.deps.checkEnded) {
            this.log(`${this.callApp} released the microphone (${why}); no model to ask, falling back to the inactivity stop`);
            return;
        }
        if (count < this.o.minCheckWords) {
            this.log(`${this.callApp} released the microphone (${why}); too little transcript to judge, falling back to the inactivity stop`);
            return;
        }
        const age = (this.deps.now?.() ?? Date.now()) - this.startedAt;
        if (age < this.o.minMeetingMs) {
            this.log(`${this.callApp} released the microphone (${why}); the meeting is only ${Math.round(age / 1000)} s old, too early to end it, falling back to the inactivity stop`);
            return;
        }
        this.checkInFlight = true;
        this.log(`${this.callApp} released the microphone (${why}); asking whether the call ended`);
        let settled: Promise<{ verdict: EndCheckVerdict; why: string }>;
        try {
            settled = this.deps.checkEnded(words);
        } catch (err) {
            settled = Promise.resolve({ verdict: 'NOT_ENDED', why: `check threw: ${(err as Error)?.message}` });
        }
        settled
            .catch((err) => ({ verdict: 'NOT_ENDED' as const, why: `check failed: ${(err as Error)?.message}` }))
            .then((result) => {
                this.checkInFlight = false;
                if (!this.watching || this.finished) return;
                const now = this.now();
                if (result.verdict !== 'ENDED') {
                    this.log(`end-of-call check: NOT_ENDED (${result.why}); keeping going`);
                    return;
                }
                // The world may have moved while the model thought.
                if (this.releasedSince === null) return this.log('end-of-call check said ENDED, but the call\'s app has the microphone again; keeping going');
                const hold = this.holdReason(now);
                if (hold) return this.log(`end-of-call check said ENDED; stop held: ${hold}`);
                this.finish('mic_released_call_ended', `${this.callApp} released the microphone and the end-of-call check said ENDED (${result.why})`);
            });
    }

    private finish(reason: MeetingEndReason, detail: string): void {
        if (this.finished) return;
        this.finished = true;
        this.stopWatching();
        this.log(`stopping the meeting: ${reason} (${detail})`);
        this.clearWarning();
        try {
            this.deps.stop(reason, detail);
        } catch (err) {
            this.log(`stop failed: ${(err as Error)?.message}`);
        }
    }

    private clearWarning(): void {
        if (this.warningStopsAt === null) return;
        this.warningStopsAt = null;
        try { this.deps.warn(null); } catch { /* best-effort */ }
    }

    private stopWatching(): void {
        if (this.timer === null) return;
        (this.deps.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>)))(this.timer);
        this.timer = null;
    }

    private log(line: string): void {
        (this.deps.log ?? ((l: string) => console.log(l)))(`[MeetingAutoStop] ${line}`);
    }
}

function fmtOffset(ms: number): string {
    const min = Math.round(Math.abs(ms) / 60_000);
    if (min === 0) return 'now';
    return ms > 0 ? `in ${min} min` : `${min} min ago`;
}
