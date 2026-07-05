// electron/rag/RAGManager.ts
// Central orchestrator for RAG pipeline
// Coordinates preprocessing, chunking, embedding, and retrieval

import Database from 'better-sqlite3';
import { LLMHelper } from '../LLMHelper';
import { preprocessTranscript, RawSegment } from './TranscriptPreprocessor';
import { chunkTranscript } from './SemanticChunker';
import { VectorStore } from './VectorStore';
import { EmbeddingPipeline } from './EmbeddingPipeline';
import { RAGRetriever } from './RAGRetriever';
import { LiveRAGIndexer } from './LiveRAGIndexer';
import { buildRAGPrompt, NO_CONTEXT_FALLBACK, NO_GLOBAL_CONTEXT_FALLBACK } from './prompts';
import type { ProviderDataScopePolicy } from '../llm/ProviderRouter';

export interface RAGManagerConfig {
    db: Database.Database;
    dbPath: string;       // Passed to VectorStore so worker can open its own read-only connection
    extPath: string;      // Resolved sqlite-vec extension path (no platform suffix)
    openaiKey?: string;
    geminiKey?: string;
    geminiKeys?: string[];   // optional pool for embedding key-rotation + 429 cooldown
    ollamaUrl?: string;
    providerDataScopes?: ProviderDataScopePolicy;
}

/**
 * RAGManager - Central orchestrator for RAG operations
 * 
 * Lifecycle:
 * 1. Initialize with database and API key
 * 2. When meeting ends: processMeeting() -> chunks + queue embeddings
 * 3. When user queries: query() -> retrieve + stream response
 */
export class RAGManager {
    private db: Database.Database;
    private vectorStore: VectorStore;
    private embeddingPipeline: EmbeddingPipeline;
    private retriever: RAGRetriever;
    private llmHelper: LLMHelper | null = null;
    private liveIndexer: LiveRAGIndexer;
    /** Guards against concurrent reprocessMeeting() calls for the same meeting ID. */
    private _reprocessInFlight = new Set<string>();

    constructor(config: RAGManagerConfig) {
        this.db = config.db;
        this.vectorStore = new VectorStore(config.db, config.dbPath, config.extPath);
        this.embeddingPipeline = new EmbeddingPipeline(config.db, this.vectorStore);
        this.retriever = new RAGRetriever(this.vectorStore, this.embeddingPipeline);
        this.liveIndexer = new LiveRAGIndexer(this.vectorStore, this.embeddingPipeline);

        this.embeddingPipeline.initialize({
            openaiKey: config.openaiKey,
            geminiKey: config.geminiKey,
            geminiKeys: config.geminiKeys,
            ollamaUrl: config.ollamaUrl,
            providerDataScopes: config.providerDataScopes
        }).then(() => {
            // Backfill provider metadata for meetings that were embedded before the
            // embedding_provider column was written (or where the write failed silently).
            this._backfillEmbeddingProviderMetadata();
            // Auto-reindex meetings left in an incompatible embedding space (e.g. after
            // a Gemini embedding-model bump). No-op when everything already matches.
            this.scheduleAutoReindex();
        }).catch(() => { /* non-critical, suppress */ });
    }

    /**
     * Set LLM helper for generating responses
     */
    setLLMHelper(llmHelper: LLMHelper): void {
        this.llmHelper = llmHelper;
    }

    getEmbeddingPipeline(): EmbeddingPipeline {
        return this.embeddingPipeline;
    }

    initializeEmbeddings(keys: { openaiKey?: string, geminiKey?: string, geminiKeys?: string[], ollamaUrl?: string, providerDataScopes?: ProviderDataScopePolicy }): void {
        const initPromise = this.embeddingPipeline.initialize(keys);
        // After init, backfill embedding_provider on meetings that have embedded chunks
        // but a NULL metadata column (common for meetings embedded before this metadata
        // write was introduced, or where the write silently failed).
        if (initPromise && typeof initPromise.then === 'function') {
            initPromise.then(() => {
                this._backfillEmbeddingProviderMetadata();
                this.scheduleAutoReindex();
            }).catch(() => { /* silent — backfill is non-critical */ });
        } else {
            // Synchronous path (shouldn't happen but be safe)
            this._backfillEmbeddingProviderMetadata();
            this.scheduleAutoReindex();
        }
    }

    private _backfillEmbeddingProviderMetadata(): void {
        const providerName = this.embeddingPipeline.getActiveProviderName();
        const dimensions = this.embeddingPipeline.getActiveDimensions();
        if (providerName && dimensions) {
            // Stamps provider/dims only — NOT embedding_space. Space is owned by the
            // re-index sweep so a NULL-space legacy row can't be mislabeled as the
            // active space (which would skip re-index → silent garbage).
            this.vectorStore.backfillEmbeddingProviderMetadata(providerName, dimensions);
        }
    }

    /**
     * Check if RAG is ready for queries
     */
    isReady(): boolean {
        return this.embeddingPipeline.isReady() && this.llmHelper !== null;
    }

    /**
     * Process a meeting after it ends
     * Creates chunks and queues them for embedding
     */
    async processMeeting(
        meetingId: string,
        transcript: RawSegment[],
        summary?: string
    ): Promise<{ chunkCount: number }> {
        console.log(`[RAGManager] Processing meeting ${meetingId} with ${transcript.length} segments`);

        // 1. Preprocess transcript
        const cleaned = preprocessTranscript(transcript);
        console.log(`[RAGManager] Preprocessed to ${cleaned.length} cleaned segments`);

        // 2. Chunk the transcript
        const chunks = chunkTranscript(meetingId, cleaned);
        console.log(`[RAGManager] Created ${chunks.length} chunks`);

        if (chunks.length === 0) {
            console.log(`[RAGManager] No chunks to save for meeting ${meetingId}`);
            return { chunkCount: 0 };
        }

        // 3. Save chunks to database
        this.vectorStore.saveChunks(chunks);

        // 4. Save summary if provided
        if (summary) {
            this.vectorStore.saveSummary(meetingId, summary);
        }

        // 5. Queue for embedding (background processing)
        if (this.embeddingPipeline.isReady()) {
            await this.embeddingPipeline.queueMeeting(meetingId);
        } else {
            console.log(`[RAGManager] Embeddings not ready, chunks saved without embeddings`);
        }

        return { chunkCount: chunks.length };
    }

    /**
     * Query meeting with RAG
     * Returns streaming generator for response
     */
    async *queryMeeting(
        meetingId: string,
        query: string,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string, void, unknown> {
        if (!this.llmHelper) {
            throw new Error('LLM helper not initialized');
        }

        // Check if meeting has embeddings (post-meeting RAG)
        const hasEmbeddings = this.vectorStore.hasEmbeddings(meetingId);

        if (!hasEmbeddings) {
            // JIT RAG: Check if live indexer has chunks for this meeting
            const isLiveMeeting = this.liveIndexer.getActiveMeetingId() === meetingId;
            if (isLiveMeeting && this.liveIndexer.hasIndexedChunks()) {
                console.log(`[RAGManager] Using JIT RAG for live meeting ${meetingId} (${this.liveIndexer.getIndexedChunkCount()} chunks)`);
                // Fall through to retrieval — VectorStore already has the JIT chunks
            } else {
                // No embeddings at all — trigger wrapper fallback
                throw new Error('NO_MEETING_EMBEDDINGS');
            }
        }

        // Retrieve relevant context
        const context = await this.retriever.retrieve(query, { meetingId });

        if (context.chunks.length === 0) {
            // No context relevant to query - trigger wrapper fallback to use context window
            throw new Error('NO_RELEVANT_CONTEXT_FOUND');
        }

        // Build prompt with intent hint
        const prompt = buildRAGPrompt(query, context.formattedContext, 'meeting', context.intent);

        // Stream response
        const stream = this.llmHelper.streamChatWithGemini(prompt, undefined, undefined, true);

        for await (const chunk of stream) {
            if (abortSignal?.aborted) break;
            yield chunk;
        }
    }

    /**
     * Query across all meetings (global search)
     */
    async *queryGlobal(
        query: string,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string, void, unknown> {
        if (!this.llmHelper) {
            throw new Error('LLM helper not initialized');
        }

        // Retrieve from all meetings
        const context = await this.retriever.retrieveGlobal(query);

        if (context.chunks.length === 0) {
            yield NO_GLOBAL_CONTEXT_FALLBACK;
            return;
        }

        // Build prompt with intent hint
        const prompt = buildRAGPrompt(query, context.formattedContext, 'global', context.intent);

        // Stream response
        const stream = this.llmHelper.streamChatWithGemini(prompt, undefined, undefined, true);

        for await (const chunk of stream) {
            if (abortSignal?.aborted) break;
            yield chunk;
        }
    }

    /**
     * Smart query - auto-detects scope
     */
    async *query(
        query: string,
        currentMeetingId?: string,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string, void, unknown> {
        const scope = this.retriever.detectScope(query, currentMeetingId);

        if (scope === 'meeting' && currentMeetingId) {
            yield* this.queryMeeting(currentMeetingId, query, abortSignal);
        } else {
            yield* this.queryGlobal(query, abortSignal);
        }
    }

    /**
     * Get embedding queue status
     */
    getQueueStatus(): { pending: number; processing: number; completed: number; failed: number } {
        return this.embeddingPipeline.getQueueStatus();
    }

    /**
     * Retry pending embeddings
     */
    async retryPendingEmbeddings(): Promise<void> {
        await this.embeddingPipeline.processQueue();
    }

    /**
     * Check if a meeting has been processed for RAG
     */
    isMeetingProcessed(meetingId: string): boolean {
        return this.vectorStore.hasEmbeddings(meetingId);
    }

    // ─── JIT RAG: Live Meeting Indexing ──────────────────────────────

    /**
     * Start JIT indexing for a live meeting.
     * Call when a meeting session begins.
     */
    startLiveIndexing(meetingId: string): void {
        if (!this.embeddingPipeline.isReady()) {
            console.log('[RAGManager] Embedding pipeline not ready, skipping live indexing');
            return;
        }
        
        // Ensure meeting row exists in DB to satisfy foreign key constraints for chunks
        try {
            this.db.prepare(`
                INSERT OR IGNORE INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, source, is_processed)
                VALUES (?, 'Live Meeting', ?, 0, '{}', ?, 'manual', 0)
            `).run(meetingId, Date.now(), new Date().toISOString());
        } catch (e) {
            console.warn('[RAGManager] Failed to create transient meeting row for live indexing', e);
        }

        this.liveIndexer.start(meetingId);
    }

    /**
     * Feed new transcript segments to the live indexer.
     * Call whenever new transcript arrives during the meeting.
     */
    feedLiveTranscript(segments: RawSegment[]): void {
        this.liveIndexer.feedSegments(segments);
    }

    /**
     * Stop JIT indexing (flushes remaining segments).
     * Call when the meeting session ends.
     * NOTE: The post-meeting processMeeting() will later replace JIT chunks
     * with the complete, properly indexed version.
     */
    async stopLiveIndexing(): Promise<void> {
        await this.liveIndexer.stop();
    }

    /**
     * Check if JIT indexing is active for a meeting.
     */
    isLiveIndexingActive(meetingId?: string): boolean {
        if (meetingId) {
            return this.liveIndexer.getActiveMeetingId() === meetingId;
        }
        return this.liveIndexer.isRunning();
    }

    /**
     * Check if JIT indexing has produced at least one queryable (embedded) chunk.
     * Prevents wasted queryMeeting() calls that immediately throw NO_MEETING_EMBEDDINGS.
     */
    hasLiveChunks(): boolean {
        return this.liveIndexer.hasIndexedChunks();
    }

    /**
     * Delete RAG data for a meeting
     */
    deleteMeetingData(meetingId: string): void {
        // 1. Delete from vector store (chunks and summaries)
        this.vectorStore.deleteChunksForMeeting(meetingId);
        
        // 2. Clear embedding queue for this meeting to prevent "Chunk not found" errors on re-processing
        try {
            const info = this.db.prepare('DELETE FROM embedding_queue WHERE meeting_id = ?').run(meetingId);
            if (info.changes > 0) {
                console.log(`[RAGManager] Cleared ${info.changes} items from embedding_queue for meeting ${meetingId}`);
            }
        } catch (e) {
            console.warn(`[RAGManager] Failed to clear embedding_queue for meeting ${meetingId}`, e);
        }
        
        // 3. Clean up transient meeting row if it was a live session
        try {
            if (meetingId === 'live-meeting-current') {
                this.db.prepare('DELETE FROM meetings WHERE id = ?').run(meetingId);
            }
        } catch (e) {
            console.warn('[RAGManager] Failed to delete transient meeting row', e);
        }
    }

    /**
     * Manually trigger processing for a meeting
     * Useful for demo meetings or reprocessing failed ones
     */
    async reprocessMeeting(meetingId: string): Promise<void> {
        // Guard: if this meeting is already being reprocessed, skip to prevent
        // concurrent runs from clearing each other's queue work.
        if (this._reprocessInFlight.has(meetingId)) {
            console.log(`[RAGManager] Reprocessing already in-flight for ${meetingId}, skipping duplicate call`);
            return;
        }
        this._reprocessInFlight.add(meetingId);

        console.log(`[RAGManager] Reprocessing meeting ${meetingId}`);

        try {
            // delete existing RAG data first to avoid duplicates
            this.deleteMeetingData(meetingId);

            // Fetch meeting details from DB
            const { DatabaseManager } = require('../db/DatabaseManager');
            const meeting = DatabaseManager.getInstance().getMeetingDetails(meetingId);

            if (!meeting) {
                console.error(`[RAGManager] Meeting ${meetingId} not found for reprocessing`);
                return;
            }

            if (!meeting.transcript || meeting.transcript.length === 0) {
                console.log(`[RAGManager] Meeting ${meetingId} has no transcript, skipping`);
                return;
            }

            // Convert to RawSegment format
            const segments = meeting.transcript.map((t: any) => ({
                speaker: t.speaker,
                text: t.text,
                timestamp: t.timestamp
            }));

            // Get summary if available
            let summary: string | undefined;
            if (meeting.detailedSummary) {
                summary = [
                    ...(meeting.detailedSummary.overview ? [meeting.detailedSummary.overview] : []),
                    ...(meeting.detailedSummary.keyPoints || []),
                    ...(meeting.detailedSummary.actionItems || []).map((a: any) => `Action: ${a}`)
                ].join('. ');
            } else if (meeting.summary) {
                summary = meeting.summary;
            }

            await this.processMeeting(meetingId, segments, summary);
        } finally {
            this._reprocessInFlight.delete(meetingId);
        }
    }

    /**
     * Ensure demo meeting is processed
     * Checks if demo meeting exists but has no chunks, then processes it
     */
    async ensureDemoMeetingProcessed(): Promise<void> {
        const demoId = 'demo-meeting'; // Corrected ID to match DatabaseManager

        // Check if demo meeting exists in DB
        const { DatabaseManager } = require('../db/DatabaseManager');
        const meeting = DatabaseManager.getInstance().getMeetingDetails(demoId);

        if (!meeting) {
            // console.log('[RAGManager] Demo meeting not found in DB, skipping RAG processing');
            return;
        }

        // Check if already processed (has embeddings)
        if (this.isMeetingProcessed(demoId)) {
            // console.log('[RAGManager] Demo meeting already processed');
            return;
        }

        // Guard: also check the in-flight set — reprocessMeeting() itself is guarded,
        // but checking here avoids even printing the "Processing now..." log redundantly.
        if (this._reprocessInFlight.has(demoId)) {
            console.log(`[RAGManager] Demo meeting reprocessing already in-flight, skipping`);
            return;
        }

        console.log('[RAGManager] Demo meeting found but not processed. Processing now...');
        await this.reprocessMeeting(demoId);
    }

    /**
     * Cleanup stale queue items for meetings that no longer exist
     */
    public cleanupStaleQueueItems(): void {
        try {
            const info = this.db.prepare(`
                DELETE FROM embedding_queue 
                WHERE meeting_id NOT IN (SELECT id FROM meetings)
            `).run();
            if (info.changes > 0) {
                console.log(`[RAGManager] Cleaned up ${info.changes} stale queue items`);
            }
        } catch (error) {
            console.error('[RAGManager] Failed to cleanup stale queue items:', error);
        }
    }

    /**
     * Manual re-index entry point (settings button / IPC). Delegates to the same
     * guarded routine as the automatic path so the two can't run concurrently and
     * double-clear/double-queue.
     */
    async reindexIncompatibleMeetings(): Promise<void> {
        await this._runReindex();
    }

    /**
     * Automatically re-index meetings whose embedding space differs from the
     * active one (e.g. after the gemini-embedding-001 → gemini-embedding-2 bump).
     *
     * Design:
     *  - Triggered off the incompatible COUNT (not lastSpace != activeSpace) so a
     *    crash mid-reindex resumes next launch.
     *  - Each meeting is cleared AND queued in ONE transaction (requeueMeetingForReindex)
     *    so a crash can never orphan a meeting (cleared vectors but no queue rows).
     *    The durable embedding_queue + the pipeline's startup queue-flush is the
     *    resume mechanism.
     *  - Deferred ~15s so it doesn't compete with cold-start UI/STT.
     *  - Paused while a live meeting indexes (live > backfill), but the pause is
     *    CAPPED so a back-to-back-meetings session can't strand the in-flight flag
     *    or leave the progress toast spinning forever; it bails and retries next launch.
     *  - Idempotent: a second call (auto or manual) while one is in flight is a no-op.
     *  - Search during re-index is empty-not-wrong: a cleared, not-yet-re-embedded
     *    meeting has NULL space and is excluded by the space-filtered search.
     */
    private _reindexInFlight = false;
    private _autoReindexTimer: ReturnType<typeof setTimeout> | null = null;
    private static readonly AUTO_REINDEX_DEFER_MS = 15_000;
    private static readonly REINDEX_LIVE_RECHECK_MS = 30_000;
    private static readonly REINDEX_MAX_LIVE_WAITS = 20; // ~10 min cap, then bail + retry next launch
    private static readonly REINDEX_DRAIN_POLL_MS = 2_000;
    private static readonly REINDEX_MAX_DRAIN_POLLS = 900; // ~30 min cap on progress polling

    scheduleAutoReindex(): void {
        const activeSpace = this.embeddingPipeline.getActiveSpaceKey();
        if (!activeSpace) return;
        if (this.vectorStore.getIncompatibleSpaceCount(activeSpace) === 0) return;
        // Defer the kickoff so launch isn't slowed; _runReindex owns the in-flight guard.
        // Track the timer so a re-init (settings change) doesn't stack duplicate timers
        // and so it can be cancelled on teardown.
        if (this._autoReindexTimer) clearTimeout(this._autoReindexTimer);
        this._autoReindexTimer = setTimeout(() => {
            this._autoReindexTimer = null;
            this._runReindex().catch(err => {
                console.error('[RAGManager] Auto-reindex failed (will retry next launch):', err);
            });
        }, RAGManager.AUTO_REINDEX_DEFER_MS);
    }

    /** Cancel any pending deferred auto-reindex (call on teardown/quit). */
    cancelPendingReindex(): void {
        if (this._autoReindexTimer) {
            clearTimeout(this._autoReindexTimer);
            this._autoReindexTimer = null;
        }
    }

    /**
     * Teardown hook for app shutdown: cancels the deferred auto-reindex timer (which
     * could otherwise fire up to ~15s — or the ~30min drain poll — after quit) and
     * terminates the VectorStore worker thread. Call from the before-quit handler.
     */
    async dispose(): Promise<void> {
        this.cancelPendingReindex();
        try { await this.vectorStore.destroy(); } catch (e) {
            console.warn('[RAGManager] dispose: vectorStore.destroy failed (non-fatal):', e);
        }
    }

    /** Shared guarded re-index routine for both the auto and manual paths. */
    private async _runReindex(): Promise<void> {
        if (this._reindexInFlight) {
            console.log('[RAGManager] Re-index already in flight — skipping duplicate trigger.');
            return;
        }
        const activeSpace = this.embeddingPipeline.getActiveSpaceKey();
        if (!activeSpace) {
            console.error('[RAGManager] Cannot re-index: no active embedding provider.');
            return;
        }
        const count = this.vectorStore.getIncompatibleSpaceCount(activeSpace);
        if (count === 0) {
            console.log('[RAGManager] No incompatible meetings to re-index.');
            return;
        }

        this._reindexInFlight = true;
        this._emitReindex('embedding:reindex-started', { count, space: activeSpace });
        console.log(`[RAGManager] Re-indexing ${count} meeting(s) into space ${activeSpace}...`);

        try {
            // ── Phase 1: requeue ── snapshot the worklist; clear+queue each meeting atomically.
            const meetingIds = this.vectorStore.getMeetingIdsNeedingReindex(activeSpace);
            const total = meetingIds.length;

            for (const meetingId of meetingIds) {
                // Pause (capped) if a live meeting is indexing — live work has priority.
                let waits = 0;
                while (this.liveIndexer.isRunning()) {
                    if (waits >= RAGManager.REINDEX_MAX_LIVE_WAITS) {
                        console.warn(`[RAGManager] Re-index pausing exceeded cap (${RAGManager.REINDEX_MAX_LIVE_WAITS} waits) due to continuous live meetings. Bailing; will resume next launch.`);
                        // Bail cleanly so the toast resolves; the count-based trigger
                        // re-fires next launch for whatever remains.
                        this._emitReindex('embedding:reindex-complete', { total, space: activeSpace, partial: true });
                        return;
                    }
                    waits++;
                    await new Promise(r => setTimeout(r, RAGManager.REINDEX_LIVE_RECHECK_MS));
                }
                // Atomic clear + enqueue (crash-safe — see requeueMeetingForReindex).
                await this.embeddingPipeline.requeueMeetingForReindex(meetingId);
            }

            console.log(`[RAGManager] Re-index: requeued ${total} meeting(s). Awaiting background embedding...`);

            // ── Phase 2: await actual embedding ── the requeue above only QUEUED the work;
            // the meetings have NULL embeddings (excluded from search) until the background
            // processQueue drains. Report TRUE progress off the queue depth so the UI doesn't
            // claim "complete" while past meetings are still unsearchable.
            const initialPending = this.embeddingPipeline.getQueueStatus().pending;
            let polls = 0;
            while (polls < RAGManager.REINDEX_MAX_DRAIN_POLLS) {
                const { pending } = this.embeddingPipeline.getQueueStatus();
                const doneItems = Math.max(0, initialPending - pending);
                this._emitReindex('embedding:reindex-progress', { done: doneItems, total: initialPending, space: activeSpace });
                if (pending === 0) break;
                polls++;
                await new Promise(r => setTimeout(r, RAGManager.REINDEX_DRAIN_POLL_MS));
            }

            const stillPending = this.embeddingPipeline.getQueueStatus().pending;
            // Complete = queue fully drained. If we hit the poll cap with work left
            // (very large corpus / slow API), report partial — it keeps draining in the
            // background and the count-based trigger re-verifies next launch.
            this._emitReindex('embedding:reindex-complete', {
                total,
                space: activeSpace,
                partial: stillPending > 0,
            });
            console.log(`[RAGManager] Re-index ${stillPending > 0 ? 'partially ' : ''}complete (${stillPending} queue item(s) still pending).`);
        } finally {
            this._reindexInFlight = false;
        }
    }

    private _emitReindex(channel: string, payload: Record<string, unknown>): void {
        try {
            const { BrowserWindow } = require('electron');
            BrowserWindow.getAllWindows().forEach((win: any) => {
                if (!win.isDestroyed()) win.webContents.send(channel, payload);
            });
        } catch (_) { /* non-fatal — renderer may not be up yet */ }
    }
}
