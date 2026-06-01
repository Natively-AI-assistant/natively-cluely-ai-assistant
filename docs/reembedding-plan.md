# Re-embedding Plan (Phase 7)

**Date:** 2026-06-01
**Rule:** DO NOT auto-re-embed production data. Tooling + plan only.

## Why re-embedding is even a question

`gemini-embedding-001`, `gemini-embedding-2`, and `text-embedding-004` produce
**incompatible vector spaces** (confirmed: docs/google-embedding-verification.md §4).
Equal dimensionality (all 768) does NOT make them comparable. A store that mixes
spaces returns semantically random similarity with no error.

## Who actually has stored vectors

| System | Stores vectors? | Re-embedding needed? |
|---|---|---|
| **Server** (`natively-api`) | **No** — `/v1/embed` is a stateless proxy | **None.** Switching the server model has no stored-vector consequences. |
| **Desktop app** | Yes — local SQLite per install | Handled automatically & lazily (below). |

→ **There is no server-side re-embedding task.** The only vectors that exist are in
each user's local desktop DB, and the desktop already manages their lifecycle.

## Desktop re-embedding: already a zero-downtime, lazy design

Verified in code (debugger/general-purpose agent pass, 2026-06-01):

1. **Space stamping** — every stored vector carries `embedding_space = provider:model:dims`
   (`embeddingSpace.ts`). v1 rows = `gemini:gemini-embedding-001:768`; v2 = `gemini:gemini-embedding-2:768`.
2. **Space-equality search filter** — `VectorStore.searchSimilar/searchSummaries` add
   `AND m.embedding_space = ?`. Vectors from a different space are never compared.
   `spaceKey` falsy → returns `[]` (refuses cross-space search).
3. **NULL-space exclusion** — rows mid-reindex (`embedding_space = NULL`) are excluded →
   **empty, not wrong**. Users see reduced recall on not-yet-reindexed meetings, never
   garbage matches.
4. **Lazy, throttled re-index** — `RAGManager.scheduleAutoReindex()`:
   - Early-returns when `getIncompatibleSpaceCount(activeSpace) === 0` (no-op on normal startup).
   - Deferred ~15s after cold start; pauses during live meetings; single-flight guarded.
   - Re-embeds through the durable queue, one meeting at a time — never a startup hammer
     on the user's Gemini key/cost.
5. **v16 DB migration** backfills legacy rows' `embedding_space` idempotently (only
   `embedding_provider IS NOT NULL AND embedding_space IS NULL`; `user_version`-gated).

## Canary / rollout strategy (desktop)

The desktop "rollout" is per-install and self-pacing — no fleet coordination needed:

1. **Ship** the build whose `GeminiEmbeddingProvider` default is `gemini-embedding-2`
   (already the case).
2. On first run post-upgrade, the active space becomes v2. Existing v1 meetings are
   detected as incompatible and **lazily** re-embedded in the background queue.
3. During the drain window: new content embeds as v2 immediately; old content is
   temporarily absent from RAG results (empty-not-wrong), reappearing as the queue drains.
4. Progress is surfaced via the `embedding:reindex-progress` toast.

## Rollback strategy

- **Desktop:** set `NATIVELY_GEMINI_EMBED_MODEL=gemini-embedding-001` (+ `NATIVELY_GEMINI_EMBED_DIMS=768`).
  The active space flips back to v1; the index re-aligns to v1 the same lazy way. No rebuild.
- **Server:** set `NATIVELY_EMBED_PRIMARY=gemini-embedding-001` (fallback already 001), or
  set `ENABLE_LEGACY_TEXT_EMBEDDING_004=true` if Google re-enables 004. No redeploy needed
  for the env flip; revert the commit for a full rollback. Server stores nothing, so rollback
  is instant and consequence-free.

## Verification plan (before declaring a desktop rollout done)
- [ ] After upgrade, confirm new meetings get `embedding_space = gemini:gemini-embedding-2:768`.
- [ ] Confirm `getIncompatibleSpaceCount` trends to 0 as the queue drains.
- [ ] Confirm a search during the drain returns only v2-space results (no v1 leakage).
- [ ] Confirm rollback env var flips the active space and re-aligns the index.

## Optional tooling (NOT run automatically)
- A maintenance command to force-requeue all meetings for re-index (manual, opt-in) —
  use only if a user reports stale recall that the lazy path hasn't drained. The lazy
  path should make this unnecessary in normal operation.
