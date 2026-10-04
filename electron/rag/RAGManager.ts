// electron/rag/RAGManager.ts
// Central orchestrator for RAG pipeline
// Coordinates preprocessing, chunking, embedding, and retrieval

import Database from 'better-sqlite3';
import { LLMHelper } from '../LLMHelper';
import { preprocessTranscript, RawSegment } from './TranscriptPreprocessor';
import { chunkTranscript } from './SemanticChunker';
import { VectorStore } from './VectorStore';
import type { AppAPIConfig } from './EmbeddingProviderResolver';
import { EmbeddingPipeline } from './EmbeddingPipeline';
import { RAGRetriever } from './RAGRetriever';
import { LiveRAGIndexer } from './LiveRAGIndexer';
import { buildRAGPrompt, NO_CONTEXT_FALLBACK, NO_GLOBAL_CONTEXT_FALLBACK } from './prompts';
import type { ProviderDataScopePolicy } from '../llm/ProviderRouter';
import { isSpokenSavedLine } from '../intelligence/savedTranscriptOrigin';
import { buildSummaryTextForSearch } from './summaryTextForSearch';

/**
 * A bare `for await` over an LLM stream blocks forever if the provider hangs
 * mid-stream (no token, no error, no close) — this is the exact mechanism
 * behind the previously-fixed 134s manual-chat hang (see electron/llm/
 * liveDeadlines.ts). That fix (raceStreamWithDeadline) was wired into manual
 * chat and WhatToAnswer but never into RAGManager's queryMeeting/queryGlobal,
 * so the meeting-search and global-search chat surfaces were still exposed to
 * an unbounded hang. This mirrors the same Promise.race-per-next() mechanism,
 * reshaped to fit an `async *` generator (yield per token) instead of the
 * callback-based onToken() the shared helper uses.
 */
const RAG_STREAM_STALL_MS = 15_000;

/**
 * Appended to a queryMeeting/queryGlobal stream when it ends early (capped or
 * post-commit-failed) so the truncation is VISIBLE in the rendered/persisted
 * answer (see the two yield sites below). Exported (issue #552) so callers
 * that need to detect a truncated live-RAG answer — e.g. ipcHandlers'
 * recordLiveRagTurn, deciding whether to record the answer-side history
 * sinks — compare against this constant instead of re-typing the string,
 * which would silently drift from the yielded text.
 */
export const RAG_STREAM_INCOMPLETE_CODA = '\n\n_(Answer incomplete — the model stream ended early.)_';

async function* raceGeneratorWithDeadline(
    stream: AsyncGenerator<string, void, unknown>,
    stallMs: number,
): AsyncGenerator<string, void, unknown> {
    const DEADLINE = Symbol('rag-stream-deadline');
    try {
        while (true) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const deadline = new Promise<typeof DEADLINE>((resolve) => {
                timer = setTimeout(() => resolve(DEADLINE), stallMs);
            });
            const nextP = stream.next();
            // Defuse: if the deadline wins, nextP is still pending and unobserved —
            // when the hung provider's request later settles it must not surface as
            // an unhandledRejection (fatal in Electron main).
            nextP.catch(() => { /* loser of the race — defused */ });
            const res = await Promise.race([nextP, deadline]);
            if (timer) clearTimeout(timer);
            if (res === DEADLINE) {
                console.warn(`[RAGManager] Stream stalled for ${stallMs}ms — aborting.`);
                try { const p = stream.return?.(undefined); if (p && typeof (p as any).then === 'function') (p as Promise<unknown>).catch(() => {}); } catch { /* already closed */ }
                return;
            }
            if (res.done) return;
            // TS cannot discriminate the IteratorResult union through the
            // Promise.race with the DEADLINE symbol, so `res.value` widens to
            // `string | void` despite the `done` check above. The check makes
            // the cast sound: a non-done result's value is the yielded string.
            yield res.value as string;
        }
    } catch (e) {
        try { const p = stream.return?.(undefined); if (p && typeof (p as any).then === 'function') (p as Promise<unknown>).catch(() => {}); } catch { /* already closed */ }
        throw e;
    }
}

export interface RAGManagerConfig extends Partial<AppAPIConfig> {
    db: Database.Database;
    // dbPath/extPath are unused by VectorStore now (it runs on `db` directly —
    // see VectorStore.ts's header comment for why the worker-thread design
    // that needed these was removed) but kept required here so every existing
    // call site doesn't need to change, and so a future re-introduction of an
    // out-of-process search path doesn't have to re-thread them.
    dbPath: string;
    extPath: string;
    /**
     * The embedding configuration, forwarded WHOLE (2026-08-30).
     *
     * This used to re-declare six fields by hand — openaiKey, geminiKey,
     * geminiKeys, ollamaUrl, providerDataScopes, explicitKeyManagement — and the
     * constructor re-listed the same six into `embeddingPipeline.initialize()`.
     * `buildEmbeddingConfig()` returns an `AppAPIConfig` with far more than
     * that (nativelyApiKey, nativelyTrialToken, nativelyApiUrl,
     * ollamaEmbeddingModel/Dims, the per-provider model+dims hints, and the
     * embeddingMode/embeddingProvider choice), and `main.ts` spreads it straight
     * in — so every field outside the hand-written six was SILENTLY DROPPED on a
     * normal app start.
     *
     * TypeScript could not catch it: spreading a typed variable into an object
     * literal skips excess-property checking, so `typecheck:electron` stayed
     * green while the managed-embedding tier and the user's chosen Ollama
     * embedding model were never configured at all. The feature only appeared
     * if the user later re-entered an OpenAI/Gemini key, because
     * `initializeEmbeddings` forwards with `{...keys}` and therefore carried
     * everything by accident.
     *
     * Carrying the type instead of a copy of its field names is what stops this
     * recurring — the same lesson `embeddingConfigIdentity.ts` was written for,
     * one layer down.
     */
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
    /**
     * Guards against concurrent reprocessMeeting()/reindex calls for the same
     * target. Process-wide on globalThis, not per-instance: RAGManager is
     * constructor-owned (not a getInstance singleton), so a harness that
     * constructs two instances over ONE natively.db — or co-loads two esbuild
     * bundles — would otherwise run duplicate embedding jobs for the same
     * documents (duplicate spend; duplicate vectors if inserts aren't
     * idempotent). Same bug class as the 2026-07-31 singleton sweep, LOW
     * severity because the DB itself is shared truth.
     */
    private get _jobGuards(): { reprocess: Set<string>; reindexing: boolean } {
        const g = globalThis as unknown as Record<string, { reprocess: Set<string>; reindexing: boolean } | undefined>;
        if (!g.__nativelyRagJobGuardsV1__) g.__nativelyRagJobGuardsV1__ = { reprocess: new Set(), reindexing: false };
        return g.__nativelyRagJobGuardsV1__;
    }
    private get _reprocessInFlight(): Set<string> { return this._jobGuards.reprocess; }

    constructor(config: RAGManagerConfig) {
        this.db = config.db;
        this.vectorStore = new VectorStore(config.db, config.dbPath, config.extPath);
        this.embeddingPipeline = new EmbeddingPipeline(config.db, this.vectorStore);
        this.retriever = new RAGRetriever(this.vectorStore, this.embeddingPipeline);
        this.liveIndexer = new LiveRAGIndexer(this.vectorStore, this.embeddingPipeline);
        // The pipeline signals when the user's pinned embedding space is active
        // again; the sweep deferred while a stand-in was running belongs here.
        this.embeddingPipeline.setPinnedSpaceRestoredHandler(() => this.scheduleAutoReindex());

        // Forward the WHOLE embedding config. Hand-listing fields here is what
        // dropped nativelyApiKey / nativelyTrialToken / nativelyApiUrl /
        // ollamaEmbeddingModel / ollamaEmbeddingDims and the embeddingMode +
        // embeddingProvider choice on every normal app start — see
        // RAGManagerConfig's note. `db`/`dbPath`/`extPath` are this class's own
        // and are the only fields the pipeline must not see.
        const { db: _db, dbPath: _dbPath, extPath: _extPath, ...embeddingConfig } = config;
        this.embeddingPipeline.initialize(embeddingConfig).then(() => {
            // Backfill provider metadata for meetings that were embedded before the
            // embedding_provider column was written (or where the write failed silently).
            this._backfillEmbeddingProviderMetadata();
            // Auto-reindex meetings left in an incompatible embedding space (e.g. after
            // a Gemini embedding-model bump). No-op when everything already matches.
            this.scheduleAutoReindex();
            // Past meetings whose transcript chunks were lost (see backfillMeetingChunks).
            this.scheduleChunkBackfill();
        }).catch(() => { /* non-critical, suppress */ });
    }

    /**
     * Set LLM helper for generating responses
     */
    setLLMHelper(llmHelper: LLMHelper): void {
        this.llmHelper = llmHelper;
    }

    /**
     * The retriever, for callers that need typed chunks rather than a formatted
     * blob — specifically the Context Intelligence V3 meeting retrieval port,
     * which builds its own evidence with per-meeting scope.
     *
     * Read-only accessor: retrieval itself stays owned by RAGRetriever, so this
     * does not become a second query path with its own ranking rules.
     */
    getRetriever(): RAGRetriever {
        return this.retriever;
    }

    getEmbeddingPipeline(): EmbeddingPipeline {
        return this.embeddingPipeline;
    }

    // `AppAPIConfig`, not a hand-written subset. This path already FORWARDED
    // everything at runtime via `{...keys}` — which is precisely why the managed
    // tier worked here and not in the constructor — but its type named only six
    // fields, so it read as though the rest were unsupported.
    // Returns the pipeline's init promise. It used to return void, so
    // `await ragManager.initializeEmbeddings(...)` resolved on the next
    // microtask — long before the provider was re-resolved — and every caller
    // that then read getActiveSpaceKey() saw the OLD space. That made
    // set-config's `reindexRequired` permanently false, so a genuine model
    // switch re-indexed the whole corpus with no warning.
    initializeEmbeddings(keys: AppAPIConfig): Promise<void> {
        const initPromise = this.embeddingPipeline.initialize({
            ...keys,
            explicitKeyManagement: keys.explicitKeyManagement,
        });
        // After init, backfill embedding_provider on meetings that have embedded chunks
        // but a NULL metadata column (common for meetings embedded before this metadata
        // write was introduced, or where the write silently failed).
        if (initPromise && typeof initPromise.then === 'function') {
            // RETURNED, not just chained: a caller that awaits this needs the
            // provider actually re-resolved before it reads getActiveSpaceKey().
            // The backfill and re-index scheduling stay attached here so the
            // fire-and-forget callers keep their existing behaviour.
            return initPromise.then(() => {
                this._backfillEmbeddingProviderMetadata();
                this.scheduleAutoReindex();
                this.scheduleChunkBackfill();
            }).catch(() => { /* silent — backfill is non-critical */ });
        }
        // Synchronous path (shouldn't happen but be safe)
        this._backfillEmbeddingProviderMetadata();
        this.scheduleAutoReindex();
        this.scheduleChunkBackfill();
        return Promise.resolve();
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
        summary?: string,
        opts?: { providerLoad?: 'background' | 'await' | 'never' }
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

        // 3. Save chunks to database — replacing any this meeting already has.
        // saveChunks only inserts, and until 2026-10-04 a second indexing of a
        // meeting never met the first one's rows: the final save deleted them
        // by cascade. They persist now, so indexing a meeting twice (recovery,
        // reprocess) would otherwise store every chunk twice. The chunk queue
        // rows go too — they point at the ids being removed.
        if (this.db.prepare('SELECT 1 FROM chunks WHERE meeting_id = ? LIMIT 1').get(meetingId)) {
            this.vectorStore.deleteChunksForMeeting(meetingId);
        }
        // Cleared even when no chunk row is left: a meeting whose chunks were
        // deleted by the old cascading re-save still has their queue rows.
        try {
            this.db.prepare('DELETE FROM embedding_queue WHERE meeting_id = ? AND chunk_id IS NOT NULL').run(meetingId);
        } catch (e: any) {
            console.warn(`[RAGManager] Could not clear old queue rows for ${meetingId}:`, e?.message || e);
        }
        this.vectorStore.saveChunks(chunks);

        // 4. Save summary if provided
        if (summary) {
            this.vectorStore.saveSummary(meetingId, summary);
        }

        // 5. Queue for embedding (background processing). The bundled local
        // model is registered lazily and reports not-ready until its first
        // embed, and nothing on this path would ever perform one — so a
        // meeting indexed on the local model alone was saved unembedded and
        // never queued. ensureProviderLoaded() is the pipeline's API for an
        // indexing caller; a hosted provider is always ready and never gets here.
        //   'background' (default): return now, queue once the model is up.
        //       Meeting end awaits this method inside its teardown, which
        //       holds the trailing-transcript window open until it returns.
        //   'await': the past-meeting re-index, which wants the outcome.
        //   'never': the demo-meeting check at cold start, where loading a
        //       model would compete with the launch.
        const providerLoad = opts?.providerLoad ?? 'background';
        if (this.embeddingPipeline.isReady() || (providerLoad === 'await' && await this.embeddingPipeline.ensureProviderLoaded())) {
            await this.embeddingPipeline.queueMeeting(meetingId);
        } else if (providerLoad === 'background' && this.embeddingPipeline.getActiveSpaceKey()) {
            console.log(`[RAGManager] Embedding model not loaded yet; ${meetingId} is queued once it is`);
            void this.embeddingPipeline.ensureProviderLoaded()
                .then(loaded => (loaded && this.isDatabaseUsable() ? this.embeddingPipeline.queueMeeting(meetingId) : undefined))
                .catch((e: any) => console.warn(`[RAGManager] Could not queue ${meetingId} after the model load:`, e?.message || e));
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
        const streamOutcome: { incomplete?: boolean } = {};
        const stream = this.llmHelper.streamChatWithGemini(prompt, undefined, undefined, true, undefined, streamOutcome);

        for await (const chunk of raceGeneratorWithDeadline(stream, RAG_STREAM_STALL_MS)) {
            if (abortSignal?.aborted) break;
            yield chunk;
        }
        // F7 (code-review 2026-08-14): surface an incomplete stream to the
        // reader. Without this, a capped or post-commit-failed stream ended
        // normally, ipcHandlers sent rag:stream-complete, and the renderer
        // finalized a mid-sentence bubble as a complete answer that then
        // entered conversation state. The coda makes the truncation VISIBLE
        // in the rendered/persisted answer (skipped on user abort — that is
        // a cancellation, not a truncation).
        if (streamOutcome.incomplete && !abortSignal?.aborted) {
            yield RAG_STREAM_INCOMPLETE_CODA;
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

        // ALWAYS ANSWER (2026-09-07, owner's direction): an empty global search
        // used to yield NO_GLOBAL_CONTEXT_FALLBACK with no model call — the
        // launcher's chat ended in "I couldn't find any discussion about that".
        // The model now gets an explicit "nothing matched" excerpt and the
        // prompt's rule to note the gap and still answer from general knowledge.
        const formatted = context.chunks.length === 0
            ? `(No matching excerpts were found across the user's meetings for this question.)\n${NO_GLOBAL_CONTEXT_FALLBACK}`
            : context.formattedContext;

        // Build prompt with intent hint
        const prompt = buildRAGPrompt(query, formatted, 'global', context.intent);

        // Stream response
        const streamOutcome: { incomplete?: boolean } = {};
        const stream = this.llmHelper.streamChatWithGemini(prompt, undefined, undefined, true, undefined, streamOutcome);

        for await (const chunk of raceGeneratorWithDeadline(stream, RAG_STREAM_STALL_MS)) {
            if (abortSignal?.aborted) break;
            yield chunk;
        }
        // F7 (code-review 2026-08-14): surface an incomplete stream to the
        // reader. Without this, a capped or post-commit-failed stream ended
        // normally, ipcHandlers sent rag:stream-complete, and the renderer
        // finalized a mid-sentence bubble as a complete answer that then
        // entered conversation state. The coda makes the truncation VISIBLE
        // in the rendered/persisted answer (skipped on user abort — that is
        // a cancellation, not a truncation).
        if (streamOutcome.incomplete && !abortSignal?.aborted) {
            yield RAG_STREAM_INCOMPLETE_CODA;
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
        
        // F-411: purge anything still sitting under this id BEFORE indexing the
        // new session. The live id is a CONSTANT ('live-meeting-current'), and
        // the only cleanup is at meeting end — guarded by !isMeetingActive, and
        // deliberately skipped when a new meeting has already started. So after
        // a crash, a force-quit, or a start that overlaps the previous drain,
        // the previous meeting's transcript chunks survive under the same id;
        // the live "ask about this meeting" surface filters only on meeting_id,
        // so meeting A's transcript was served as evidence for meeting B.
        // There is no startup sweep anywhere, and `chunks` has no
        // UNIQUE(meeting_id, chunk_index) to stop the rows interleaving.
        // Purging here is the one place that runs on EVERY path into a new
        // live session, and it is safe: these JIT rows are always disposable
        // (post-meeting RAG re-indexes under the real meeting id).
        try {
            this.deleteMeetingData(meetingId);
        } catch (e) {
            console.warn('[RAGManager] Failed to purge stale live-indexing data before start:', e);
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
     * The live index id when JIT chunks are QUERYABLE, else null (issue #552).
     *
     * "Running" and "has chunks" are two different questions, and every
     * caller that wants meeting evidence needs both answered together:
     * a meeting port scoped to an id with zero embedded chunks retrieves
     * nothing, and one scoped to the meeting-metadata id retrieves nothing
     * either — JIT rows are stored under the id passed to startLiveIndexing
     * (a constant in main.ts), not under any id the meeting itself carries.
     * This is the single source of that id for the V3 surfaces and the
     * rag:query-live gate.
     */
    /** Live index counters, for diagnostics and the meeting-memory harness. */
    getLiveIndexStats(): { running: boolean; saved: number; embedded: number; pending: number } {
        return {
            running: this.liveIndexer.isRunning(),
            saved: this.liveIndexer.getSavedChunkCount(),
            embedded: this.liveIndexer.getIndexedChunkCount(),
            pending: this.liveIndexer.getPendingEmbedCount(),
        };
    }

    getLiveMeetingId(): string | null {
        if (!this.liveIndexer.isRunning() || !this.liveIndexer.hasIndexedChunks()) return null;
        return this.liveIndexer.getActiveMeetingId();
    }

    /**
     * Whether this instance's connection can still serve statements. Mirrors
     * VectorStore.isDatabaseUsable() — see that method for the full rationale.
     */
    private isDatabaseUsable(): boolean {
        try {
            return (this.db as any)?.open === true;
        } catch {
            return false;
        }
    }

    /**
     * Delete RAG data for a meeting
     */
    deleteMeetingData(meetingId: string): void {
        // Shutdown guard: RAGManager holds a RAW better-sqlite3 handle
        // (`this.db = config.db`), so after the fatal path's
        // closeWithoutCheckpoint() this reference is a closed connection and
        // every prepare() below would throw out of the driver. This method is
        // called from the background meeting-teardown block, where a throw is
        // caught but aborts the remaining teardown steps. Return one controlled,
        // logged result instead of three separate driver failures.
        //
        // Defense in depth for the shutdown window only — nothing here reopens
        // the database.
        if (!this.isDatabaseUsable()) {
            console.warn(
                `[RAGManager] deleteMeetingData(${meetingId}): database is closed — skipping RAG cleanup. ` +
                'Expected during fatal shutdown.'
            );
            return;
        }

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
    async reprocessMeeting(meetingId: string, opts?: { providerLoad?: 'background' | 'await' | 'never' }): Promise<void> {
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

            // Convert to RawSegment format — speech only, the same rule
            // meeting-end indexing applies (see isSpokenSavedLine).
            const segments = meeting.transcript.filter(isSpokenSavedLine).map((t: any) => ({
                speaker: t.speaker,
                text: t.text,
                timestamp: t.timestamp
            }));
            if (segments.length === 0) {
                console.log(`[RAGManager] Meeting ${meetingId} has no spoken lines, skipping`);
                return;
            }

            // Get summary if available (one builder — see summaryTextForSearch.ts)
            const summary = buildSummaryTextForSearch(meeting.detailedSummary, meeting.summary) || undefined;

            await this.processMeeting(meetingId, segments, summary, opts);
        } finally {
            this._reprocessInFlight.delete(meetingId);
        }
    }

    /**
     * Save a meeting's notes as its searchable summary and queue the embedding.
     * Called once the notes exist: after the final save, after a regenerate,
     * and by the launch backfill. Returns true when a summary was (re)queued.
     *
     * A session with no spoken line is not meeting content (typed chat and the
     * assistant's answers), so it gets no summary in search — the same rule
     * that keeps its transcript out of the index.
     */
    async indexMeetingSummary(meetingId: string): Promise<boolean> {
        const { DatabaseManager } = require('../db/DatabaseManager');
        const meeting = DatabaseManager.getInstance().getMeetingDetails(meetingId);
        if (!meeting) return false;
        if (!Array.isArray(meeting.transcript) || !meeting.transcript.some(isSpokenSavedLine)) return false;
        const text = buildSummaryTextForSearch(meeting.detailedSummary, meeting.summary);
        if (!text) return false;
        const needsEmbedding = this.vectorStore.saveSummary(meetingId, text);
        if (!needsEmbedding) return false;
        return this.embeddingPipeline.queueSummary(meetingId);
    }

    private summaryBackfillRan = false;

    /**
     * Give past meetings a summary in search — every real meeting saved before
     * 2026-10-04 lacks one, since indexing ran before the notes existed.
     *
     * Each meeting is EXAMINED ONCE, ever: a cursor in app_state walks the
     * meetings newest first and is saved as it goes, so a session that can
     * never be indexed (chat only, failed notes, empty notes) is not re-read
     * on every launch and cannot hold older meetings back. At most
     * `maxQueued` summaries are queued per launch; the walk resumes from the
     * cursor next time and writes 'done' when it reaches the end. Not
     * conditioned on the meeting having chunks: the final save used to delete
     * them (see saveMeeting's upsert note). Yields between meetings — each one
     * is a full synchronous read on the main process.
     */
    async backfillMeetingSummaries(maxQueued = 200): Promise<number> {
        if (this.summaryBackfillRan) return 0;
        this.summaryBackfillRan = true;
        const CURSOR_KEY = 'summary_backfill_cursor_v1';
        let queued = 0;
        let examined = 0;
        try {
            const stored = (this.db.prepare('SELECT value FROM app_state WHERE key = ?').get(CURSOR_KEY) as { value?: string } | undefined)?.value;
            if (stored === 'done') return 0;
            let cursor = stored !== undefined && Number.isFinite(Number(stored)) ? Number(stored) : Number.MAX_SAFE_INTEGER;
            const page = this.db.prepare(`
                SELECT m.rowid AS rid, m.id FROM meetings m
                WHERE m.rowid < ?
                  AND NOT EXISTS (SELECT 1 FROM chunk_summaries s WHERE s.meeting_id = m.id)
                ORDER BY m.rowid DESC
                LIMIT 50
            `);
            const saveCursor = this.db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)');
            let reachedEnd = false;
            while (queued < maxQueued) {
                const rows = page.all(cursor) as { rid: number; id: string }[];
                if (rows.length === 0) { reachedEnd = true; break; }
                for (const row of rows) {
                    cursor = row.rid;
                    examined++;
                    try {
                        if (await this.indexMeetingSummary(row.id)) queued++;
                    } catch (e: any) {
                        console.warn(`[RAGManager] Summary backfill skipped ${row.id}:`, e?.message || e);
                    }
                    await new Promise<void>(resolve => setImmediate(resolve));
                    if (queued >= maxQueued) break;
                }
                saveCursor.run(CURSOR_KEY, String(cursor));
            }
            if (reachedEnd) saveCursor.run(CURSOR_KEY, 'done');
            if (examined > 0) console.log(`[RAGManager] Summary backfill: examined ${examined} meetings, queued ${queued}${reachedEnd ? ' — complete' : ' — continues next launch'}`);
        } catch (e: any) {
            console.warn('[RAGManager] Summary backfill failed (non-fatal):', e?.message || e);
        }
        return queued;
    }

    /**
     * The saved meeting, read through the app's database manager. Its own
     * method so a test can hand in the manager it opened: each compiled file
     * is its own bundle with its own DatabaseManager singleton.
     */
    private loadMeetingForIndexing(meetingId: string): any {
        const { DatabaseManager } = require('../db/DatabaseManager');
        return DatabaseManager.getInstance().getMeetingDetails(meetingId);
    }

    private _chunkBackfillTimer: ReturnType<typeof setTimeout> | null = null;
    // Process-wide, like _jobGuards and for the same reason: two instances over
    // one database must not both re-embed the same meetings.
    private get _chunkBackfillInFlight(): boolean {
        return (globalThis as unknown as Record<string, unknown>).__nativelyChunkBackfillInFlightV1__ === true;
    }
    private set _chunkBackfillInFlight(v: boolean) {
        (globalThis as unknown as Record<string, unknown>).__nativelyChunkBackfillInFlightV1__ = v;
    }
    private _chunkBackfillLiveWaits = 0;
    private static readonly CHUNK_BACKFILL_DEFER_MS = 20_000;
    private static readonly CHUNK_BACKFILL_LIVE_RECHECK_MS = 5 * 60_000;
    private static readonly CHUNK_BACKFILL_MAX_LIVE_WAITS = 6;
    private static readonly CHUNK_BACKFILL_CURSOR_KEY = 'chunk_backfill_cursor_v1';

    /**
     * Arm the past-meeting transcript re-index a little after the embedding
     * provider is resolved, off the cold-start path. Safe to call on every
     * embeddings init: the walk is cursor-based and single-flight.
     */
    scheduleChunkBackfill(delayMs: number = RAGManager.CHUNK_BACKFILL_DEFER_MS): void {
        if (this._chunkBackfillTimer) clearTimeout(this._chunkBackfillTimer);
        this._chunkBackfillTimer = setTimeout(() => {
            this._chunkBackfillTimer = null;
            this.backfillMeetingChunks().catch(err => {
                console.warn('[RAGManager] Transcript re-index failed (continues next launch):', err?.message || err);
            });
        }, delayMs);
        this._chunkBackfillTimer.unref?.();
    }

    /**
     * Put past meetings' transcripts back in search.
     *
     * Until 2026-10-04 the final save of a meeting deleted the chunks indexed
     * a moment earlier (INSERT OR REPLACE on `meetings` cascading through the
     * foreign key — see saveMeeting's upsert note), so real meetings saved
     * since 2026-07-10 have a transcript and nothing to search it by. A
     * meeting indexed while no embedding provider was ready is in the same
     * state by another road: chunks stored, never queued.
     *
     * A meeting is taken when none of its chunks is embedded and none is
     * waiting in the queue. Like the summary backfill, each meeting is
     * examined once: a cursor in app_state walks newest first and ends at
     * 'done'. At most `maxMeetings` are re-indexed per launch, because every
     * chunk is an embedding call on the user's provider.
     *
     * It does not run — and does not move the cursor — while no provider is
     * usable (the chunks would be saved unembedded and never picked up again),
     * while a stand-in provider is active (the corpus would be embedded at the
     * stand-in's width and again when the selected one returns), or during a
     * live meeting. Returns the number of meetings re-indexed.
     */
    async backfillMeetingChunks(maxMeetings = 50): Promise<number> {
        if (this._chunkBackfillInFlight || !this.isDatabaseUsable()) return 0;
        if (!this.embeddingPipeline.getActiveSpaceKey() || this.embeddingPipeline.isRunningOnUnpinnedFallback()) return 0;
        const CURSOR_KEY = RAGManager.CHUNK_BACKFILL_CURSOR_KEY;
        const waitForLiveMeeting = () => {
            if (this._chunkBackfillLiveWaits >= RAGManager.CHUNK_BACKFILL_MAX_LIVE_WAITS) return;
            this._chunkBackfillLiveWaits++;
            this.scheduleChunkBackfill(RAGManager.CHUNK_BACKFILL_LIVE_RECHECK_MS);
        };
        if (this.liveIndexer.isRunning()) { waitForLiveMeeting(); return 0; }

        this._chunkBackfillInFlight = true;
        let indexed = 0;
        let examined = 0;
        try {
            const stored = (this.db.prepare('SELECT value FROM app_state WHERE key = ?').get(CURSOR_KEY) as { value?: string } | undefined)?.value;
            if (stored === 'done') return 0;
            let cursor = stored !== undefined && Number.isFinite(Number(stored)) ? Number(stored) : Number.MAX_SAFE_INTEGER;
            const page = this.db.prepare(`
                SELECT m.rowid AS rid, m.id FROM meetings m
                WHERE m.rowid < ?
                  AND m.id != 'live-meeting-current'
                  AND EXISTS (SELECT 1 FROM transcripts t WHERE t.meeting_id = m.id)
                  AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.meeting_id = m.id AND c.embedding IS NOT NULL)
                  AND NOT EXISTS (
                      SELECT 1 FROM embedding_queue q
                      WHERE q.meeting_id = m.id AND q.chunk_id IS NOT NULL AND q.status IN ('pending', 'processing')
                  )
                ORDER BY m.rowid DESC
                LIMIT 25
            `);
            const saveCursor = this.db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)');
            let reachedEnd = false;
            let interrupted = false;
            let providerLoaded = false;
            while (indexed < maxMeetings && !interrupted) {
                const rows = page.all(cursor) as { rid: number; id: string }[];
                if (rows.length === 0) { reachedEnd = true; break; }
                // There is work, so the provider has to be usable — and only
                // now: the bundled local model loads on demand, and a profile
                // with nothing to re-index should not pay for that load.
                if (!providerLoaded) {
                    if (!(await this.embeddingPipeline.ensureProviderLoaded())) { interrupted = true; break; }
                    providerLoaded = true;
                }
                for (const row of rows) {
                    // A meeting that just started, a provider that just dropped
                    // out, or a quit: stop BEFORE this meeting, cursor on the last
                    // one actually handled.
                    if (!this.isDatabaseUsable() || !this.embeddingPipeline.isReady() || this.embeddingPipeline.isRunningOnUnpinnedFallback()) { interrupted = true; break; }
                    if (this.liveIndexer.isRunning()) { interrupted = true; waitForLiveMeeting(); break; }
                    examined++;
                    if (!this._reprocessInFlight.has(row.id)) {
                        this._reprocessInFlight.add(row.id);
                        try {
                            const meeting = this.loadMeetingForIndexing(row.id);
                            const segments = (meeting?.transcript || []).filter(isSpokenSavedLine).map((t: any) => ({
                                speaker: t.speaker,
                                text: t.text,
                                timestamp: t.timestamp,
                            }));
                            if (segments.length > 0) {
                                const summary = buildSummaryTextForSearch(meeting.detailedSummary, meeting.summary) || undefined;
                                const { chunkCount } = await this.processMeeting(row.id, segments, summary, { providerLoad: 'await' });
                                if (chunkCount > 0) indexed++;
                            }
                        } catch (e: any) {
                            console.warn(`[RAGManager] Transcript re-index skipped ${row.id}:`, e?.message || e);
                        } finally {
                            this._reprocessInFlight.delete(row.id);
                        }
                    }
                    cursor = row.rid;
                    saveCursor.run(CURSOR_KEY, String(cursor));
                    await new Promise<void>(resolve => setImmediate(resolve));
                    if (indexed >= maxMeetings) break;
                }
            }
            if (reachedEnd) saveCursor.run(CURSOR_KEY, 'done');
            if (examined > 0) {
                console.log(`[RAGManager] Transcript re-index: examined ${examined} past meeting(s), re-indexed ${indexed}${reachedEnd ? ' — complete' : ' — continues next launch'}`);
            }
        } finally {
            this._chunkBackfillInFlight = false;
        }
        return indexed;
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
        // Runs at cold start: never load an embedding model for it here.
        await this.reprocessMeeting(demoId, { providerLoad: 'never' });
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
    private get _reindexInFlight(): boolean { return this._jobGuards.reindexing; }
    private set _reindexInFlight(v: boolean) { this._jobGuards.reindexing = v; }
    private _autoReindexTimer: ReturnType<typeof setTimeout> | null = null;
    private static readonly AUTO_REINDEX_DEFER_MS = 15_000;
    private static readonly REINDEX_LIVE_RECHECK_MS = 30_000;
    private static readonly REINDEX_MAX_LIVE_WAITS = 20; // ~10 min cap, then bail + retry next launch
    private static readonly REINDEX_DRAIN_POLL_MS = 2_000;
    private static readonly REINDEX_MAX_DRAIN_POLLS = 900; // ~30 min cap on progress polling

    scheduleAutoReindex(): void {
        const activeSpace = this.embeddingPipeline.getActiveSpaceKey();
        if (!activeSpace) return;
        // Never migrate the corpus INTO a stand-in space. A pinned provider that
        // is missing or down leaves something else active, and to
        // getIncompatibleSpaceCount() that is indistinguishable from the user
        // deliberately switching provider — so the sweep would clear every
        // vector in the pinned space and re-embed the corpus at the stand-in's
        // width, then do it all again in reverse when the pin came back.
        // Deferred, not cancelled: promoteFallbackProvider re-arms this the
        // moment the pinned provider is active again, and the sweep then also
        // reconciles anything indexed at the stand-in's width in the meantime.
        if (this.embeddingPipeline.isRunningOnUnpinnedFallback()) {
            console.warn(
                `[RAGManager] Deferring re-index: running on ${this.embeddingPipeline.getActiveProviderName()} `
                + `(${activeSpace}) while the selected embedding provider is unavailable. `
                + `Existing vectors are left in their own space and will be used again as soon as it returns.`
            );
            if (this._autoReindexTimer) clearTimeout(this._autoReindexTimer);
            this._autoReindexTimer = null;
            return;
        }
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
        if (this._chunkBackfillTimer) {
            clearTimeout(this._chunkBackfillTimer);
            this._chunkBackfillTimer = null;
        }
    }

    /**
     * Teardown hook for app shutdown: cancels the deferred auto-reindex timer (which
     * could otherwise fire up to ~15s — or the ~30min drain poll — after quit) and
     * terminates the VectorStore worker thread. Call from the before-quit handler.
     */
    async dispose(): Promise<void> {
        this.cancelPendingReindex();
        // Stop the embedding drain loop BEFORE the shared DB handle is closed
        // (main.ts disposes RAG, then closes the DB): an in-flight embed that
        // resumed after close used to throw into queueMeeting's catch, and on
        // the emergency-close path its write raced an uncheckpointed database.
        try { this.embeddingPipeline.stop(); } catch { /* non-fatal */ }
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
            this._emitReindex('embedding:reindex-complete', { total: 0, space: activeSpace, partial: false });
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
