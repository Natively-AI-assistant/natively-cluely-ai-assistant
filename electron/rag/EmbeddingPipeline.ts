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
// BUG-5: Maximum time to wait for a single embed() call.
// A frozen API (network partition / provider hang) would otherwise lock isProcessing=true
// forever, silently stalling the entire pipeline until app restart.
// 30s is generous for large chunks on slow connections (typical: 200-800ms).
const EMBED_TIMEOUT_MS = 30_000;

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
        // Log only the SHAPE (which keys are present), never the secret values — the
        // config carries API keys and this line would otherwise leak them to logs/crash reports.
        console.log('[EmbeddingPipeline] Initializing with config:', {
            openaiKey: !!config.openaiKey,
            geminiKey: !!config.geminiKey,
            ollamaUrl: config.ollamaUrl || null,
            geminiEmbeddingModel: config.geminiEmbeddingModel || null,
            geminiEmbeddingDims: config.geminiEmbeddingDims || null,
        });
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
        // A larger Gemini key pool is also an improvement (more rotation headroom).
        const poolGrew = (next.geminiKeys?.length || 0) > (prev.geminiKeys?.length || 0);
        return (
            hasNew(prev.openaiKey, next.openaiKey) ||
            hasNew(prev.geminiKey, next.geminiKey) ||
            poolGrew ||
            hasNew(prev.ollamaUrl, next.ollamaUrl)
        );
    }

    private async _doInitialize(config: AppAPIConfig): Promise<void> {
        // Construct the local fallback up front, but do NOT call isAvailable() here.
        // LocalEmbeddingProvider construction is cheap (paths + static dimensions/space);
        // isAvailable() loads the MiniLM ONNX model via transformers.js and can stall
        // the Electron main process during first paint. The provider loads lazily on
        // first real fallback/query use through embed()/embedQuery().
        this.fallbackProvider = new LocalEmbeddingProvider();
        console.log(`[EmbeddingPipeline] Local fallback provider registered for lazy load (${this.fallbackProvider.dimensions}d)`);

        // Resolve primary provider before touching the local model. If the primary is
        // local, the resolver's instance becomes both primary and fallback so the model
        // is loaded at most once in local-only mode.
        try {
            this.provider = await EmbeddingProviderResolver.resolve(config);
            console.log(`[EmbeddingPipeline] Ready with provider: ${this.provider.name} (${this.provider.dimensions}d)`);

            // If the primary IS local, point fallbackProvider at the same instance to avoid
            // loading the model twice.
            if (this.provider instanceof LocalEmbeddingProvider) {
                this.fallbackProvider = this.provider;
            }

            // Check for previous embedding-SPACE mismatches.
            // Trigger off the count of incompatible meetings (not just lastSpace !=
            // activeSpace) so a crash mid-reindex — where last_embedding_space may
            // already equal the active space but rows still hold the old space —
            // is still detected and resumed.
            const activeSpace = this.provider.space;
            const stateRow = this.db.prepare("SELECT value FROM app_state WHERE key = 'last_embedding_space'").get() as any;
            const lastSpace = stateRow?.value;

            const incompatibleCount = this.vectorStore.getIncompatibleSpaceCount(activeSpace);
            if (incompatibleCount > 0) {
                // RAGManager.scheduleAutoReindex() handles the user-facing notification
                // and the actual re-embedding. Here we only log — emitting a warning IPC
                // too would double-notify.
                console.log(`[EmbeddingPipeline] Found ${incompatibleCount} meetings in an incompatible embedding space (last: ${lastSpace ?? 'unknown'}, active: ${activeSpace}). Auto-reindex will handle them.`);
            }

            // Save active space
            this.db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('last_embedding_space', ?)").run(activeSpace);

        } catch (err) {
            console.error('[EmbeddingPipeline] Failed to initialize primary provider:', err);
            console.warn('[EmbeddingPipeline] Falling back to local-only mode for all meetings.');
            // Promote fallback as the primary so isReady() returns true and queueing works.
            // The local model still loads lazily on the first embed call.
            this.provider = this.fallbackProvider;
            // Persist the fallback provider's space so the next launch does not fire a
            // false-positive incompatible-space warning (e.g. openai space vs local space).
            try {
                this.db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('last_embedding_space', ?)").run(this.provider.space);
            } catch (_) { /* non-fatal — DB may not have app_state yet in edge cases */ }
        }

        // Flush any queue items submitted during the startup race window (i.e. before the
        // provider was ready). processQueue() is idempotent and a no-op if the queue is empty.
        setTimeout(() => {
            this.processQueue().catch(err => {
                console.warn('[EmbeddingPipeline] Post-init queue flush failed (non-fatal):', err.message);
            });
        }, 0);
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
     * Get the active provider's composite embedding-space key
     * (`${name}:${model}:${dims}`), used to gate re-indexing on space identity
     * rather than provider name alone.
     */
    getActiveSpaceKey(): string | undefined {
        return this.provider?.space;
    }

    /** Get the active provider's embedding dimensions (avoids reaching into private state). */
    getActiveDimensions(): number | undefined {
        return this.provider?.dimensions;
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
     * Atomically clear a meeting's embeddings AND queue it for re-embedding, in a
     * single transaction. Used by the re-index path so a crash can never leave a
     * meeting with cleared vectors but no queue entry (which would make it an
     * orphan: chunks present, embeddings NULL, space NULL, not enqueued, and
     * NOT picked up by the re-index sweep since that requires embedding IS NOT NULL).
     *
     * After this returns, the meeting either has its old vectors AND queue rows
     * (crash before commit → rolled back, sweep re-detects it) or cleared vectors
     * AND queue rows (crash after commit → queue drains on next launch). No orphan.
     */
    async requeueMeetingForReindex(meetingId: string): Promise<void> {
        const chunkIds = this.db
            .prepare('SELECT id FROM chunks WHERE meeting_id = ?')
            .all(meetingId) as { id: number }[];

        const insert = this.db.prepare(`
            INSERT OR IGNORE INTO embedding_queue (meeting_id, chunk_id, status)
            VALUES (?, ?, 'pending')
        `);

        // One transaction: clear vectors + provider/space metadata, then queue
        // ALL chunks (not just NULL-embedding ones) + the summary.
        const tx = this.db.transaction(() => {
            this.vectorStore.clearEmbeddingsForMeeting(meetingId);
            // Purge any prior queue rows for this meeting first. The UNIQUE(meeting_id,
            // chunk_id) constraint does NOT dedupe the summary row (chunk_id IS NULL, and
            // SQLite treats NULL != NULL), so a re-queue would otherwise accumulate
            // duplicate summary rows. Deleting first makes this idempotent for chunks AND
            // the summary, and is safe inside the same transaction as the re-insert.
            this.db.prepare('DELETE FROM embedding_queue WHERE meeting_id = ?').run(meetingId);
            for (const c of chunkIds) insert.run(meetingId, c.id);
            insert.run(meetingId, null); // summary
        });
        tx();

        console.log(`[EmbeddingPipeline] Requeued meeting ${meetingId} for re-index (${chunkIds.length} chunks + summary, atomic)`);

        this.processQueue().catch(err => {
            console.error('[EmbeddingPipeline] Queue processing error (reindex):', err);
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
            // Foreground gate (manual regression 2026-06-12): the drain loop's
            // synchronous better-sqlite3 statements block the main-process event
            // loop. Yield to any in-flight manual/WTA answer between items so a
            // post-meeting embedding backlog can't make live questions lag.
            const { ForegroundGate } = require('../services/ForegroundGate') as typeof import('../services/ForegroundGate');
            while (true) {
                await ForegroundGate.waitUntilIdle();
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
     * Get embedding for a document chunk (for storage).
     * Routes through embedWithTimeout() so a frozen API cannot stall the live indexer.
     */
    async getEmbedding(text: string): Promise<number[]> {
        if (!this.provider) {
            throw new Error('Embedding provider not initialized');
        }
        return this.embedWithTimeout(this.provider, text, 'live-chunk');
    }

    /**
     * Batch-embed multiple document chunks in a single call. Providers that
     * support a native batch endpoint (OpenAI, Gemini) will return all
     * embeddings in one network round-trip; providers without a native batch
     * implement `embedBatch` as Promise.all(map(embed)) so we still benefit
     * from concurrency.
     *
     * Wraps the whole batch in a single EMBED_TIMEOUT_MS so a partial
     * provider stall cannot dangle the caller indefinitely — same contract
     * as getEmbedding().
     */
    async getEmbeddings(texts: string[]): Promise<number[][]> {
        if (!this.provider) {
            throw new Error('Embedding provider not initialized');
        }
        if (texts.length === 0) return [];
        const provider = this.provider;
        return new Promise<number[][]>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(
                    `[EmbeddingPipeline] embedBatch() timed out after ${EMBED_TIMEOUT_MS}ms for ${texts.length} chunks via ${provider.name}`
                ));
            }, EMBED_TIMEOUT_MS);
            provider.embedBatch(texts).then(
                (results) => { clearTimeout(timer); resolve(results); },
                (err)     => { clearTimeout(timer); reject(err); }
            );
        });
    }

    async getEmbeddingsWithFallback(texts: string[]): Promise<{ embeddings: number[][]; space: string; provider?: string; dimensions?: number }> {
        try {
            const embeddings = await this.getEmbeddings(texts);
            const space = this.getActiveSpaceKey();
            if (!space) throw new Error('Embedding provider has no active space');
            return { embeddings, space, provider: this.provider?.name, dimensions: this.provider?.dimensions };
        } catch (primaryError) {
            const fallback = this.fallbackProvider;
            // If no fallback is configured, or the primary IS already the fallback
            // (local-only mode where `this.provider === this.fallbackProvider`),
            // re-running the same call would silently double-embed and re-trigger
            // the same timeout. Surface the original failure instead.
            if (!fallback || fallback === this.provider) throw primaryError;
            console.warn(
                `[EmbeddingPipeline] Primary batch embedding failed via ${this.provider?.name ?? 'unknown'}; ` +
                `falling back to ${fallback.name}:`,
                primaryError instanceof Error ? primaryError.message : primaryError
            );
            const embeddings = await new Promise<number[][]>((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error(
                        `[EmbeddingPipeline] fallback embedBatch() timed out after ${EMBED_TIMEOUT_MS}ms for ${texts.length} chunks via ${fallback.name}`
                    ));
                }, EMBED_TIMEOUT_MS);
                fallback.embedBatch(texts).then(
                    (results) => { clearTimeout(timer); resolve(results); },
                    (err)     => { clearTimeout(timer); reject(err); }
                );
            });
            // Promote fallback for subsequent mode query embeddings. Persisted mode
            // vectors are only comparable within one active space; keeping the
            // exhausted cloud provider active would make freshly-local vectors look
            // perpetually pending and unusable. The promotion guard is a no-op when
            // already promoted (idempotent under concurrent indexFile callers).
            if (this.provider !== fallback) {
                this.provider = fallback;
                try {
                    this.db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('last_embedding_space', ?)").run(fallback.space);
                } catch (dbErr: any) {
                    console.warn('[EmbeddingPipeline] Failed to persist fallback space:', dbErr?.message || dbErr);
                    // MEDIUM #4: a swallowed persist failure means next launch can't
                    // read back the promoted space, leaving freshly-local vectors
                    // perpetually "pending" with no UI signal. Surface it so the
                    // renderer can warn the user that a re-index may be required.
                    try {
                        const { BrowserWindow } = require('electron');
                        BrowserWindow.getAllWindows().forEach((win: any) => {
                            if (!win.isDestroyed()) {
                                win.webContents.send('embedding:space-persist-failed', {
                                    fallbackProvider: fallback.name,
                                    space: fallback.space,
                                    reason: dbErr?.message || String(dbErr),
                                });
                            }
                        });
                    } catch { /* non-fatal — best-effort renderer notice */ }
                }
            }
            return { embeddings, space: fallback.space, provider: fallback.name, dimensions: fallback.dimensions };
        }
    }

    /**
     * Get embedding for a search query (may use different prefix for asymmetric models).
     * Routes through embedWithTimeout() so a frozen API cannot stall the query path.
     */
    async getEmbeddingForQuery(text: string): Promise<number[]> {
        const provider = this.provider;
        if (!provider) {
            throw new Error('Embedding provider not initialized');
        }
        // Capture `provider` before the await boundary — if a concurrent
        // getEmbeddingsWithFallback() promotes the fallback while this call is
        // pending, the captured reference still points to the provider that was
        // active at the start of the query and matches its space.
        // embedQuery() uses a query-specific prefix for asymmetric models (e.g. Nomic).
        // Wrap with a manual timeout since embedQuery is not covered by embedWithTimeout directly.
        return new Promise<number[]>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(
                    `[EmbeddingPipeline] embedQuery() timed out after ${EMBED_TIMEOUT_MS}ms for live-query via ${provider.name}`
                ));
            }, EMBED_TIMEOUT_MS);
            provider.embedQuery(text).then(
                (result) => { clearTimeout(timer); resolve(result); },
                (err)    => { clearTimeout(timer); reject(err); }
            );
        });
    }

    /**
     * Embed a query using the ON-DEVICE local provider specifically (bundled
     * MiniLM, ~10ms, fully offline) rather than whatever the primary provider
     * is. Used for the latency-critical knowledge query path: when the resume
     * was also indexed locally (same 384d space), this skips a ~100-200ms cloud
     * embedding round-trip on every question.
     *
     * Returns null when no local provider is available (bundled model missing)
     * — the caller MUST fall back to the index-matching embedder so cosine
     * similarity is never computed across mismatched dimensions (which silently
     * returns 0 in HybridSearchEngine). Never throws; resolves null on any error.
     *
     * `localDimensions` exposes the local model's vector size so the caller can
     * dimension-check against the index BEFORE paying for the embed.
     */
    get localDimensions(): number | null {
        return this.fallbackProvider?.dimensions ?? null;
    }

    /**
     * The on-device fallback provider's composite space key. Lets the knowledge
     * query path verify the fast local embedder shares the indexed nodes' SPACE
     * (not just their dimension) before using it — guards against a same-dimension
     * but different-space collision (e.g. Gemini pinned to 384d via env lever).
     */
    get localSpaceKey(): string | null {
        return this.fallbackProvider?.space ?? null;
    }

    async getEmbeddingForQueryLocalOnly(text: string): Promise<number[] | null> {
        const local = this.fallbackProvider;
        if (!local) return null;
        try {
            return await this.embedWithTimeout(local, text, 'local-query');
        } catch (e: any) {
            console.warn('[EmbeddingPipeline] Local query embed failed:', e?.message || e);
            return null;
        }
    }

    /**
     * BUG-5 fix: Wraps a single embed() call with a hard timeout so a frozen API
     * (network partition, provider hang) cannot lock isProcessing=true indefinitely.
     * Throws if the provider does not respond within EMBED_TIMEOUT_MS (30s).
     */
    private async embedWithTimeout(provider: IEmbeddingProvider, text: string, chunkLabel: string): Promise<number[]> {
        return new Promise<number[]>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(
                    `[EmbeddingPipeline] embed() timed out after ${EMBED_TIMEOUT_MS}ms for ${chunkLabel} via ${provider.name}`
                ));
            }, EMBED_TIMEOUT_MS);

            provider.embed(text).then(
                (result) => { clearTimeout(timer); resolve(result); },
                (err)    => { clearTimeout(timer); reject(err); }
            );
        });
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

        const embedding = await this.embedWithTimeout(p, row.cleaned_text, `chunk ${chunkId}`);
        this.vectorStore.storeEmbedding(chunkId, embedding);

        // Record provider metadata on the meeting after first successful embedding
        try {
            this.db.prepare(
                'UPDATE meetings SET embedding_provider = ?, embedding_dimensions = ?, embedding_space = ? WHERE id = ? AND embedding_provider IS NULL'
            ).run(p.name, p.dimensions, p.space, row.meeting_id);
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

        const embedding = await this.embedWithTimeout(p, row.summary_text, `summary:${meetingId}`);
        this.vectorStore.storeSummaryEmbedding(meetingId, embedding);

        // P2-8: record provider metadata on the meeting row so that provider-switch
        // compatibility checks (which gate search queries by embedding_provider) also
        // cover meetings whose only embedding is a summary (no chunks).
        try {
            this.db.prepare(
                'UPDATE meetings SET embedding_provider = ?, embedding_dimensions = ?, embedding_space = ? WHERE id = ? AND embedding_provider IS NULL'
            ).run(p.name, p.dimensions, p.space, meetingId);
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
