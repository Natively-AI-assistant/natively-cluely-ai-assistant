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

export interface RAGManagerConfig {
    db: Database.Database;
    dbPath: string;       // Passed to VectorStore so worker can open its own read-only connection
    extPath: string;      // Resolved sqlite-vec extension path (no platform suffix)
    openaiKey?: string;
    geminiKey?: string;
    ollamaUrl?: string;
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

    constructor(config: RAGManagerConfig) {
        this.db = config.db;
        this.vectorStore = new VectorStore(config.db, config.dbPath, config.extPath);
        this.embeddingPipeline = new EmbeddingPipeline(config.db, this.vectorStore);
        this.retriever = new RAGRetriever(this.vectorStore, this.embeddingPipeline);
        this.liveIndexer = new LiveRAGIndexer(this.vectorStore, this.embeddingPipeline);

        this.embeddingPipeline.initialize({
            openaiKey: config.openaiKey,
            geminiKey: config.geminiKey,
            ollamaUrl: config.ollamaUrl
        });
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

    initializeEmbeddings(keys: { openaiKey?: string, geminiKey?: string, ollamaUrl?: string }): void {
        this.embeddingPipeline.initialize(keys);
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
        console.log(`[RAGManager] Reprocessing meeting ${meetingId}`);

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

        // Double check queue to avoid double-queueing
        const queueStatus = this.getQueueStatus();
        // This is a naive check (checks total pending), but good enough for now. 
        // Ideally we check if *this* meeting is in queue. 
        // For now, relies on isMeetingProcessed check mostly.

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
     * Trigger bulk re-indexing of meetings with obsolete/incompatible embedding dimensions.
     * Deletes their unreadable geometric BLOBs and requeues them via the active EmbeddingPipeline.
     */
    async reindexIncompatibleMeetings(): Promise<void> {
        const providerName = this.embeddingPipeline.getActiveProviderName();
        if (!providerName) {
            console.error('[RAGManager] Cannot re-index: No active embedding provider available.');
            return;
        }

        const count = this.vectorStore.getIncompatibleMeetingsCount(providerName);
        if (count === 0) {
            console.log('[RAGManager] No incompatible meetings found to reindex.');
            return;
        }

        console.log(`[RAGManager] Re-indexing ${count} incompatible meetings for ${providerName} pipeline...`);
        const affectedMeetingIds = this.vectorStore.deleteEmbeddingsForMeetings(providerName);
        
        for (const meetingId of affectedMeetingIds) {
            // Queue the re-embedding background jobs
            await this.embeddingPipeline.queueMeeting(meetingId);
        }

        console.log(`[RAGManager] Successfully requeued ${affectedMeetingIds.length} meetings for re-embedding.`);
    }
}
