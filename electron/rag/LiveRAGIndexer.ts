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

export class LiveRAGIndexer {
    private vectorStore: VectorStore;
    private embeddingPipeline: EmbeddingPipeline;
    private meetingId: string | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private allSegments: RawSegment[] = [];
    private indexedSegmentCount = 0;  // High-water mark: segments already chunked
    private chunkCounter = 0;         // Running chunk index
    private indexedChunkCount = 0;    // Total chunks with embeddings
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
        this.allSegments = [];
        this.indexedSegmentCount = 0;
        this.chunkCounter = 0;
        this.indexedChunkCount = 0;
        this.isProcessing = false;
        this.isActive = true;

        console.log(`[LiveRAGIndexer] Started for meeting ${meetingId}`);

        this.timer = setInterval(() => {
            // Track the in-flight tick so stop() can await it before flushing.
            const running = this.tick();
            this.inFlightTick = running;
            void running.finally(() => {
                if (this.inFlightTick === running) this.inFlightTick = null;
            });
            running.catch(err => {
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
        if (!force && newSegmentCount < MIN_NEW_SEGMENTS) return;  // Not enough new content
        if (force && newSegmentCount <= 0) return;

        this.isProcessing = true;
        const meetingId = this.meetingId;

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

            // 2. Preprocess
            const cleaned = preprocessTranscript(newSegments);
            if (cleaned.length === 0) {
                this.indexedSegmentCount = processedUpTo;
                return;
            }

            // 3. Chunk with offset index
            const chunks = chunkTranscript(meetingId, cleaned);
            if (chunks.length === 0) {
                this.indexedSegmentCount = processedUpTo;
                return;
            }

            // Re-index chunks to continue from where we left off
            const indexedChunks: Chunk[] = chunks.map((chunk, i) => ({
                ...chunk,
                chunkIndex: this.chunkCounter + i,
            }));

            // 4. Save chunks to DB (without embeddings initially)
            const chunkIds = this.vectorStore.saveChunks(indexedChunks);
            this.chunkCounter += indexedChunks.length;

            console.log(`[LiveRAGIndexer] Saved ${indexedChunks.length} chunks (${this.chunkCounter} total) for meeting ${meetingId}`);

            // 5. Embed the new chunks as one coherent batch. getEmbeddingsWithFallback()
            // returns metadata from the SAME provider that produced the vectors, so a
            // primary→fallback promotion cannot leave early chunks in the old space while
            // the meeting is stamped with the new one.
            if (this.embeddingPipeline.isReady()) {
                // Foreground gate (manual regression 2026-06-12): yield to any
                // in-flight manual/WTA answer before the synchronous DB writes below.
                const { ForegroundGate } = require('../services/ForegroundGate') as typeof import('../services/ForegroundGate');
                let embeddedCount = 0;
                try {
                    await ForegroundGate.waitUntilIdle();
                    const { embeddings, space, provider, dimensions } = await this.embeddingPipeline.getEmbeddingsWithFallback(
                        indexedChunks.map((chunk) => chunk.text)
                    );
                    for (let i = 0; i < chunkIds.length && i < embeddings.length; i++) {
                        this.vectorStore.storeEmbedding(chunkIds[i], embeddings[i]);
                        embeddedCount++;
                    }
                    if (embeddedCount > 0 && provider && space && dimensions) {
                        this.vectorStore.stampMeetingSpaceIfUnset(meetingId, provider, dimensions, space);
                        // F-415: the comment above is true WITHIN a batch, but not
                        // ACROSS ticks. If a later tick falls back to a different
                        // provider, the meeting is already stamped and
                        // stampMeetingSpaceIfUnset is a no-op — so the row keeps
                        // claiming the old space while these chunks are in the new
                        // one, and the query-time space filter then excludes the
                        // meeting entirely (zero live results precisely when the
                        // cloud provider is down). Re-stamp on an actual change.
                        this.vectorStore.restampMeetingSpaceOnChange?.(meetingId, provider, dimensions, space);
                    }
                } catch (err) {
                    console.warn(`[LiveRAGIndexer] Failed to embed live chunk batch for ${meetingId}:`, err);
                }
                this.indexedChunkCount += embeddedCount;
                console.log(`[LiveRAGIndexer] Embedded ${embeddedCount}/${chunkIds.length} chunks (${this.indexedChunkCount} total with embeddings)`);
            } else {
                console.log('[LiveRAGIndexer] Embedding pipeline not ready, chunks saved without embeddings');
            }

            // 6. Advance high-water mark — to what this tick actually
            //    processed (see the sliceStart note above), not to the live
            //    length, so segments appended mid-tick are picked up next time.
            this.indexedSegmentCount = processedUpTo;

        } catch (err) {
            console.error('[LiveRAGIndexer] Processing error:', err);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Stop live indexing. Flushes any remaining segments.
     */
    async stop(): Promise<void> {
        if (!this.isActive) return;

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
        await this.tick(true);

        const meetingId = this.meetingId;
        this.isActive = false;
        this.meetingId = null;
        this.allSegments = [];
        this.indexedSegmentCount = 0;
        this.chunkCounter = 0;
        this.indexedChunkCount = 0;

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
