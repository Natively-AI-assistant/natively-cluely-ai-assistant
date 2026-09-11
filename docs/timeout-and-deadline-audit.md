# Timeout & Deadline Audit

**Date:** 2026-09-08. Values cited from code; latencies measured against production.

## The rule this document exists to enforce

> An inner budget must be strictly smaller than the outer budget that contains it.

When they are equal, the inner operation can only ever fail by exhausting the
outer deadline first — so the caller receives the outer layer's generic error and
loses the specific one. When the inner is *larger*, the outer fires while work is
still in flight, and the result is discarded after being paid for.

Both faults were present. Both are fixed below.

---

## Client (Electron main process)

| # | Layer | Budget | Source |
|---|---|---|---|
| 1 | Per-file index job | unbounded (background) | `ModeHybridRetriever.indexFile` |
| 2 | Sub-batch retry budget | ≤ 2 retries, ≤ 20s each, jittered | `MODE_INDEX_RETRY_CAP_MS` |
| 3 | One batch embed call | **30,000 ms** | `EmbeddingPipeline.EMBED_TIMEOUT_MS` |
| 4 | One HTTP request | **25,000 ms** | `NativelyEmbeddingProvider.REQUEST_TIMEOUT_MS` |
| 5 | Query embed | 3,000 ms | `EmbeddingPipeline.QUERY_EMBED_TIMEOUT_MS` |
| 6 | Pipeline init wait | 15,000 ms | `EmbeddingPipeline.waitForReady` |
| 7 | Rerank | caller-supplied `rerankDeadlineMs` | `ModeContextRetriever.retrieveHybrid` |

**4 < 3 is the invariant.** It was 30,000 = 30,000, so a single stalled request
could only surface as the pipeline's generic "batch timed out" — and because the
provider splits a batch larger than 32 into sequential requests, **four** requests
shared one 30s budget. Now the batch is sized to the provider's ceiling
(`maxBatchSize`), so one batch is one request, and the request fails first with
its own message. Pinned by a test that reads both constants and asserts the
ordering.

Layer 2 sits *outside* layer 3 deliberately: a retry that slept inside the batch
deadline would consume the budget it is retrying into.

## Server (`natively-api`)

| Layer | Budget | Source |
|---|---|---|
| OpenRouter embed/rerank | 30,000 ms | `OPENROUTER_TIMEOUT_MS` |
| Gemini `embedContent` | 10,000 ms | `callEmbedModel` |
| Gemini batch wall clock | `EMBED_BATCH_DEADLINE_MS` | `lib/embeddingQuota.js` |
| Per-key rate limit | 120 req / min | `server.js` rate-limit registration |
| Fastify body limit | 1 MB (default) | — |

The server performs **no retry** on the managed Voyage path, deliberately. It is
stateless; the durable queue lives on the client. A backoff belongs to the party
that can persist its place in the work — sleeping inside the request would hold a
connection open and hide the condition from the system that must record it. The
server instead reports the condition precisely (429 + `Retry-After` + `retryable`)
and the client owns the wait.

## Provider-side limits (measured, not assumed)

| Limit | Value | How established |
|---|---|---|
| voyage-4 input window | 32,000 tokens | 200,000-char input reported exactly 31,993 tokens |
| Server per-input cap | 32,000 chars | chosen: ≤16k tokens even at ~2 chars/token |
| Rerank docs per request | 200 | server-enforced |
| Rerank total chars | 1,600,000 | = the old 200 × 8,000, so nothing regresses |
| OpenRouter project | 12,000,000 tokens/min | hit directly while probing |

## Deadline hierarchy for indexing

Upload returns immediately (`ModeReferenceFileIngestion` returns before indexing
starts); indexing is detached background work with durable per-file state. So the
brief's "do not solve long indexing by raising the HTTP timeout" is already
satisfied — there is no HTTP request to raise. The user's upload call never waits
on embedding.

## Remaining gap

Layer 1 has no overall deadline. A file that keeps hitting retryable failures
retries per sub-batch, keeps its embedded prefix, and stops — bounded in work but
not in wall-clock. Acceptable today because the work is bounded and resumable;
worth a ceiling if indexing ever moves somewhere it can block a user action.
