/**
 * AutoAnswerQueue (V2 §22-§23). Single-flight: the controller never runs two
 * automatic answers at once; a newer revision of the same question replaces
 * its queued predecessor; a genuinely new question waits behind the running
 * one; stale entries are evicted by generation or by TTL.
 *
 * Capacity is deliberately tiny (MAX_QUEUE_DEPTH): Natively answers the
 * CURRENT question. If three questions pile up while an answer streams, the
 * first two are already stale by the time the stream ends — answering them
 * would be the "answer Q1 after Q2 arrived" failure in slow motion.
 */

import type { AutoAnswerQuestion } from './AutoAnswerTypes';

/** Unfitted placeholder. 1 = "the question the interviewer just moved to". */
export const MAX_QUEUE_DEPTH = 1;
/** A queued question older than this is dropped unanswered (same TTL as the Phase 1 pending slot). */
export const QUEUE_TTL_MS = 6000;

export interface QueuedQuestion {
    question: AutoAnswerQuestion;
    queuedAt: number;
}

export class AutoAnswerQueue {
    private items: QueuedQuestion[] = [];

    /** Returns the entry that was evicted to make room, if any. */
    enqueue(question: AutoAnswerQuestion, now: number): QueuedQuestion | null {
        // Same question id (a revision) → replace in place.
        const idx = this.items.findIndex(i => i.question.id === question.id);
        if (idx >= 0) {
            this.items[idx] = { question, queuedAt: now };
            return null;
        }
        let evicted: QueuedQuestion | null = null;
        while (this.items.length >= MAX_QUEUE_DEPTH) {
            // Oldest goes: the interviewer has moved past it.
            evicted = this.items.shift() ?? null;
        }
        this.items.push({ question, queuedAt: now });
        return evicted;
    }

    dequeue(now: number): QueuedQuestion | null {
        this.evictExpired(now);
        return this.items.shift() ?? null;
    }

    replace(questionId: string, question: AutoAnswerQuestion, now: number): boolean {
        const idx = this.items.findIndex(i => i.question.id === questionId);
        if (idx < 0) return false;
        this.items[idx] = { question, queuedAt: now };
        return true;
    }

    remove(questionId: string): boolean {
        const before = this.items.length;
        this.items = this.items.filter(i => i.question.id !== questionId);
        return this.items.length !== before;
    }

    peek(): QueuedQuestion | null {
        return this.items[0] ?? null;
    }

    depth(): number { return this.items.length; }

    clear(): void { this.items = []; }

    /** Drop everything from a different meeting generation, and everything past TTL. Returns the dropped entries. */
    evictStale(meetingGeneration: number, now: number): QueuedQuestion[] {
        const dropped = this.items.filter(i => i.question.meetingGeneration !== meetingGeneration || now - i.queuedAt > QUEUE_TTL_MS);
        if (dropped.length) this.items = this.items.filter(i => !dropped.includes(i));
        return dropped;
    }

    private evictExpired(now: number): void {
        this.items = this.items.filter(i => now - i.queuedAt <= QUEUE_TTL_MS);
    }
}
