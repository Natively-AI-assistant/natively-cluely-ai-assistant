# Embedding & Retrieval Architecture — Current-State Audit

**Date:** 2026-09-08
**Scope:** document ingestion → chunking → embedding → vector storage → retrieval → reranking, across the Electron client and `natively-api`.
**Status:** Phase 0/1 deliverable. No production code changed for this document.

Every architectural claim below cites the code it came from. Where a widely-assumed
design turns out not to match the repository, that is called out explicitly rather
than smoothed over.

---

## 0. The finding that governs every other one

**Natively's document ingestion is not server-side. It runs entirely in the
Electron main process, on the end user's machine, against a local SQLite
database.**

`natively-api` is a *stateless* embedding/rerank API. It holds no documents, no
chunks, no vectors, no ingestion jobs, and no per-document state. Its only
persistent state is billing (`usage_events`, `api_keys` counters).

Evidence:

| Concern | Where it actually lives |
|---|---|
| File parsing/extraction | `electron/services/SafeDocumentTextExtractor.ts` (client) |
| Chunking | `electron/services/modes/semanticChunker.ts`, `DocumentMap.ts` (client) |
| Embedding orchestration | `electron/rag/EmbeddingPipeline.ts` (client) |
| Vector storage | `electron/rag/VectorStore.ts` → local SQLite (client) |
| Retrieval + rerank | `electron/services/modes/ModeHybridRetriever.ts` (client) |
| Embedding **compute** | `natively-api` `POST /v1/embed` (stateless) |
| Rerank **compute** | `natively-api` `POST /v1/rerank` (stateless) |

**Consequences for any proposed design:**

1. There is no multi-tenant ingestion queue to schedule, because there is no
   server-side ingestion. "Ten users uploading simultaneously" is ten independent
   desktop processes, each with its own private SQLite queue, making ordinary HTTP
   calls to a stateless endpoint.
2. **Fairness between users is a server rate-limiting concern, not a scheduling
   concern.** It is already implemented as a per-API-key limiter
   (`server.js:461-467`, `max: 120/minute`, keyed on a hash of the API key —
   `server.js:484-486`). No user can starve another through a shared queue,
   because no shared queue exists.
3. The scheduling problem that *does* exist is **intra-app**: one 400-chunk
   background index competing with the same app's interactive query embedding.
   That is a priority problem inside one process, not a fairness problem between
   tenants.
4. Durable job state, leases and worker recovery belong in **client SQLite**.
   Adding server-side job tables would create a second, parallel system that owns
   none of the data it would be describing.

Introducing Redis/BullMQ or server-side `indexing_jobs` tables would therefore be
infrastructure for a topology Natively does not have.

---

## A. Actual request flow

There are **three** distinct ingestion paths, not one. They do not share a chunker,
a queue, or a state model.

### A1. Reference documents (the path the brief is about)

```
User picks a file (Modes settings)
  → IPC  ipcHandlers.ts
  → ingestModeReferenceFile()            electron/services/ModeReferenceFileIngestion.ts:60
  → extractSafeDocumentText()            electron/services/SafeDocumentTextExtractor.ts
  → ModesManager.addReferenceFile()      persists row + content
  → RETURNS TO USER IMMEDIATELY  ◄── upload is already non-blocking
  → void (async () => manager.indexReferenceFile(file))()   :74-88  ◄── detached
       → ModeContextRetriever.indexReferenceFile()          ModeContextRetriever.ts:1746
       → ModeHybridRetriever.indexFile()                    ModeHybridRetriever.ts:478
            → single-flight per fileId (in-memory Map)      :479-484
            → content-hash + embedding-space skip check     :492-503
            → chunkText()                                   :745-777
            → embed in bounded sub-batches                  :556-625
            → persistChunks() + updateIndexState()
```

### A2. Meetings / transcripts

```
Meeting ends → RAGManager → TranscriptPreprocessor → SemanticChunker (speaker turns)
  → EmbeddingPipeline.queueMeeting()      electron/rag/EmbeddingPipeline.ts:347
  → INSERT OR IGNORE INTO embedding_queue (DURABLE, SQLite)
  → processQueue()  ← drains on next launch after a crash
```

### A3. Knowledge packs / Profile Intelligence

```
Upload → KnowledgeManager.generateForFile()  (synchronous, ~300-500ms)
  → KnowledgeIndexQueue    electron/services/knowledge/KnowledgeIndexQueue.ts
     in-process, single-flight per file, EXPLICITLY not persisted (:10-15)
```

### A4. Retrieval (query time)

```
query → ModeContextRetriever.retrieveHybrid()      ModeContextRetriever.ts:1764
      → ModeHybridRetriever.retrieve()
          → FTS/BM25 lexical arm  +  vector arm (cosine over persisted BLOBs)
          → merge → top-K → reranker (RerankerRegistry seam)
          → token-budgeted context → LLM
```

Retrieval is **hybrid, not vector-only** (`ModeContextRetriever.ts:1682-1683`).
This matters: a total embedding outage degrades quality but does **not** break
retrieval.

---

## B/C/D. Chunking — already hierarchical and boundary-aware

`ModeHybridRetriever.chunkText()` (`:745-777`) dispatches across three chunkers by
document shape:

1. **Tabular** (`tabularChunks`) — CSV/TSV chunked by row with the header repeated,
   because a giant undifferentiated table blob "caused fabricated figures on
   datasets".
2. **Structured** (`buildDocumentMap` + `sectionAwareChunksFromMap`) — real ToC +
   numbered sections; **excludes the ToC** and tags each chunk `[Section N.N | pX-Y]`.
3. **Flat prose** (`semanticChunks`, `semanticChunker.ts`) — boundary-driven with
   heading-path prefixes.

`semanticChunker.ts:1-45` documents three guardrails: a **merge floor (~100
tokens)**, a **soft target (~350 tokens)**, and a hard ceiling — with the explicit
design statement that *"chunk boundaries are SEMANTIC UNITS and size is an outcome,
not the other way round."*

It also records the measurement that motivated it: heading-path prefixes plus entity
anchoring took top-1-correct-project from **1/5 to 5/5** (project precision 0.60 vs
0.08), and that **chunk size was measured not to be the problem** — budget survival
was 25/25 at every size up to 1250 tokens.

`CHUNKER_VERSION = 2` (`semanticChunker.ts:99`) is folded into the index hash
(`ModeHybridRetriever.ts:292`), so a chunker change invalidates stored chunks.

**Assessment: Phases 4 and 5 of the brief are substantially already implemented,
with measured justification. A rewrite would discard evidence, not add it.** The
legacy fixed-window constants (`CHUNK_WORDS = 140`, `CHUNK_OVERLAP = 30`,
`:121-122`) remain in use for the *section-aware* path only.

---

## E. Reranking

A seam with pluggable ports (`electron/services/reranking/RerankerRegistry.ts`):

- **local ONNX** (`LocalReranker.ts`, bundled `ms-marco-MiniLM-L-6-v2`) — default
- **local GGUF** via extension (`GgufReranker.ts`)
- **hosted BYOK** — OpenRouter, Jina (`hostedRerankProviders.ts`)
- **hosted managed** — Natively `rerank-2.5-lite` (added 2026-09-08)

Gated by `evaluateHostedEligibility` (`rerankerConfig.ts:96`), which checks
local-only mode and the `reference_files` privacy scope **before** key/model —
so a privacy-denying user is told the truth rather than invited to fix a key.

Failure policy is *fail-closed to existing order*: `OpenRouterReranker.rerank()`
returns `null` on any failure and the caller keeps its ranking
(`OpenRouterReranker.ts:164-171`).

---

## F. Vector store

Local SQLite. Two stores:

- `chunks` + `embedding_queue` + `meetings` (meeting path) — `DatabaseManager.ts:525`
- `mode_reference_chunks` + `mode_reference_index_state` (document path) —
  created in `ModeHybridRetriever.ensureIndexTable()` `:360-385`

Vectors are `Float32Array` BLOBs. Every row carries `embedding_space`
(`${provider}:${model}:${dims}`) and retrieval filters on it before cosine
(`VectorStore.ts:260,306`) — the guard against mixing incompatible spaces.

---

## H. Timeout / deadline map (client)

| Layer | Value | Source |
|---|---|---|
| Pipeline batch embed | **30,000 ms** for the whole batch | `EmbeddingPipeline.ts:21` |
| Query embed | 3,000 ms | `EmbeddingPipeline.ts:26` |
| Pipeline init wait | 15,000 ms | `EmbeddingPipeline.ts:296` |
| Natively provider HTTP | 30,000 ms | `NativelyEmbeddingProvider.ts:31` |
| Retry-After honoured, capped | ≤ 30,000 ms | `EmbeddingPipeline.ts:64-71` |
| Rerank deadline | caller-supplied `rerankDeadlineMs` | `ModeContextRetriever.ts:1826` |

Server side: `OPENROUTER_TIMEOUT_MS` 30,000; rate limit 120/min per key;
embed upstream 10,000 ms for Gemini.

---

## I/J. Concurrency and retry — what exists

- **Single-flight per file** (`inflightIndex`, `:479-484`) and per meeting.
- **Bounded sub-batching**, provider-aware: `MODE_INDEX_EMBED_BATCH = 100`
  hosted, `= 16` for local ONNX — the local cap exists because a large document
  "takes the whole process down with a native SIGTRAP" (`:128-150`).
- **Retry with `Retry-After` + jitter** (`EmbeddingPipeline.ts:47,63-71`).
- **Circuit breaker / health slots** server-side (`providerHealth`, `tryEmbedSlot`).
- **ForegroundGate.waitUntilIdle()** — background embedding yields while the user
  is active. A genuinely good mechanism the brief does not mention.
- **Lexical fallback** — retrieval survives total embedding failure.

---

## M. Index state model (document path)

`mode_reference_index_state`: `file_id`, `file_hash`, `indexed_at`, `chunk_count`,
`status`, `embedding_space` (`:360-385`).

States observed: `pending`, `indexing`, `ready`, `lexical_only`, `ocr_required`,
`failed`.

Idempotency is content-hash based (`:492-498`): a file whose hash and embedding
space are unchanged and whose status is `ready` is skipped entirely. **Phase 10 of
the brief is already satisfied**, and `indexHash` folds in `CHUNKER_VERSION`.

---

## O. Bottlenecks and failure modes — the genuine gaps

These are the findings that justify work. Everything above is already sound.

### GAP-1 (correctness, HIGH) — a partially embedded file never completes

`indexFileInner` embeds in sub-batches. On a mid-file failure it keeps the embedded
prefix, stores the tail as lexical-only, and marks the file **`ready`** (`:614-623`),
with the comment *"A follow-up prewarm/retry can complete the tail when quota frees
up."*

No such path exists:

- `ModesManager.prewarmModeReferenceIndex` re-indexes only files where
  `status !== 'ready'`.
- `indexFileInner` early-returns when `status === 'ready'` and hash/space match
  (`:496-498`).

So a large file that hits one 429 mid-index keeps an unembedded tail **permanently**,
until its content changes or the embedding model changes. The state table has
`chunk_count` but **no `embedded_chunk_count`**, so the system cannot even detect
the condition, let alone resume from it. This is the single most valuable fix
available.

### GAP-2 (reliability, HIGH) — client batch of 100 vs server cap of 32, under one timeout

`MODE_INDEX_EMBED_BATCH = 100` (`:128`). The server refuses batches over
`DEFAULT_MAX_BATCH = 32` (`lib/embeddingQuota.js:22`). `NativelyEmbeddingProvider`
absorbs this by splitting into ceil(100/32) = **4 sequential HTTP calls**
(`NativelyEmbeddingProvider.ts:235-236`) — all inside the **single 30-second**
`EMBED_TIMEOUT_MS` that wraps the whole batch (`EmbeddingPipeline.ts:680-695`).

Measured production latency (this session, n=20 batches of 32): p50 **1199 ms**,
p95 **1871 ms**. Four sequential calls ≈ 4.8-7.5 s nominal — safe in the good case.

The defect is the **timeout nesting**, and it is structural rather than probabilistic.
Each of the four HTTP calls carries its own `AbortSignal.timeout(REQUEST_TIMEOUT_MS)`
of **30,000 ms** (`NativelyEmbeddingProvider.ts:31`), while the pipeline allows
**30,000 ms for all four combined** (`EmbeddingPipeline.ts:695`). The inner
per-call budget therefore *equals* the outer whole-batch budget: any single call
that reaches its own timeout has already exhausted the entire outer deadline, and
a 100-chunk batch gives that four independent chances to happen.

Note the batch path has **no retry loop** — the `QUERY_RETRY_ATTEMPTS` loops at
`:735` and `:871` are on the query path only. So a failure is terminal for the
batch: all 100 chunks are discarded, not just the failing 32. That failure then
lands in the partial-index branch, where **GAP-1 makes it permanent.** The two
gaps compose, and that composition is the realistic large-file failure mode.

### GAP-3 (throughput) — batching counts chunks, not tokens

Batch size is a chunk count. A batch of 100 × 350-token chunks and 100 × 30-token
chunks are treated as identical work. With the server's per-item cap now 32,000
chars, worst-case payload per batch grew accordingly. No token-aware budget exists
client-side.

### GAP-4 (scheduling) — no cross-file concurrency limit

Each file's index loop is independent. Uploading five files starts five concurrent
batch loops, each up to 100 chunks, against a 120 req/min key limit. `ForegroundGate`
throttles by user activity, not by in-flight request count.

### GAP-6 (reliability + observability, HIGH) — every upstream failure becomes an opaque 503

**Measured on production, 2026-09-08.** Reranking a realistic candidate set fails
intermittently: 50 documents OK, 58 fails, 60 and 62 OK; 30 documents x 12
repetitions OK, x16 and x20 fail. Failures return in **619-775 ms** — far too fast
to be the 30 s timeout. The identical payloads sent **directly to OpenRouter
succeed** (60 docs = 12,120 tokens, 80 docs = 16,180 tokens), and the same payloads
against a LOCAL instance of the same commit succeed. So it is neither the model nor
the request shape.

The signature matches OpenRouter's project-wide limit, which this session hit
directly while probing: `HTTP 429: "You have exceeded the project's Tokens Per
Minute (TPM) rate limit of 12,000,000 tokens per minute"`.

The defect is what the server does with it. `callOpenRouter` carefully records the
upstream status:

```js
err.embedReason = classifyEmbedHttp(res.status, body)   // server.js:5273, 5479
err.httpStatus  = res.status                            // server.js:5274, 5480
```

and both routes then discard all of it:

```js
} catch (err) {
  console.error('[/v1/rerank] Failed:', err.message)
  return reply.code(503).send({ error: 'rerank_unavailable' })   // and embedding_unavailable
}
```

Consequences:

1. A **retryable** 429 is indistinguishable from a genuine outage, so a client
   cannot tell "back off and retry" from "this is broken".
2. The upstream `Retry-After` is dropped, so any client backoff is a guess.
3. There is **no server-side retry** on the rerank/embed Voyage path at all, unlike
   the Gemini path which has health slots and a breaker.
4. On the client this surfaces as a failed sub-batch, which lands in the
   partial-index branch — where **GAP-1 makes it permanent**. GAP-6, GAP-2 and
   GAP-1 form the full large-file failure chain.

This one was introduced by the Voyage work earlier today, not inherited.

### GAP-5 (observability) — no durable progress

Progress is `chunk_count` only. The UI cannot show "1,284 / 1,760 embedded" because
the embedded count is never persisted. `emitModeFileIngestDebug` reports it to the
debug log (`:512-530`) but nothing stores it.

---

## P. Benchmark baseline (measured this session, production API)

440 questions over four corpora, two-stage retrieval, `voyage-4` @2048 +
`rerank-2.5-lite`, via `api.natively.software`:

| corpus | vec@1 | vec@20 | rerank@1 | % of ceiling |
|---|---|---|---|---|
| 4k tok / 16 chunks | 73.3% | 100% | **100.0%** | 100% |
| 8k tok / 33 chunks | 70.0% | 100% | **100.0%** | 100% |
| 32k tok / 128 chunks | 57.9% | 92.9% | **92.1%** | 99.2% |
| 100k tok / 400 chunks | 41.9% | 85.0% | **84.4%** | 99.3% |

Latency (client-observed, n=440 each): query embed p50 **665 ms** / p95 1048;
rerank(20 docs) p50 **744 ms** / p95 1030; batch embed(32) p50 **1199 ms**.

**The reranker recovers 99-100% of everything the vector stage surfaces.** Retrieval
loss at scale is vector recall@K, not rerank quality.

Provider limits, measured: server per-input cap **8,000 chars → raised to 32,000**
today; `voyage-4` window 32,000 tokens (Voyage truncates silently at it — a
200,000-char input reported exactly 31,993 tokens); OpenRouter project limit
**12,000,000 tokens/minute**.

---

## Summary: build vs reuse

| Brief phase | Verdict |
|---|---|
| 4, 5 — semantic chunking | **Already implemented**, measured. Reuse. |
| 8, 9 — durable job system | Exists for meetings (`embedding_queue`). **Missing for documents.** |
| 10 — idempotency/dedup | **Already implemented** (content hash + space + chunker version). |
| 11, 35 — cross-user fairness | **Not applicable** — no server-side ingestion. Server rate limiter already isolates keys. |
| 12, 13 — concurrency/token limits | Partial: bounded batches yes, token-aware and cross-file no. → GAP-3, GAP-4 |
| 14 — adaptive concurrency | Not present. Low priority given per-key rate limiting. |
| 15, 16 — retries/breaker | **Already implemented** both sides. |
| 17, 18 — large files | Works; capped. GAP-1 makes large files *silently partial*. |
| 19 — progress UI | Blocked on GAP-5 (no durable embedded-count). |
| 20-22 — rerank/retrieval quality | **Benchmarked this session.** |
| 33, 34 — job tables/leases | Belongs in client SQLite, not server. Scope to GAP-1. |

**Recommended order of work, highest value first:** GAP-6 (measured failing in
production now), GAP-1 (correctness), GAP-2 (reliability), GAP-5 (enables the
progress UI), GAP-4, GAP-3.

GAP-6, GAP-2 and GAP-1 are one causal chain and should be fixed together: an
upstream 429 is misreported as fatal (GAP-6), which fails a whole 100-chunk batch
(GAP-2), which marks the file permanently half-indexed (GAP-1).

Anything beyond that list would be building infrastructure for a topology this
application does not have.
