# Embedding & Retrieval Architecture (target state)

Companion to `embedding-architecture-audit.md` (current state) and
`timeout-and-deadline-audit.md`. Describes what the system is after the
2026-09-08 changes, and — as importantly — what was deliberately **not** built.

## Shape

Ingestion is a **desktop, single-tenant pipeline**. `natively-api` is a stateless
embed/rerank compute endpoint. This is the fact that determines everything else.

```
Electron main process (one user, local SQLite)
  upload → extract → chunk → [index gate] → batch → embed ──HTTP──► natively-api
                                   │                                     │
                          durable per-file state                   stateless
                     (mode_reference_index_state)              voyage-4 / rerank-2.5-lite
                                   │                                     │
                          persisted chunks + vectors ◄──────────────────┘
                                   │
                    hybrid retrieval (BM25 + vector) → rerank → LLM
```

## What was NOT built, and why

| Proposed | Decision |
|---|---|
| Server-side `indexing_jobs` / worker leases | **Rejected.** The server holds no documents, chunks or vectors. Job tables there would describe data that lives on the client. |
| Cross-user fair scheduler | **Rejected.** No shared queue exists to be unfair. Isolation is already per-API-key rate limiting (120/min). |
| Redis / BullMQ | **Rejected.** Client SQLite is already durable and already used for exactly this (`embedding_queue`). |
| New chunker | **Rejected.** The existing one is hierarchical, format-aware and measured (heading paths took top-1-correct-project 1/5 → 5/5). Replacing it would discard evidence. |
| Adaptive concurrency controller | **Deferred.** Per-key rate limiting plus bounded concurrency plus server-directed backoff covers the observed failure mode. An unstable controller would be worse than none. |

## Chunking (unchanged — already correct)

Three chunkers dispatched by document shape: tabular (row-wise, header repeated),
section-aware (ToC excluded, `[Section N.N | pX-Y]` tags), flat prose (heading-path
prefixed). Guardrails: **merge floor ~100 tokens, soft target ~350, hard ceiling**,
with `CHUNKER_VERSION` folded into the index hash so a chunker change invalidates
stored chunks. Size is an outcome of boundaries, not a target.

At ~350 tokens the chunks are ~1/90th of the 32,000-token provider window. The
provider limit is a safety invariant, never a chunk size.

## Embedding

- **One model, one vector space:** `voyage-4` @ 2048, space key
  `natively:voyage-4:2048`. Every stored row carries its space and retrieval
  filters on it before cosine.
- **Batching (GAP-3):** bounded by item count **and** characters —
  `min(configured, provider.maxBatchSize)` items, ≤24,000 chars per request. One
  caller batch is now exactly one upstream request.
- **Concurrency (GAP-4):** a process-wide gate of 2 concurrent files. Chosen for
  the foreground query path's latency, not for throughput.
- **Retry (Phase 15):** ≤2 retries per sub-batch, honouring the server's
  `Retry-After`, capped at 20s, jittered so files resuming after one rate limit
  do not re-create it. A `retryable: false` verdict is never retried.
- **Idempotency (Phase 10):** content hash + embedding space + `CHUNKER_VERSION`.
  Unchanged files are skipped without a provider call.
- **Resumability (GAP-1):** `embedded_chunk_count` distinguishes a complete file
  from a partially embedded one, and a partial file reports `pending` so the next
  mode activation completes its tail.

## Failure semantics

The server classifies rather than flattens:

| Upstream | Response | `retryable` |
|---|---|---|
| 429 / out of credits | 429 `provider_rate_limited` + `Retry-After` | true |
| permanent 4xx | 502 `provider_rejected_request` | **false** |
| 5xx / timeout / network | 503 (legacy string kept) + `Retry-After` | true |

Retrieval degrades rather than breaks: it is hybrid, so a total embedding outage
loses vector ranking but keeps BM25. A file that cannot embed is stored as
`lexical_only` and remains searchable.

## Configuration

| Env | Default | Effect |
|---|---|---|
| `NATIVELY_MODE_INDEX_EMBED_BATCH` | 100 | items/batch, clamped to provider max (32) |
| `NATIVELY_MODE_INDEX_EMBED_BATCH_LOCAL` | 16 | local ONNX; higher SIGTRAPs the process |
| `NATIVELY_MODE_INDEX_EMBED_BATCH_CHARS` | 24,000 | chars/request |
| `NATIVELY_MODE_INDEX_MAX_CONCURRENT_FILES` | 2 | process-wide index concurrency |
| `NATIVELY_MODE_INDEX_BATCH_RETRIES` | 2 | retries per sub-batch |
| `VOYAGE_INPUT_CHAR_CAP` (server) | 32,000 | per-input cap |
| `RERANK_CHAR_CAP` / `RERANK_TOTAL_CHAR_BUDGET` | 32,000 / 1,600,000 | rerank caps |
| `OPENROUTER_API_KEY` (server) | — | **required**, else managed models 503 |

## Operational notes

- `GET /admin/health-detail` → `embedding.managed.configured` is the single field
  that says whether managed models can be served at all.
- A rise in 429 `provider_rate_limited` means the **OpenRouter project** TPM
  ceiling (12M/min), not a Natively quota. Natively quota refusals use
  `RESOURCE_LIMIT_EXCEEDED` with a `resource`, never `subsystem`.
- `usage_events` has no cost column; measured per-call cost reaches telemetry
  only. A `voyage4` / `rerank25lite` price card must exist in natively-control or
  those rows price as `no_effective_card`.
