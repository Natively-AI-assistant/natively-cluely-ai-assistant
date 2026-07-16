# Natively — Memory, Loops & Lifecycle Audit (Phase 1)

_Production-hardening audit, 2026-07-11._

> **Reconstruction note**: rebuilt after a shared-workspace branch switch lost
> the original working-tree file (see `AUDIT_VERIFICATION_REPORT.md`). Content
> matches the original; all cited fixes were independently re-verified present
> in the final working tree before this file was rewritten.

Each candidate was **verified against the real code** before any fix. Prior
static audits of this repo were repeatedly wrong, so verdicts below cite exact
evidence and several loudly-claimed leaks are **refuted**.

## Fixed

### [P2 — FIXED] LocalWhisperSTT: zombie streaming loop on worker-spawn failure

**File:** `electron/audio/LocalWhisperSTT.ts` `start()`.

**Problem.** `start()` sets `isActive=true`, creates the VAD, calls
`spawnWorker().catch(...)`, then **unconditionally** `startStreamingLoop()`. When
`spawnWorker()` throws (e.g. `hasEnoughMemoryForOnnxSession()` refuses on a
low-memory machine), the old catch only logged + `emit('error')`. It left a
self-chaining 12s streaming timer running with `worker === null` forever
(every audio segment silently dropped at `dispatchFinal`'s `if (!this.worker) return`),
and the `VadProcessor` retained until an external `stop()` the supervisor
never calls on this path.

**Fix.** The spawn-failure catch now tears the instance back to a clean
inactive state — `stopStreamingLoop()`, clear `gapFlushTimer`, `vad = null`,
`isActive = false`, `workerReady = false` — before re-emitting the error.
`write()` already no-ops on `!isActive || !vad`.

**Test:** `electron/audio/__tests__/LocalWhisperSpawnFailTeardown2026_07_10.test.mjs`.

### [P1 — FIXED] LLMHelper: unbounded read-phase on `generateWithNatively`

**File:** `electron/LLMHelper.ts` `generateWithNatively`.

The 8s `AbortSignal.timeout` covered only `fetch` (connect + headers).
`await response.json()` had no bound. Added a 45s overall-deadline
`AbortController` combined via `AbortSignal.any([...])`, cleared in a
`finally` on every exit path.

### [P1 — FIXED] LLMHelper: `chatWithCurl` axios call had no timeout

**File:** `electron/LLMHelper.ts:~3187`. Added `timeout: 60_000`.

### [P3 — FIXED] EmbeddingPipeline: space-label race on success path

**File:** `electron/rag/EmbeddingPipeline.ts` `getEmbeddingsWithFallback`.

The success path re-read `this.provider`/`getActiveSpaceKey()` **after** the
await. A concurrent `promoteFallbackProvider()` could relabel embeddings from
the OLD provider with the NEW provider's space, corrupting cosine
comparability of persisted vectors. Fixed by capturing `const active =
this.provider` before the await.

**Test:** behavioral race case added to `electron/rag/__tests__/EmbeddingFallbackSinglePath.test.mjs`.

### [P2 — FIXED] DatabaseManager: `foreign_keys` pragma silently premium-dependent

Covered in full in `AUDIT_AI_CONTEXT_OWNERSHIP.md`'s sibling finding — FK
enforcement previously only ran via the premium `KnowledgeDatabaseManager`
constructor on the shared connection. If premium failed to load, cascade
deletes (`deleteMeeting`/`deleteMode`/`deleteKnowledgePack`) would orphan
child rows. Fixed by enabling `PRAGMA foreign_keys = ON` directly in
`DatabaseManager.initialize`.

**Test:** `electron/db/__tests__/ForeignKeyCascade2026_07_10.test.mjs`.

## Refuted (no fix — premise false)

### [REFUTED] Unbounded renderer state (messages / rollingTranscript / voiceInput)
`rollingTranscript` is capped at `ROLLING_TRANSCRIPT_MAX_CHARS = 8192`
(`rollingTranscriptState.ts`, applied on every merge). `voiceInput` is
cleared per recording turn. All three are cleared on `onSessionReset`.
`messages` grows only at human interaction pace and is cleared on reset.

### [REFUTED] VectorStore worker leak / uncapped respawn
`VectorStore.destroy()` exists and **is** wired into quit: `RAGManager.dispose()`
→ `main.ts`'s `before-quit` handler. Respawn is lazy-on-next-search, not a loop.

### [REFUTED] EmbeddingPipeline fallback-promotion "torn write"
The promotion itself is a single synchronous idempotent assign guarded by
`if (this.provider === fallback) return`. Only the success-path label read
was racy (fixed above).

### [REFUTED] `RestSTT.write()` unbounded `chunks[]`
`flushAndUpload` drains the buffer synchronously before the network `await`;
the 10s safety-net + 30s axios timeout bound any unflushed window.

### [REFUTED] `MeetingPersistence`/`saveMeeting` unbounded transcript write
`SessionTracker.getFullTranscript()` (the actual source `saveMeeting` reads)
is bounded — `compactTranscriptIfNeeded()` fires above 1800 raw segments,
evicting the oldest 500 into an LLM-summarized epoch. Benchmarked a synthetic
1800-row `better-sqlite3` transaction under the real Electron ABI: **1.1ms**,
not "seconds."

## Noted (addressed in later phases)

- **ModelPreloader stale error/exit listeners** double-firing after worker
  handoff, silently poisoning a 5-minute pre-warm cooldown — found and fixed
  in Phase 7 (`AUDIT_AUDIO_REALTIME_PIPELINE.md`).
- **`unhandledRejection` unconditionally killing the database** on the first
  occurrence — the most severe finding of the whole audit, found in Phase 9
  (`AUDIT_ERROR_OBSERVABILITY.md`), not originally flagged in this phase's
  scan because it required tracing the full `uncaughtException`/`unhandledRejection`/
  `emergencyCloseDatabase` interaction, which Phase 9 was dedicated to.
