/**
 * A/B HARNESS — the PR #497 Auto Answer trigger, byte-faithful.
 *
 * Exists ONLY so the old and new engines can be compared live in one build:
 *
 *   NATIVELY_AUTO_ANSWER_ENGINE=legacy npm run dev   → this trigger
 *   npm run dev                                      → the V3 controller
 *
 * Faithfully reproduced OLD semantics, including the known defects the V3
 * campaign fixed — do not "improve" them, they are the point of the A/B:
 *   - a bare 900 ms debounce restarted by EVERY interviewer final, no hard
 *     cap (a chatty provider starves it);
 *   - single final turn as the question (no utterance reconstruction);
 *   - hardcoded confidence 0.9;
 *   - transient gate rejections drop the candidate permanently (no rearm);
 *   - no dual-channel gating, no dedup beyond exact string, no endpoints.
 *
 * Remove this file (and its wiring in main.ts) when the A/B is done.
 */

import { evaluateAutoAnswerGate } from './autoAnswerGate';

export interface LegacyAutoAnswerHost {
    isEnabled(): boolean;
    isMeetingActive(): boolean;
    meetingGeneration(): number;
    lastInterviewerTurn(): string | null | undefined;
    engineAccepting(): boolean;
    dispatch(question: string): void;
    log?(line: string): void;
}

const AUTO_ANSWER_DEBOUNCE_MS = 900;

export class LegacyAutoAnswerTrigger {
    private timer: NodeJS.Timeout | null = null;
    private lastAutoAnsweredQuestion: string | null = null;

    constructor(private readonly host: LegacyAutoAnswerHost) {}

    /** Old call site: `if (segment.isFinal && speaker === 'interviewer') scheduleAutoAnswer()`. */
    scheduleAutoAnswer(): void {
        if (!this.host.isEnabled()) return;
        if (!this.host.isMeetingActive()) return;

        const generation = this.host.meetingGeneration();
        if (this.timer) clearTimeout(this.timer);

        this.timer = setTimeout(() => {
            this.timer = null;
            const decision = evaluateAutoAnswerGate({
                enabled: this.host.isEnabled(),
                meetingActive: this.host.isMeetingActive(),
                generationAtSchedule: generation,
                generationNow: this.host.meetingGeneration(),
                lastQuestion: this.host.lastInterviewerTurn(),
                lastAnsweredQuestion: this.lastAutoAnsweredQuestion,
                engineAccepting: this.host.engineAccepting(),
            });
            if (!decision.dispatch) {
                this.host.log?.(`[AutoAnswer:legacy] skipped: ${decision.reason}`);
                return;
            }
            this.lastAutoAnsweredQuestion = decision.question;
            this.host.log?.('[AutoAnswer:legacy] dispatching (confidence 0.9, single last turn)');
            this.host.dispatch(decision.question);
        }, AUTO_ANSWER_DEBOUNCE_MS);
    }

    cancelAutoAnswer(): void {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this.lastAutoAnsweredQuestion = null;
    }
}
