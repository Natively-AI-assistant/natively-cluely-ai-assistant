/**
 * Semantic question deduplication (V2 §21, V3 Amendment 6).
 *
 * Three layers, cheapest first, over the last DEDUP_WINDOW committed questions:
 *   1. normalized string equality
 *   2. token similarity — the repo's existing content-aware Jaccard
 *      (`speculativeQuestionSimilarity`), not a second implementation
 *   3. embedding cosine on the survivors only, with the embedder the app
 *      already bundles (Xenova/all-MiniLM-L6-v2 via LocalEmbeddingProvider —
 *      the spec says "bge-small"; the repo bundles MiniLM, see progress notes)
 *
 * Embeddings are cached by questionId and never computed for a candidate the
 * cheap layers already decided. The embedder is injected and optional: with
 * none, layer 3 is skipped and the decision is the cheap layers' verdict.
 */

import { speculativeQuestionSimilarity } from '../../llm/speculativeSimilarity';
import { normalizeForCompare } from './AutoAnswerDetector';

/** Compare against the last N committed questions (V3 Amendment 6). */
export const DEDUP_WINDOW = 5;
/** Layer-2 token similarity at or above which two questions are the same ask. Unfitted placeholder. */
export const DEDUP_JACCARD_THRESHOLD = 0.80;
/** Layer-2 band below which no embedding is spent: clearly different. Unfitted placeholder. */
export const DEDUP_JACCARD_CLEAR_BELOW = 0.25;
/** Layer-3 cosine threshold (also the speculative reuse threshold, V3 Amendment 6). Unfitted placeholder. */
export const REUSE_THRESHOLD = 0.90;

export type Embedder = (text: string) => Promise<number[] | null>;

export interface DedupEntry {
    id: string;
    text: string;
    committedAt: number;
    meetingGeneration: number;
}

export type DedupVerdict =
    | { duplicate: false; layer: 'none' | 'cleared_cheap' | 'embedding' }
    | { duplicate: true; layer: 'exact' | 'jaccard' | 'embedding'; of: string; score: number };

export class AutoAnswerDedup {
    private recent: DedupEntry[] = [];
    private embeddings = new Map<string, number[]>();

    constructor(private readonly embed: Embedder | null = null) {}

    /** Record a committed question (dispatched OR offered) for future comparisons. */
    remember(entry: DedupEntry): void {
        this.recent.push(entry);
        while (this.recent.length > DEDUP_WINDOW) {
            const gone = this.recent.shift();
            if (gone) this.embeddings.delete(gone.id);
        }
    }

    /** Drop everything from another meeting generation. */
    resetForGeneration(meetingGeneration: number): void {
        this.recent = this.recent.filter(e => e.meetingGeneration === meetingGeneration);
        for (const id of [...this.embeddings.keys()]) {
            if (!this.recent.some(e => e.id === id)) this.embeddings.delete(id);
        }
    }

    clear(): void {
        this.recent = [];
        this.embeddings.clear();
    }

    /** Synchronous cheap layers only. */
    checkCheap(text: string): DedupVerdict | 'ambiguous' {
        const norm = normalizeForCompare(text);
        if (!norm) return { duplicate: false, layer: 'none' };
        let ambiguous = false;
        for (const prev of [...this.recent].reverse()) {
            if (normalizeForCompare(prev.text) === norm) {
                return { duplicate: true, layer: 'exact', of: prev.id, score: 1 };
            }
            const sim = speculativeQuestionSimilarity(prev.text, text);
            if (sim >= DEDUP_JACCARD_THRESHOLD) {
                return { duplicate: true, layer: 'jaccard', of: prev.id, score: sim };
            }
            if (sim >= DEDUP_JACCARD_CLEAR_BELOW) ambiguous = true;
        }
        return ambiguous ? 'ambiguous' : { duplicate: false, layer: this.recent.length ? 'cleared_cheap' : 'none' };
    }

    /** All three layers. Embeds only when the cheap layers are ambiguous. */
    async check(questionId: string, text: string): Promise<DedupVerdict> {
        const cheap = this.checkCheap(text);
        if (cheap !== 'ambiguous') return cheap;
        if (!this.embed) return { duplicate: false, layer: 'cleared_cheap' };

        const candidateVec = await this.vectorFor(questionId, text);
        if (!candidateVec) return { duplicate: false, layer: 'cleared_cheap' };
        for (const prev of [...this.recent].reverse()) {
            const prevVec = await this.vectorFor(prev.id, prev.text);
            if (!prevVec) continue;
            const cos = cosine(candidateVec, prevVec);
            if (cos >= REUSE_THRESHOLD) return { duplicate: true, layer: 'embedding', of: prev.id, score: cos };
        }
        return { duplicate: false, layer: 'embedding' };
    }

    /** Cosine between two question texts (for speculative reuse); null when no embedder. */
    async similarity(idA: string, textA: string, idB: string, textB: string): Promise<number | null> {
        if (!this.embed) return null;
        const a = await this.vectorFor(idA, textA);
        const b = await this.vectorFor(idB, textB);
        if (!a || !b) return null;
        return cosine(a, b);
    }

    private async vectorFor(id: string, text: string): Promise<number[] | null> {
        const cached = this.embeddings.get(id);
        if (cached) return cached;
        try {
            const vec = await this.embed!(text);
            if (vec && vec.length) this.embeddings.set(id, vec);
            return vec;
        } catch {
            return null; // the embedder failing must never block a decision (V2 §38)
        }
    }
}

export function cosine(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
