/**
 * Speaker bleed on the microphone (F-CTX-12, 2026-11-13).
 *
 * On laptop speakers the other side's words come back through the mic, are
 * transcribed on the mic channel and were stored as the user's ([ME]). A mic
 * final right after an answer runs the refinement follow-up, so "Can you make
 * that shorter?" said by the interviewer became the user asking for it. Only
 * the Natively relay holds echo back (server side, natively-api echoGate);
 * BYOK providers had nothing, on macOS and Windows alike.
 *
 * This is the client-side check, provider- and platform-independent: a mic
 * final is echo when its words repeat what the interviewer said in the last
 * MIC_ECHO_WINDOW_MS (their finals, and their latest interim, since the mic's
 * final often lands before the system channel's). main.ts then keeps it out
 * of the session context and retrieval; the display still gets it.
 *
 * Deliberately narrow: at least MIC_ECHO_MIN_WORDS words, and most of its
 * word pairs said by the interviewer. A paraphrase ("So how would I design…"
 * after "How would you design…"), an answer, or a short "yes" stays the
 * user's. Not covered: a mic final that arrives before any interviewer text
 * of the same words (both transcribers usually show the interviewer first).
 */

import { isCoveredByLive } from './sttGapRecovery';

/** How far back the interviewer's words are compared. */
export const MIC_ECHO_WINDOW_MS = 8_000;
/** Shorter mic finals are never called echo. */
export const MIC_ECHO_MIN_WORDS = 3;
/** Share of the mic final's word pairs the interviewer must have said. */
export const MIC_ECHO_PAIR_SHARE = 0.7;

export class MicEchoGuard {
    private finals: Array<{ text: string; at: number }> = [];
    private interim: { text: string; at: number } | null = null;

    /** Every interviewer segment (finals and interims), as it arrives. */
    noteInterviewer(text: string, isFinal: boolean, nowMs: number): void {
        const t = (text ?? '').trim();
        if (!t) return;
        if (isFinal) {
            this.finals.push({ text: t, at: nowMs });
            this.interim = null;
            this.prune(nowMs);
        } else {
            this.interim = { text: t, at: nowMs };
        }
    }

    /** Whether a mic final repeats what the interviewer just said. */
    isEcho(text: string, nowMs: number): boolean {
        const t = (text ?? '').trim();
        if (t.split(/\s+/).filter(Boolean).length < MIC_ECHO_MIN_WORDS) return false;
        this.prune(nowMs);
        const heard = this.finals.map((f) => f.text);
        if (this.interim && nowMs - this.interim.at <= MIC_ECHO_WINDOW_MS) heard.push(this.interim.text);
        if (heard.length === 0) return false;
        return isCoveredByLive(t, heard, MIC_ECHO_PAIR_SHARE);
    }

    reset(): void {
        this.finals = [];
        this.interim = null;
    }

    private prune(nowMs: number): void {
        const cutoff = nowMs - MIC_ECHO_WINDOW_MS;
        if (this.finals.length && this.finals[0].at < cutoff) this.finals = this.finals.filter((f) => f.at >= cutoff);
    }
}
