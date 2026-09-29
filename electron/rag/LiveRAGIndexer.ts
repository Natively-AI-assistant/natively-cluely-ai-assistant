// electron/rag/LiveRAGIndexer.ts
// JIT RAG: Incrementally indexes transcript during a live meeting.
//
// Architecture:
// - Background timer (30s) chunks & embeds NEW transcript segments
// - Embedding is fire-and-forget — never blocks the query path
// - At query time, VectorStore already has indexed chunks for fast search
// - Falls back gracefully if embedding API unavailable

import { preprocessTranscript, RawSegment } from './TranscriptPreprocessor';
import { chunkTranscript, Chunk } from './SemanticChunker';
import { VectorStore } from './VectorStore';
import { EmbeddingPipeline } from './EmbeddingPipeline';

const INDEXING_INTERVAL_MS = 30_000;  // 30 seconds
const MIN_NEW_SEGMENTS = 3;           // Don't chunk unless we have enough new content
/** Chunks per embedding call. One call used to carry the whole new slice, so a
 *  burst (a long pause, a parked tick) could exceed the pipeline's 30 s
 *  timeout and fail as a unit. */
const EMBED_BATCH_SIZE = 16;
/** Upper bound on embedding calls in one tick, so a large retry backlog cannot
 *  hold the indexer for minutes; the rest waits for the next tick. */
const MAX_EMBED_BATCHES_PER_TICK = 8;

export class LiveRAGIndexer {
    private vectorStore: VectorStore;
    private embeddingPipeline: EmbeddingPipeline;
    private meetingId: string | null = null;
    /**
     * CR-02: identity of the CURRENT session. `meetingId` cannot serve this
     * purpose — the only production caller passes the literal constant
     * 'live-meeting-current' (electron/main.ts), so comparing meetingId VALUES
     * across an overlapping start/stop always compares equal and the guard is
     * inert. A monotonic token distinguishes session N from session N+1.
     */
    private sessionSeq = 0;
    private sessionToken = 0;   // 0 = no session
    private timer: ReturnType<typeof setInterval> | null = null;
    private allSegments: RawSegment[] = [];
    private indexedSegmentCount = 0;  // High-water mark: segments already chunked
    private chunkCounter = 0;         // Running chunk index
    private indexedChunkCount = 0;    // Total chunks with embeddings
    /**
     * Saved chunks that still have no vector (2026-09-24). A failed or
     * not-yet-ready embedding used to leave them unembedded for the rest of the
     * meeting — the high-water mark moved on and nothing came back for them —
     * so that stretch of speech was invisible to semantic search until the
     * post-meeting re-index. They now wait here and are retried every tick.
     */
    private pendingEmbeds: Array<{ id: number; text: string }> = [];
    /** Chunks with a vector in the current space — re-queued if the space changes. */
    private embeddedChunks: Array<{ id: number; text: string }> = [];
    /**
     * The trailing QUESTION turn of the previous tick's slice. Each tick chunks
     * only its own new speech, so a question asked just before a tick and its
     * answer given just after it landed in different chunks — the split the
     * exchange chunker exists to avoid. The question is re-chunked with the
     * next slice (it also stays in its own chunk: overlap, not a move).
     */
    private questionCarry: RawSegment[] = [];
    private isProcessing = false;     // Guard against concurrent ticks
    /**
     * F-414: the promise of the tick currently in flight. stop()'s "final
     * flush" used to call tick() directly, which returns IMMEDIATELY when
     * isProcessing is true — so whenever a tick was parked inside
     * ForegroundGate.waitUntilIdle() (up to 30s while an answer streams) or
     * getEmbeddingsWithFallback() (30s primary + 30s fallback), the flush was
     * a no-op and stop() then zeroed allSegments. Everything spoken since that
     * tick's slice point was discarded, never chunked, never embedded. The
     * common "ask a question, then stop the meeting" sequence puts
     * waitUntilIdle squarely in that window.
     */
    private inFlightTick: Promise<void> | null = null;
    private isActive = false;

    constructor(vectorStore: VectorStore, embeddingPipeline: EmbeddingPipeline) {
        this.vectorStore = vectorStore;
        this.embeddingPipeline = embeddingPipeline;
    }

    /**
     * Start live indexing for a meeting.
     * Begins a background timer that periodically chunks & embeds new transcript.
     */
    start(meetingId: string): void {
        if (this.isActive) {
            this.stop();
        }

        this.meetingId = meetingId;
        this.sessionToken = ++this.sessionSeq;
        this.allSegments = [];
        this.indexedSegmentCount = 0;
        this.chunkCounter = 0;
        this.indexedChunkCount = 0;
        this.pendingEmbeds = [];
        this.embeddedChunks = [];
        this.questionCarry = [];
        this.isProcessing = false;
        this.isActive = true;

        console.log(`[LiveRAGIndexer] Started for meeting ${meetingId}`);

        this.timer = setInterval(() => {
            // R-03(1a): tick() now registers itself in `inFlightTick` only when it
            // actually enters the processing body. Registering here tracked EVERY
            // tick — including the ones that return instantly at the isProcessing
            // guard — and that no-op promise's completion nulled the ref while the
            // real tick was still parked, which is what made stop()'s flush a no-op.
            this.tick().catch(err => {
                console.error('[LiveRAGIndexer] Tick error:', err);
            });
        }, INDEXING_INTERVAL_MS);
    }

    /**
     * Feed new transcript segments from the live meeting.
     * Called by SessionTracker whenever new transcript arrives.
     * This is append-only — segments are never modified after being fed.
     */
    feedSegments(segments: RawSegment[]): void {
        if (!this.isActive || !this.meetingId) return;
        this.allSegments.push(...segments);
    }

    /**
     * Core indexing tick — processes only NEW segments since last tick.
     * 
     * Flow:
     * 1. Slice segments from high-water mark
     * 2. Preprocess (clean, merge speakers)
     * 3. Chunk (semantic boundaries, 200-400 tokens)
     * 4. Save chunks to VectorStore
     * 5. Embed each chunk via Gemini API
     * 6. Advance high-water mark
     */
    private async tick(force = false): Promise<void> {
        if (!this.isActive || !this.meetingId) return;
        if (this.isProcessing) return;  // Skip if previous tick still running

        const newSegmentCount = this.allSegments.length - this.indexedSegmentCount;
        // F-414: the batching threshold is a THROUGHPUT optimisation for the
        // periodic tick. Applying it to the final flush too meant a meeting
        // ending with 1-2 unindexed segments always lost them.
        // Pending embeddings are retried even when nobody has spoken since.
        const hasPending = this.pendingEmbeds.length > 0;
        if (!force && newSegmentCount < MIN_NEW_SEGMENTS && !hasPending) return;  // Not enough new content
        if (force && newSegmentCount <= 0 && !hasPending) return;

        this.isProcessing = true;
        const meetingId = this.meetingId;
        const sessionToken = this.sessionToken;

        // R-03(1a): register ONLY a tick that actually reached the body, so
        // stop() awaits the parked work rather than an already-settled no-op.
        const running = this.runTick(meetingId, sessionToken).finally(() => {
            this.isProcessing = false;
            if (this.inFlightTick === running) this.inFlightTick = null;
        });
        this.inFlightTick = running;
        return running;
    }

    /**
     * R-03(1b): a tick can park ~90s (ForegroundGate 30s + embeddings 30s+30s).
     * If the meeting ended and a NEW one started meanwhile, this tick's counters
     * belong to a dead session and must not be written into the live one.
     * `processedUpTo` in particular is an ABSOLUTE segment count: writing a dead
     * session's value into a fresh meeting drives `newSegmentCount` negative, so
     * every later tick early-returns and the new meeting is never live-indexed at
     * all. Baseline's `= this.allSegments.length` self-clamped to the live array
     * and recovered on the next feed, so an unguarded write is a REGRESSION.
     */
    private stillOwns(sessionToken: number): boolean {
        return this.isActive && this.sessionToken === sessionToken;
    }

    private async runTick(meetingId: string, sessionToken: number): Promise<void> {
        try {
            // 1. Get only new segments
            // F-414: capture the slice point and advance the high-water mark
            // to THAT, never to the live array length. The tick awaits the
            // ForegroundGate and the embedding provider (up to ~90s), and
            // feedSegments() keeps appending throughout — so advancing to
            // `this.allSegments.length` at completion marked everything spoken
            // DURING the tick as indexed without ever chunking it. That silently
            // dropped transcript on every periodic tick, not just at stop().
            const sliceStart = this.indexedSegmentCount;
            const newSegments = this.allSegments.slice(sliceStart);
            const processedUpTo = sliceStart + newSegments.length;

            // 2-4. Chunk and save any new speech; the chunks join the pending queue.
            if (newSegments.length > 0) {
                const toChunk = [...this.questionCarry, ...newSegments];
                const cleaned = preprocessTranscript(toChunk);
                // Carry this slice's trailing question turn into the next tick.
                const lastTurn = cleaned[cleaned.length - 1];
                if (lastTurn && (lastTurn.isQuestion || /\?\s*$/.test(lastTurn.text))) {
                    const speaker = toChunk[toChunk.length - 1].speaker;
                    let k = toChunk.length;
                    while (k > 0 && toChunk[k - 1].speaker === speaker && toChunk.length - k < 3) k--;
                    this.questionCarry = toChunk.slice(k);
                } else {
                    this.questionCarry = [];
                }
                const chunks = cleaned.length > 0 ? chunkTranscript(meetingId, cleaned) : [];
                if (chunks.length > 0) {
                    // Re-index chunks to continue from where we left off
                    const indexedChunks: Chunk[] = chunks.map((chunk, i) => ({
                        ...chunk,
                        chunkIndex: this.chunkCounter + i,
                    }));
                    const chunkIds = this.vectorStore.saveChunks(indexedChunks);
                    this.chunkCounter += indexedChunks.length;
                    console.log(`[LiveRAGIndexer] Saved ${indexedChunks.length} chunks (${this.chunkCounter} total) for meeting ${meetingId}`);
                    for (let i = 0; i < chunkIds.length; i++) {
                        this.pendingEmbeds.push({ id: chunkIds[i], text: indexedChunks[i].text });
                    }
                }
                // Advance the high-water mark — to what this tick actually
                // processed (see the sliceStart note above), not to the live
                // length, so segments appended mid-tick are picked up next time.
                // The chunks are SAVED now; embedding them is the pending
                // queue's job, so a failed embedding no longer loses them.
                if (this.stillOwns(sessionToken)) this.indexedSegmentCount = processedUpTo;
            }

            // 5. Embed what is pending, in small batches.
            await this.embedPending(meetingId, sessionToken);

        } catch (err) {
            console.error('[LiveRAGIndexer] Processing error:', err);
        }
    }

    /**
     * Embed pending chunks, EMBED_BATCH_SIZE at a time. A batch that fails (or a
     * pipeline that is not ready) leaves its chunks queued for the next tick.
     * getEmbeddingsWithFallback() returns metadata from the SAME provider that
     * produced the vectors, so a primary→fallback promotion cannot leave early
     * chunks in the old space while the meeting is stamped with the new one.
     */
    private async embedPending(meetingId: string, sessionToken: number): Promise<void> {
        if (this.pendingEmbeds.length === 0) return;
        if (!this.embeddingPipeline.isReady()) {
            console.log(`[LiveRAGIndexer] Embedding pipeline not ready — ${this.pendingEmbeds.length} chunk(s) wait for the next tick`);
            return;
        }
        // Foreground gate (manual regression 2026-06-12): yield to any
        // in-flight manual/WTA answer before the synchronous DB writes below.
        const { ForegroundGate } = require('../services/ForegroundGate') as typeof import('../services/ForegroundGate');
        for (let n = 0; n < MAX_EMBED_BATCHES_PER_TICK && this.pendingEmbeds.length > 0; n++) {
            const batch = this.pendingEmbeds.slice(0, EMBED_BATCH_SIZE);
            let embeddedCount = 0;
            try {
                await ForegroundGate.waitUntilIdle();
                // E2E-only fault injection (NATIVELY_E2E=1, set by __e2e__:fail-live-embeds):
                // lets the live harness prove the retry path on real meeting traffic.
                if (process.env.NATIVELY_E2E === '1') {
                    const g = globalThis as unknown as { __nativelyE2eFailLiveEmbeds?: number };
                    if ((g.__nativelyE2eFailLiveEmbeds ?? 0) > 0) {
                        g.__nativelyE2eFailLiveEmbeds = (g.__nativelyE2eFailLiveEmbeds ?? 0) - 1;
                        throw new Error('E2E injected embedding failure');
                    }
                }
                const { embeddings, space, provider, dimensions } = await this.embeddingPipeline.getEmbeddingsWithFallback(
                    batch.map((c) => c.text)
                );
                // R-16b: the two awaits above park up to ~90s. If a newer session
                // claimed the indexer meanwhile, these chunk rows were already
                // purged by startLiveIndexing's F-411 delete, so storing them
                // writes vec0 rows resolving to nothing — and the stamps below
                // would describe THIS session's provider on the NEXT session's
                // meeting row (the live id is a constant, so it addresses both).
                if (!this.stillOwns(sessionToken)) {
                    console.warn(
                        `[LiveRAGIndexer] discarding a parked embedding batch for ${meetingId}: `
                        + 'a newer live session owns the indexer.'
                    );
                    return;
                }
                // R-21: settle the meeting's embedding space BEFORE storing this
                // batch. Re-stamping now discards the old space's vectors, so
                // doing it afterwards would wipe the batch we just wrote. The
                // chunks those vectors belonged to go back on the queue, so they
                // are searchable again in the new space.
                if (provider && space && dimensions
                    && this.vectorStore.restampMeetingSpaceOnChange?.(meetingId, provider, dimensions, space)) {
                    this.indexedChunkCount = 0;
                    this.pendingEmbeds.push(...this.embeddedChunks);
                    this.embeddedChunks = [];
                }
                for (let i = 0; i < batch.length && i < embeddings.length; i++) {
                    this.vectorStore.storeEmbedding(batch[i].id, embeddings[i]);
                    embeddedCount++;
                }
                if (embeddedCount > 0 && provider && space && dimensions) {
                    this.vectorStore.stampMeetingSpaceIfUnset(meetingId, provider, dimensions, space);
                }
                const done = batch.slice(0, embeddedCount);
                const doneIds = new Set(done.map((c) => c.id));
                this.pendingEmbeds = this.pendingEmbeds.filter((c) => !doneIds.has(c.id));
                this.embeddedChunks.push(...done);
                this.indexedChunkCount += embeddedCount;
                console.log(`[LiveRAGIndexer] Embedded ${embeddedCount}/${batch.length} chunks (${this.indexedChunkCount} total with embeddings, ${this.pendingEmbeds.length} pending)`);
                if (embeddedCount < batch.length) break;  // a short response: retry the rest next tick
            } catch (err) {
                console.warn(`[LiveRAGIndexer] Failed to embed live chunk batch for ${meetingId} — ${this.pendingEmbeds.length} chunk(s) stay queued for the next tick:`, err);
                break;
            }
        }
    }

    /**
     * Stop live indexing. Flushes any remaining segments.
     */
    async stop(): Promise<void> {
        if (!this.isActive) return;

        // R-03: start() calls stop() WITHOUT awaiting it, and stop() can now park
        // ~90s on an in-flight tick. Capture which session we are stopping so a
        // late resumption cannot flush into, or tear down, a meeting that started
        // in the meantime.
        const stopping = this.sessionToken;

        console.log(`[LiveRAGIndexer] Stopping for meeting ${this.meetingId}`);

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        // Final flush — process any remaining segments.
        // F-414: first WAIT for any tick already in flight, otherwise the
        // isProcessing guard turns this flush into a silent no-op and the
        // trailing transcript is dropped by the reset below. Then force the
        // flush past MIN_NEW_SEGMENTS so a 1-2 segment tail is still indexed.
        if (this.inFlightTick) {
            try { await this.inFlightTick; } catch { /* the tick logs its own errors */ }
        }
        if (this.sessionToken === stopping) {
            await this.tick(true);
        }

        if (this.sessionToken !== stopping) {
            console.warn(
                `[LiveRAGIndexer] stop(session ${stopping}) resumed after session ${this.sessionToken} had already started — `
                + 'skipping the reset so the new session is not torn down.'
            );
            return;
        }

        const meetingId = this.meetingId;
        this.isActive = false;
        this.meetingId = null;
        this.sessionToken = 0;
        this.allSegments = [];
        this.indexedSegmentCount = 0;
        this.chunkCounter = 0;
        this.indexedChunkCount = 0;
        this.pendingEmbeds = [];
        this.embeddedChunks = [];
        this.questionCarry = [];

        console.log(`[LiveRAGIndexer] Stopped for meeting ${meetingId}`);
    }

    /**
     * Check if there are any queryable JIT chunks for the current meeting.
     */
    hasIndexedChunks(): boolean {
        return this.indexedChunkCount > 0;
    }

    /**
     * Get the number of chunks with embeddings (queryable).
     */
    getIndexedChunkCount(): number {
        return this.indexedChunkCount;
    }

    /** Saved chunks still waiting for a vector (retried every tick). */
    getPendingEmbedCount(): number {
        return this.pendingEmbeds.length;
    }

    /** Chunks saved so far this session. */
    getSavedChunkCount(): number {
        return this.chunkCounter;
    }

    /**
     * Get the meeting ID currently being indexed.
     */
    getActiveMeetingId(): string | null {
        return this.meetingId;
    }

    /**
     * Check if actively indexing.
     */
    isRunning(): boolean {
        return this.isActive;
    }
}
