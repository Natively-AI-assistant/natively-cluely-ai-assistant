// electron/rag/EmbeddingPipeline.ts
// Post-meeting embedding generation with queue-based retry logic
// Uses pluggable IEmbeddingProvider (Gemini, OpenAI, or Ollama)
// On provider exhaustion, automatically falls back to LocalEmbeddingProvider (on-device).

import Database from 'better-sqlite3';
import { VectorStore } from './VectorStore';

import { EmbeddingProviderResolver, AppAPIConfig } from './EmbeddingProviderResolver';
import { IEmbeddingProvider } from './providers/IEmbeddingProvider';
import { LocalEmbeddingProvider } from './providers/LocalEmbeddingProvider';

const MAX_RETRIES = 3;
const RETRY_DELAY_BASE_MS = 2000;

/**
 * EmbeddingPipeline - Handles post-meeting embedding generation
 * 
 * Design:
 * - NOT real-time: embeddings generated after meeting ends
 * - Queue-based: persists in SQLite for retry on failure
 * - Background processing: doesn't block UI
 * - Provider-agnostic: works with Gemini, OpenAI, or Ollama embeddings
 */
export class EmbeddingPipeline {
    private provider: IEmbeddingProvider | null = null;
    /** Always available on-device fallback (MiniLM). Null only if the bundled model is corrupted. */
    private fallbackProvider: IEmbeddingProvider | null = null;
    /** Set of meeting IDs that have been downgraded to local fallback after primary provider exhaustion. */
    private fallbackMeetings = new Set<string>();
    private db: Database.Database;
    private vectorStore: VectorStore;
    private isProcessing = false;
    private initPromise: Promise<void> | null = null;
    /** Tracks the config used in the most recent successful initialize() call to enable idempotency. */
    private _lastConfig: AppAPIConfig | null = null;

    constructor(db: Database.Database, vectorStore: VectorStore) {
        this.db = db;
        this.vectorStore = vectorStore;
    }

    /**
     * Initialize with provider config (picks best available provider)
     * Idempotent: re-initialization only runs if the new config adds at least one
     * key/URL that was not present in the last config (e.g., Ollama becomes available,
     * or a cloud API key is loaded from CredentialsManager after startup).
     * If the config is unchanged or strictly worse, the existing initPromise is returned.
     */
    async initialize(config: AppAPIConfig): Promise<void> {
        // Skip if config is identical or has no new information
        if (this._lastConfig && !this._isConfigImprovement(this._lastConfig, config)) {
            console.log('[EmbeddingPipeline] Config unchanged or no new keys — skipping re-initialization');
            return this.initPromise ?? Promise.resolve();
        }
        this._lastConfig = { ...config };
        console.log('[EmbeddingPipeline] Initializing with config:', config);
        this.initPromise = this._doInitialize(config);
        return this.initPromise;
    }

    /**
     * Returns true if `next` provides at least one credential that `prev` did not have.
     * Prevents redundant re-initialization when the same keys are passed again.
     */
    private _isConfigImprovement(prev: AppAPIConfig, next: AppAPIConfig): boolean {
        const hasNew = (prevVal: string | undefined, nextVal: string | undefined) =>
            !prevVal && !!nextVal;
        return (
            hasNew(prev.openaiKey, next.openaiKey) ||
            hasNew(prev.geminiKey, next.geminiKey) ||
            hasNew(prev.ollamaUrl, next.ollamaUrl)
        );
    }

    private async _doInitialize(config: AppAPIConfig): Promise<void> {
        // ── Step 1: Eagerly init the local fallback FIRST, independently of the primary.
        // This guarantees fallbackProvider is set even if the primary throws,
        // so activateMeetingFallback() is always safe to call.
        try {
            const local = new LocalEmbeddingProvider();
            if (await local.isAvailable()) {
                this.fallbackProvider = local;
                console.log(`[EmbeddingPipeline] Local fallback provider ready (${local.dimensions}d)`);
            } else {
                console.warn('[EmbeddingPipeline] Local fallback provider unavailable — bundled model may be missing');
            }
        } catch (e) {
            console.warn('[EmbeddingPipeline] Could not initialize local fallback provider:', e);
        }

        // ── Step 2: Resolve primary provider.
        try {
            this.provider = await EmbeddingProviderResolver.resolve(config);
            console.log(`[EmbeddingPipeline] Ready with provider: ${this.provider.name} (${this.provider.dimensions}d)`);

            // If the primary IS local, point fallbackProvider at the same instance to avoid
            // loading the model twice.
            if (this.provider instanceof LocalEmbeddingProvider) {
                this.fallbackProvider = this.provider;
            }

            // Check for previous provider mismatches
            const stateRow = this.db.prepare("SELECT value FROM app_state WHERE key = 'last_embedding_provider'").get() as any;
            const lastProvider = stateRow?.value;

            if (lastProvider && lastProvider !== this.provider.name) {
                const count = this.vectorStore.getIncompatibleMeetingsCount(this.provider.name);
                if (count > 0) {
                    console.log(`[EmbeddingPipeline] Found ${count} incompatible meetings from ${lastProvider}.`);
                    const { BrowserWindow } = require('electron');
                    BrowserWindow.getAllWindows().forEach((win: any) => {
                        if (!win.isDestroyed()) {
                            win.webContents.send('embedding:incompatible-provider-warning', {
                                count,
                                oldProvider: lastProvider,
                                newProvider: this.provider!.name
                            });
                        }
                    });
                }
            }

            // Save new provider
            this.db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('last_embedding_provider', ?)").run(this.provider.name);

        } catch (err) {
            console.error('[EmbeddingPipeline] Failed to initialize primary provider:', err);
            // Don't rethrow — if we have a fallback, the pipeline can still function
            // in local-only mode. Callers check isReady() which checks this.provider.
            // Only throw if we also have no fallback at all.
            if (!this.fallbackProvider) {
                throw err;
            }
            console.warn('[EmbeddingPipeline] Falling back to local-only mode for all meetings.');
            // Promote fallback as the primary so isReady() returns true and queueing works.
            this.provider = this.fallbackProvider;
            // Persist the fallback provider name so the next launch does not fire a
            // false-positive incompatible-provider warning (e.g. 'openai' vs 'local').
            try {
                this.db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('last_embedding_provider', ?)").run(this.provider.name);
            } catch (_) { /* non-fatal — DB may not have app_state yet in edge cases */ }
        }
    }

    /**
     * Check if pipeline is ready
     */
    isReady(): boolean {
        return this.provider !== null;
    }

    /**
     * Wait for the pipeline to finish initializing.
     * Safe to call multiple times — resolves immediately if already ready.
     * Throws if initialization failed entirely.
     */
    async waitForReady(timeoutMs: number = 15000): Promise<void> {
        if (this.provider) return; // already ready
        if (this.initPromise) {
            // Race against a timeout so we don't hang forever
            await Promise.race([
                this.initPromise,
                new Promise<void>((_, reject) =>
                    setTimeout(() => reject(new Error(`Embedding pipeline initialization timed out after ${timeoutMs}ms`)), timeoutMs)
                )
            ]);
            return;
        }
        throw new Error('Embedding pipeline has not been initialized');
    }

    /**
     * Get the currently active provider name (used for dimension safety checks)
     */
    getActiveProviderName(): string | undefined {
        return this.provider?.name;
    }

    /**
     * Queue a meeting for embedding processing
     * Called when meeting ends
     */
    async queueMeeting(meetingId: string): Promise<void> {
        // Get chunks without embeddings
        const chunks = this.vectorStore.getChunksWithoutEmbeddings(meetingId);

        if (chunks.length === 0) {
            console.log(`[EmbeddingPipeline] No chunks to embed for meeting ${meetingId}`);
            return;
        }

        // Queue each chunk.
        // INSERT OR IGNORE prevents duplicate rows if queueMeeting() is called twice
        // for the same meeting (e.g., reprocessMeeting() path).
        const insert = this.db.prepare(`
            INSERT OR IGNORE INTO embedding_queue (meeting_id, chunk_id, status)
            VALUES (?, ?, 'pending')
        `);

        const queueAll = this.db.transaction(() => {
            for (const chunk of chunks) {
                insert.run(meetingId, chunk.id);
            }
            // Also queue summary (chunk_id = NULL means summary)
            insert.run(meetingId, null);
        });

        queueAll();
        
        // NOTE: Provider metadata is written on the first successful embedding
        // for this meeting (inside embedChunk), not here — to avoid marking a
        // meeting as embedded if the queue crashes before any work is done.

        console.log(`[EmbeddingPipeline] Queued ${chunks.length} chunks + 1 summary for meeting ${meetingId}`);

        // Start processing in background
        this.processQueue().catch(err => {
            console.error('[EmbeddingPipeline] Queue processing error:', err);
        });
    }

    /**
     * Process pending embeddings from queue.
     * If an item exhausts MAX_RETRIES with the primary provider, the entire
     * meeting is transparently downgraded to LocalEmbeddingProvider (on-device)
     * and its queue is reset so it re-embeds from scratch at the correct dimensions.
     */
    async processQueue(): Promise<void> {
        if (this.isProcessing) {
            console.log('[EmbeddingPipeline] Already processing queue');
            return;
        }

        if (!this.provider) {
            console.log('[EmbeddingPipeline] No provider, skipping queue processing');
            return;
        }

        // Recover items stuck in 'processing' from a previous app crash.
        // These were marked 'processing' before the embed call but never completed.
        // Reset them to 'pending' so this run can pick them up.
        const stuckCount = this.db.prepare(
            `UPDATE embedding_queue SET status = 'pending' WHERE status = 'processing'`
        ).run().changes;
        if (stuckCount > 0) {
            console.warn(`[EmbeddingPipeline] Recovered ${stuckCount} stuck 'processing' items from prior crash.`);
        }

        this.isProcessing = true;

        try {
            while (true) {
                // Fetch next pending item. Items marked for local fallback (retry_count = -1)
                // are also eligible, so we use a broad filter.
                const pending = this.db.prepare(`
                    SELECT * FROM embedding_queue 
                    WHERE status = 'pending'
                      AND (retry_count < ? OR retry_count = -1)
                    ORDER BY created_at ASC
                    LIMIT 1
                `).get(MAX_RETRIES) as any;

                if (!pending) {
                    console.log('[EmbeddingPipeline] Queue empty');
                    break;
                }

                // Determine which provider to use
                const useFallback =
                    pending.retry_count === -1 ||
                    this.fallbackMeetings.has(pending.meeting_id);
                const activeProvider = useFallback ? this.fallbackProvider : this.provider;

                if (!activeProvider) {
                    // Cannot proceed — no provider at all (fallback also unavailable).
                    // Reset item back to 'pending' so it can be retried when keys are configured.
                    // Do NOT mark as 'failed' — that is a terminal state that can't be recovered.
                    this.db.prepare(
                        `UPDATE embedding_queue SET status = 'pending', error_message = 'No provider available' WHERE id = ?`
                    ).run(pending.id);
                    // Break the loop — there is nothing we can do until a provider becomes available.
                    console.warn('[EmbeddingPipeline] No provider available (not even local fallback). Stopping queue processing.');
                    break;
                }

                // Mark as processing
                this.db.prepare(
                    `UPDATE embedding_queue SET status = 'processing' WHERE id = ?`
                ).run(pending.id);

                try {
                    if (pending.chunk_id) {
                        await this.embedChunk(pending.chunk_id, activeProvider);
                    } else {
                        await this.embedMeetingSummary(pending.meeting_id, activeProvider);
                    }

                    // Mark as completed
                    this.db.prepare(`
                        UPDATE embedding_queue 
                        SET status = 'completed', processed_at = ?
                        WHERE id = ?
                    `).run(new Date().toISOString(), pending.id);

                } catch (error: any) {
                    const newRetryCount = (pending.retry_count === -1 ? 0 : pending.retry_count) + 1;
                    console.error(
                        `[EmbeddingPipeline] Error processing queue item ${pending.id} ` +
                        `(retry ${newRetryCount}/${MAX_RETRIES}, provider: ${activeProvider.name}):`,
                        error.message
                    );

                    if (!useFallback && newRetryCount >= MAX_RETRIES && this.fallbackProvider) {
                        // Primary provider exhausted. Downgrade the meeting to local fallback.
                        await this.activateMeetingFallback(pending.meeting_id);
                    } else {
                        // Still have retries remaining — back-off and retry.
                        this.db.prepare(`
                            UPDATE embedding_queue 
                            SET status = 'pending', retry_count = retry_count + 1, error_message = ?
                            WHERE id = ?
                        `).run(error.message, pending.id);

                        // Exponential backoff (skip for fallback items already reset)
                        if (!useFallback) {
                            const delay = RETRY_DELAY_BASE_MS * Math.pow(2, pending.retry_count);
                            await this.delay(delay);
                        }
                    }
                }
            }
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Downgrade a meeting to on-device (local) embedding after primary provider exhaustion.
     * 1. Clears all PENDING/PROCESSING embeddings so dimension mismatch cannot occur.
     *    Already-completed items are left alone to avoid redundant re-embedding.
     * 2. Resets non-completed queue items for the meeting back to pending with sentinel retry_count=-1
     *    so processQueue knows to use fallbackProvider unconditionally.
     * 3. Notifies the renderer so the user sees an informative toast.
     */
    private async activateMeetingFallback(meetingId: string): Promise<void> {
        if (!this.fallbackProvider) {
            // Should never happen — guard exists in the caller, but be defensive.
            console.error(`[EmbeddingPipeline] Cannot activate fallback for ${meetingId}: no local fallback provider available.`);
            return;
        }
        // Capture in a local const so TypeScript can narrow the type (class fields can't be narrowed).
        const fallback = this.fallbackProvider;

        console.warn(
            `[EmbeddingPipeline] Primary provider exhausted for meeting ${meetingId}. ` +
            `Activating local fallback (${fallback.name}).`
        );

        // 1. Clear existing (potentially partial) embeddings to prevent dimension clash.
        //    This is safe because we re-embed all chunks from scratch via the fallback.
        this.vectorStore.clearEmbeddingsForMeeting(meetingId);

        // 2. Reset ALL non-failed queue items for this meeting back to pending with
        //    sentinel retry_count=-1. We include previously 'completed' items here
        //    because clearEmbeddingsForMeeting() just wiped their stored BLOBs, so
        //    their 'completed' status is now stale — they MUST be re-embedded.
        //    status='failed' items (retry_count >= MAX_RETRIES) stay failed to avoid
        //    an infinite retry loop.
        this.db.prepare(`
            UPDATE embedding_queue
            SET status = 'pending', retry_count = -1,
                error_message = 'Falling back to local embedding'
            WHERE meeting_id = ?
              AND status != 'failed'
        `).run(meetingId);

        // 3. Track at runtime (avoids a DB read per item in processQueue)
        this.fallbackMeetings.add(meetingId);

        // 4. Notify the renderer
        try {
            const { BrowserWindow } = require('electron');
            BrowserWindow.getAllWindows().forEach((win: any) => {
                if (!win.isDestroyed()) {
                    win.webContents.send('embedding:fallback-activated', {
                        meetingId,
                        fallbackProvider: fallback.name,
                        reason: 'Primary embedding provider failed after max retries'
                    });
                }
            });
        } catch (_) { /* non-fatal */ }
    }

    /**
     * Get embedding for a document chunk (for storage)
     */

    async getEmbedding(text: string): Promise<number[]> {
        if (!this.provider) {
            throw new Error('Embedding provider not initialized');
        }
        return this.provider.embed(text);
    }

    /**
     * Get embedding for a search query (may use different prefix for asymmetric models)
     */
    async getEmbeddingForQuery(text: string): Promise<number[]> {
        if (!this.provider) {
            throw new Error('Embedding provider not initialized');
        }
        return this.provider.embedQuery(text);
    }

    /**
     * Embed a single chunk using the given provider (defaults to this.provider).
     */
    private async embedChunk(chunkId: number, provider?: IEmbeddingProvider): Promise<void> {
        const p = provider ?? this.provider;
        if (!p) throw new Error('No embedding provider');

        // Get chunk text
        const row = this.db.prepare('SELECT cleaned_text, meeting_id FROM chunks WHERE id = ?').get(chunkId) as any;
        if (!row) {
            console.log(`[EmbeddingPipeline] Chunk ${chunkId} not found, skipping`);
            return;
        }

        const embedding = await p.embed(row.cleaned_text);
        this.vectorStore.storeEmbedding(chunkId, embedding);

        // Record provider metadata on the meeting after first successful embedding
        try {
            this.db.prepare(
                'UPDATE meetings SET embedding_provider = ?, embedding_dimensions = ? WHERE id = ? AND embedding_provider IS NULL'
            ).run(p.name, p.dimensions, row.meeting_id);
        } catch (e) {
            // Non-fatal — metadata is for safety filtering, not critical path
        }

        console.log(`[EmbeddingPipeline] Embedded chunk ${chunkId} via ${p.name}`);
    }

    /**
     * Embed meeting summary using the given provider (defaults to this.provider).
     */
    private async embedMeetingSummary(meetingId: string, provider?: IEmbeddingProvider): Promise<void> {
        const p = provider ?? this.provider;
        if (!p) throw new Error('No embedding provider');

        // Get summary text
        const row = this.db.prepare(
            'SELECT summary_text FROM chunk_summaries WHERE meeting_id = ?'
        ).get(meetingId) as any;

        if (!row) {
            console.log(`[EmbeddingPipeline] No summary for meeting ${meetingId}, skipping`);
            return;
        }

        const embedding = await p.embed(row.summary_text);
        this.vectorStore.storeSummaryEmbedding(meetingId, embedding);

        // P2-8: record provider metadata on the meeting row so that provider-switch
        // compatibility checks (which gate search queries by embedding_provider) also
        // cover meetings whose only embedding is a summary (no chunks).
        try {
            this.db.prepare(
                'UPDATE meetings SET embedding_provider = ?, embedding_dimensions = ? WHERE id = ? AND embedding_provider IS NULL'
            ).run(p.name, p.dimensions, meetingId);
        } catch (e) {
            // Non-fatal — metadata is for safety filtering, not critical path
        }

        console.log(`[EmbeddingPipeline] Embedded summary for meeting ${meetingId} via ${p.name}`);
    }

    /**
     * Get queue status
     */
    getQueueStatus(): { pending: number; processing: number; completed: number; failed: number } {
        const counts = this.db.prepare(`
            SELECT status, COUNT(*) as count FROM embedding_queue GROUP BY status
        `).all() as any[];

        const result = { pending: 0, processing: 0, completed: 0, failed: 0 };

        for (const row of counts) {
            if (row.status === 'pending') result.pending = row.count;
            else if (row.status === 'processing') result.processing = row.count;
            else if (row.status === 'completed') result.completed = row.count;
            else if (row.status === 'failed') result.failed = row.count;
        }

        // Also count 'pending' items that have exhausted primary retries but haven't yet
        // activated the local fallback (retry_count >= MAX_RETRIES, NOT a sentinel).
        // These are effectively stalled — surface them as "failed" in the UI so the
        // user knows they need attention, but note that activateMeetingFallback will
        // move them to retry_count=-1 when the pipeline processes them.
        // IMPORTANT: exclude the fallback-sentinel (retry_count = -1) from this count.
        const effectivelyStalled = this.db.prepare(`
            SELECT COUNT(*) as count FROM embedding_queue 
            WHERE status = 'pending' AND retry_count >= ? AND retry_count != -1
        `).get(MAX_RETRIES) as any;

        // Add stalled count on top of explicit status='failed' count (don't overwrite)
        result.failed += (effectivelyStalled.count || 0);
        // Deduct stalled items from pending so the totals are coherent
        result.pending = Math.max(0, result.pending - (effectivelyStalled.count || 0));

        return result;
    }

    /**
     * Clear completed queue items older than N days
     */
    cleanupQueue(daysOld: number = 7): void {
        const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
        this.db.prepare(`
            DELETE FROM embedding_queue 
            WHERE status = 'completed' AND processed_at < ?
        `).run(cutoff);
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
