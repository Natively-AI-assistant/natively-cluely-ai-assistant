/**
 * Mic echo gate (issue #710).
 *
 * With laptop speakers and the built-in microphone, the mic hears the meeting
 * and its STT transcribes the other side a second time, as "Me". Those lines
 * reach the AI's context ([ME] turns), the Answer button's dictated question,
 * the notepad transcript and the saved meeting. Nothing filters them on
 * Windows: the mic runs without the WebRTC VAD there (PR #497,
 * native-module/src/silence_suppression.rs), and a VAD would not reject
 * speech from the speakers anyway.
 *
 * The gate sits where both channels' transcripts pass (main.ts onSegment) and
 * drops a mic segment when it repeats what the meeting audio said a moment
 * ago. A mic line counts as echo only when both hold:
 *
 *  - containment: most of its words are in the meeting text of the last
 *    `windowMs` (`echoContainment`, which tolerates the cut-off edge words two
 *    STT sessions produce on the same speech);
 *  - overlap in time: the meeting channel was producing text while the mic
 *    line was being spoken. An echo is simultaneous with its source; a real
 *    answer that reuses the question's words comes after the other side
 *    stopped, so it is never dropped on wording alone.
 *
 * The two transcribers finalize the same words at different moments, and the
 * mic's can come first. So while the meeting channel is active, a mic final
 * that is not yet an echo is held up to `holdMs` and judged again as meeting
 * text arrives. When the meeting channel is quiet there is nothing to wait
 * for, and the final goes through at once. Held and later mic segments leave
 * in arrival order.
 *
 * Finals under `minTokens` words ("yeah", "okay") are never dropped: too
 * short to tell apart. Short interims are hidden only when every word was
 * just said by the meeting, and their final is still judged by the rule above.
 *
 * Pure: clock and timers are injected, no Electron, no I/O.
 */

import { echoContainment, normalizeForCompare } from '../intelligence/autoAnswer/AutoAnswerText';

/** Windows first: nothing filters the mic there. macOS waits for a measurement (see the issue). */
export function micEchoGateEnabledFor(platform: NodeJS.Platform): boolean {
    switch (platform) {
        case 'win32':
            return true;
        case 'darwin':
            // The mic's VAD rejects non-speech only, so speech bleed reaches
            // the transcript here too; off until bled sessions are measured.
            return false;
        default:
            // Not a shipped platform: transcripts pass unfiltered, as before.
            return false;
    }
}

export interface MicEchoGateOptions {
    enabled: boolean;
    now?: () => number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
    /** How long meeting text stays comparable. */
    windowMs?: number;
    /** Longest a mic final waits for the meeting's copy of the same words. */
    holdMs?: number;
    /** Share of the mic line's words found in recent meeting text. */
    threshold?: number;
    /** A final shorter than this is never judged. */
    minTokens?: number;
    /** Meeting activity this long before the mic line began still counts as overlapping. */
    overlapSlackMs?: number;
    /** A mic final with no interim before it is taken to have started this long before it arrived. */
    assumedSpanMs?: number;
    onDrop?: (drop: { text: string; final: boolean; containment: number }) => void;
}

export interface MicSegment {
    text: string;
    isFinal: boolean;
}

interface Queued {
    seg: MicSegment;
    deliver: () => void;
    arrivedAt: number;
    spanStart: number;
}

/** Hesitations one transcriber writes and the other drops; never evidence either way. */
const FILLERS = new Set(['uh', 'um', 'umm', 'uhm', 'er', 'erm', 'ah', 'hmm', 'mm', 'mhm']);

function contentTokens(text: string): string[] {
    return normalizeForCompare(text).split(' ').filter((t) => t && !FILLERS.has(t));
}

export class MicEchoGate {
    private readonly enabled: boolean;
    private readonly now: () => number;
    private readonly setTimer: (fn: () => void, ms: number) => unknown;
    private readonly clearTimer: (handle: unknown) => void;
    private readonly windowMs: number;
    private readonly holdMs: number;
    private readonly threshold: number;
    private readonly minTokens: number;
    private readonly overlapSlackMs: number;
    private readonly assumedSpanMs: number;
    private readonly onDrop?: MicEchoGateOptions['onDrop'];

    private meetingFinals: Array<{ text: string; at: number }> = [];
    private meetingInterim: { text: string; at: number } | null = null;
    private lastMeetingAt = -Infinity;
    /** When the mic utterance now in progress began (its first interim), or null between utterances. */
    private micSpanStart: number | null = null;
    private queue: Queued[] = [];
    private timer: unknown = null;
    /** Until then mic finals are judged on arrival, never held (the Answer button's Stop). */
    private expediteUntil = -Infinity;
    private dropped = 0;

    constructor(opts: MicEchoGateOptions) {
        this.enabled = opts.enabled;
        this.now = opts.now ?? Date.now;
        this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
        this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
        this.windowMs = opts.windowMs ?? 8000;
        this.holdMs = opts.holdMs ?? 1200;
        this.threshold = opts.threshold ?? 0.7;
        this.minTokens = opts.minTokens ?? 4;
        this.overlapSlackMs = opts.overlapSlackMs ?? 500;
        this.assumedSpanMs = opts.assumedSpanMs ?? 2000;
        this.onDrop = opts.onDrop;
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    /** Mic segments dropped as echo since the last reset. */
    get droppedCount(): number {
        return this.dropped;
    }

    /** A meeting-audio (system channel) segment. */
    noteMeetingAudio(text: string, isFinal: boolean): void {
        if (!this.enabled) return;
        const at = this.now();
        if (text.trim()) {
            if (isFinal) this.meetingFinals.push({ text, at });
            else this.meetingInterim = { text, at };
            this.lastMeetingAt = at;
        }
        this.prune(at);
        this.drain();
    }

    /** A mic segment. `deliver` runs once, unless the segment is dropped as echo. */
    submitMic(seg: MicSegment, deliver: () => void): void {
        if (!this.enabled) {
            deliver();
            return;
        }
        const at = this.now();
        const spanStart = this.micSpanStart ?? (seg.isFinal ? at - this.assumedSpanMs : at);
        if (seg.isFinal) this.micSpanStart = null;
        else if (this.micSpanStart === null) this.micSpanStart = at;

        // Partials are latest-wins downstream: one waiting behind a held final replaces the previous one.
        const tail = this.queue[this.queue.length - 1];
        if (!seg.isFinal && tail && !tail.seg.isFinal && this.queue.length > 1) {
            this.queue[this.queue.length - 1] = { seg, deliver, arrivedAt: at, spanStart: tail.spanStart };
        } else {
            this.queue.push({ seg, deliver, arrivedAt: at, spanStart });
        }
        this.drain();
    }

    /**
     * The user ended a dictation (Answer button Stop): its last final must not
     * wait out a hold the renderer's short tail grace would miss. Held finals
     * are judged now, and so is every mic final for the next few seconds.
     */
    expedite(forMs = 3000): void {
        if (!this.enabled) return;
        this.expediteUntil = this.now() + forMs;
        this.drain();
    }

    /** Judge and release everything held, now (meeting stop, before the transcript is saved). */
    flush(): void {
        if (!this.enabled) return;
        this.expediteUntil = Infinity;
        this.drain();
        this.expediteUntil = -Infinity;
    }

    /** Forget all of it, held segments included (meeting start). */
    reset(): void {
        if (this.timer !== null) this.clearTimer(this.timer);
        this.timer = null;
        this.queue = [];
        this.meetingFinals = [];
        this.meetingInterim = null;
        this.lastMeetingAt = -Infinity;
        this.micSpanStart = null;
        this.expediteUntil = -Infinity;
        this.dropped = 0;
    }

    /** How much of `text` the recent meeting audio already said, 0..1. Exposed for tests and triage. */
    containment(text: string): number {
        const needle = contentTokens(text).join(' ');
        if (!needle) return 0;
        return echoContainment(needle, this.recentMeetingText(this.now()));
    }

    private recentMeetingText(at: number): string {
        const since = at - this.windowMs;
        const parts = this.meetingFinals.filter((f) => f.at >= since).map((f) => f.text);
        if (this.meetingInterim && this.meetingInterim.at >= since) parts.push(this.meetingInterim.text);
        return parts.join(' ');
    }

    private prune(at: number): void {
        const since = at - this.windowMs;
        while (this.meetingFinals.length && this.meetingFinals[0].at < since) this.meetingFinals.shift();
        if (this.meetingInterim && this.meetingInterim.at < since) this.meetingInterim = null;
    }

    /** The meeting channel produced text while this mic line was being spoken. */
    private overlaps(item: Queued): boolean {
        return this.lastMeetingAt >= item.spanStart - this.overlapSlackMs;
    }

    private isEcho(item: Queued): { echo: boolean; containment: number } {
        const tokens = contentTokens(item.seg.text);
        if (tokens.length === 0 || !this.overlaps(item)) return { echo: false, containment: 0 };
        const containment = echoContainment(tokens.join(' '), this.recentMeetingText(this.now()));
        if (tokens.length < this.minTokens) {
            // A short final is never dropped; a short interim only when every word was just said.
            return { echo: !item.seg.isFinal && containment === 1, containment };
        }
        return { echo: containment >= this.threshold, containment };
    }

    private drain(): void {
        if (this.timer !== null) {
            this.clearTimer(this.timer);
            this.timer = null;
        }
        const at = this.now();
        while (this.queue.length) {
            const head = this.queue[0];
            const verdict = this.isEcho(head);
            if (verdict.echo) {
                this.queue.shift();
                this.dropped++;
                this.onDrop?.({ text: head.seg.text, final: head.seg.isFinal, containment: verdict.containment });
                continue;
            }
            const expedited = at < this.expediteUntil;
            const mayStillEcho = head.seg.isFinal
                && !expedited
                && contentTokens(head.seg.text).length >= this.minTokens
                && this.overlaps(head)
                && at - head.arrivedAt < this.holdMs;
            if (mayStillEcho) {
                this.timer = this.setTimer(() => {
                    this.timer = null;
                    this.drain();
                }, head.arrivedAt + this.holdMs - at);
                return;
            }
            this.queue.shift();
            head.deliver();
        }
    }
}
