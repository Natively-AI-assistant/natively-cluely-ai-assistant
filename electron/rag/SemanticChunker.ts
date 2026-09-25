// electron/rag/SemanticChunker.ts
// Turn-based semantic chunking for RAG
// Chunks by speaker turns, respects token limits
// Uses sliding-window overlap to preserve context across chunk boundaries

import { CleanedSegment, estimateTokens } from './TranscriptPreprocessor';

export interface Chunk {
    meetingId: string;
    chunkIndex: number;
    speaker: string;
    startMs: number;
    endMs: number;
    text: string;
    tokenCount: number;
}

// Chunking parameters
const TARGET_TOKENS = 300;
const MAX_TOKENS = 400;

// Sliding window overlap: keep last N segments (~50 tokens) from previous chunk
const OVERLAP_TARGET_TOKENS = 50;

/**
 * The label a turn carries INSIDE chunk text. The same vocabulary the live
 * transcript evidence uses (live-transcript-port: ME / THEM), because the
 * grounding rule that lets the user's own spoken words evidence a personal
 * fact is written against the ME: label. Names from diarization pass through.
 */
function turnLabel(speaker: string): string {
    if (speaker === 'You') return 'ME';
    if (speaker === 'Speaker') return 'THEM';
    if (speaker === 'Natively') return 'ASSISTANT';
    return speaker;
}

function turnLine(seg: CleanedSegment): string {
    return `${turnLabel(seg.speaker)}: ${seg.text}`;
}

/**
 * Build a chunk from accumulated turns. Text is one labelled line per turn:
 * chunks now span speakers, so an unlabelled join would no longer say who
 * said what (it never did — the text used to carry no label at all).
 */
function buildChunk(
    meetingId: string,
    index: number,
    segments: CleanedSegment[]
): Chunk {
    const text = segments.map(turnLine).join('\n');
    return {
        meetingId,
        chunkIndex: index,
        speaker: segments[0].speaker,
        startMs: segments[0].startMs,
        endMs: segments[segments.length - 1].endMs,
        text,
        tokenCount: estimateTokens(text)
    };
}

const isQuestionTurn = (seg: CleanedSegment): boolean => seg.isQuestion || /\?\s*$/.test(seg.text);

/**
 * Exchange-based chunking with overlap (2026-09-24).
 *
 * WHY NOT PER SPEAKER TURN ANY MORE
 * The previous version split at EVERY speaker change. In an interview that is
 * every line, so "How big was the team on that?" and "It was four engineers"
 * became two chunks, and a semantic search for the team size found an answer
 * with no question attached to give it meaning (measured on a live
 * two-channel interview: one chunk per turn, 52 chunks for 53 turns).
 *
 * Strategy:
 * 1. Accumulate consecutive turns, of any speaker, up to TARGET_TOKENS.
 * 2. Never end a chunk between a question and the other party's answer: the
 *    answer joins the question's chunk while that stays within MAX_TOKENS.
 * 3. On a split, the next chunk starts with an overlap: the last turn when it
 *    is a question (so its answer sits with it), otherwise the last turn if it
 *    is short (~OVERLAP_TARGET_TOKENS) — continuity across the boundary.
 * 4. A single turn over MAX_TOKENS is its own chunk (rare edge case).
 */
export function chunkTranscript(
    meetingId: string,
    segments: CleanedSegment[]
): Chunk[] {
    if (segments.length === 0) return [];

    const chunks: Chunk[] = [];
    let current: CleanedSegment[] = [];
    let currentTokens = 0;
    let chunkIndex = 0;

    const flush = (next: CleanedSegment) => {
        chunks.push(buildChunk(meetingId, chunkIndex++, current));
        const last = current[current.length - 1];
        const lastTokens = estimateTokens(turnLine(last));
        // Carry the last turn when it is a question the next turn answers, or
        // when it is short enough to be cheap context.
        const carry = (isQuestionTurn(last) && next.speaker !== last.speaker && lastTokens < MAX_TOKENS)
            || lastTokens <= OVERLAP_TARGET_TOKENS;
        current = carry ? [last] : [];
        currentTokens = carry ? lastTokens : 0;
    };

    for (const seg of segments) {
        const segTokens = estimateTokens(turnLine(seg));

        if (current.length > 0 && currentTokens + segTokens > TARGET_TOKENS) {
            const last = current[current.length - 1];
            // The answer to a question stays with it, up to the hard maximum.
            const answersLast = isQuestionTurn(last) && seg.speaker !== last.speaker
                && currentTokens + segTokens <= MAX_TOKENS;
            // A lone carried turn is not a chunk of its own.
            const onlyCarry = current.length === 1 && chunks.length > 0;
            if (!answersLast && !(onlyCarry && currentTokens + segTokens <= MAX_TOKENS)) flush(seg);
        }

        current.push(seg);
        currentTokens += segTokens;

        // Force split if a single turn exceeds max (rare edge case)
        if (currentTokens > MAX_TOKENS && current.length === 1) {
            chunks.push(buildChunk(meetingId, chunkIndex++, current));
            current = [];
            currentTokens = 0;
        }
    }

    // Flush the remainder, unless it is only the overlap already in the last chunk.
    if (current.length > 0) {
        const tailIsCarryOnly = chunks.length > 0 && current.length === 1
            && chunks[chunks.length - 1].endMs === current[0].endMs;
        if (!tailIsCarryOnly) chunks.push(buildChunk(meetingId, chunkIndex++, current));
    }

    return chunks;
}

/**
 * Format chunks for display in context
 */
export function formatChunkForContext(chunk: Chunk): string {
    const minutes = Math.floor(chunk.startMs / 60000);
    const seconds = Math.floor((chunk.startMs % 60000) / 1000);
    const timestamp = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    // Chunks built since 2026-09-24 label every turn inside the text; older
    // rows in the store do not, and keep the single-speaker prefix.
    if (/^(?:ME|THEM|ASSISTANT): /m.test(chunk.text)) return `[${timestamp}]\n${chunk.text}`;
    return `[${timestamp}] ${chunk.speaker}: ${chunk.text}`;
}
