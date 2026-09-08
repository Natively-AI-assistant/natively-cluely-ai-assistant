# Embedding & Reranking — Operational Runbook

## Is it working?

```
curl -s https://api.natively.software/admin/health-detail \
  -H "x-admin-secret: $ADMIN_SECRET" | jq '.embedding'
```

`embedding.managed.configured: false` is the single most important field — it
means `OPENROUTER_API_KEY` is unset and **every** `voyage-4` and
`rerank-2.5-lite` request is being refused. Desktop clients then fall back to
whatever local embedder they have, which is a silent quality drop, not an outage.

`embedding.telemetry.by_model_attempts` reports success/failure per model,
including voyage-4, so a one-sided failure is visible.

## Error taxonomy — what each response means

| Client sees | Meaning | Action |
|---|---|---|
| `429 provider_rate_limited` | **OpenRouter's** limit, not a Natively quota. Carries `Retry-After`. | None. Clients back off automatically. Sustained → raise the OpenRouter plan. |
| `429 RESOURCE_LIMIT_EXCEEDED` + `resource` | A Natively **quota** refusal. | Customer needs a larger plan or a reset. |
| `502 provider_rejected_request` | Permanent. `retryable: false`. | A malformed request or a model/config problem. Retrying will not help. |
| `503 embedding_unavailable` / `rerank_unavailable` | Transient: upstream 5xx, timeout, network. | Self-heals. Investigate if sustained. |

The two 429s are different failures and must not be confused. A quota refusal
names a `resource` (one of five metered resources); a provider rate limit names a
`subsystem` (`embedding` / `reranking`).

## Known ceilings

| Ceiling | Value | Symptom when hit |
|---|---|---|
| OpenRouter project | 12,000,000 tokens/min | intermittent `429 provider_rate_limited` under bulk indexing |
| Natively per-key | 120 requests/min | `rate_limited` from the Fastify limiter |
| Per embed input | 32,000 chars | response carries `truncated: N` |
| Per rerank document | 32,000 chars | response carries `truncated: N` |
| Rerank documents | 200 | `400 too many documents` |
| Rerank total input | 1,600,000 chars | `400 documents too large` |

**A `truncated` field in a 200 response is not an error but is a signal**: the
caller sent something larger than the model can read, and the vector or ranking
covers only the first N characters.

## Common situations

**"Indexing seems stuck."** Indexing is background, per-file, and bounded to 2
concurrent files process-wide. A large file behind another large file waits by
design. `__e2e__:index-status` (dev builds) reports real state including
`embeddedChunkCount`.

**"A file answers questions about its beginning but not its end."** Historically
this was a partial index that could never complete. Since 2026-09-08 a partial
file reports `pending` and the next mode activation finishes the tail. If it
persists, check the client log for repeated sub-batch failures.

**"Embeddings stopped after a model change."** Expected. The space key
(`natively:voyage-4:2048`) is part of every stored vector; changing model or
width invalidates them and triggers an automatic re-index. Vectors are never
compared across spaces.

**A spike in 429s during bulk indexing** is the OpenRouter project ceiling, and
benchmarking counts against it. Do not read it as a customer-facing outage rate
without checking what else was running.

## Configuration

Server: `OPENROUTER_API_KEY` (**required**), `OPENROUTER_BASE_URL`,
`OPENROUTER_TIMEOUT_MS`, `VOYAGE_INPUT_CHAR_CAP`, `RERANK_CHAR_CAP`,
`RERANK_TOTAL_CHAR_BUDGET`, `RATE_LIMIT_MAX`.

Outbound token budgets: `VOYAGE_DIRECT_TPM` (3,000,000), `OPENROUTER_TPM`
(8,000,000), `VOYAGE_PER_KEY_SHARE` (0.5), `VOYAGE_LIMITER_WAIT_MS` (15,000).

## Outbound token limiter

`RATE_LIMIT_MAX` caps **requests** per key (120/min). The providers cap
**tokens**, account-wide. Only the first was enforced, which is why a rerank of
58 documents could 429 in 700ms while 50 and 60 succeeded — nothing knew how much
a request was about to spend. `lib/tokenLimiter.js` gives each route a token
bucket and reserves against it before every upstream call.

**`OPENROUTER_TPM` is derived from measurement** (~12,000,000/min observed);
the default sits under it, because a limiter set AT a ceiling still lets bursts
reach it.

**`VOYAGE_DIRECT_TPM` IS A GUESS.** Voyage publishes rate limits only behind an
account login and they vary by tier. Tune it from evidence:

    curl -H "x-admin-secret: $ADMIN_SECRET" $API/admin/health-detail \
      | jq .embedding.managed.outbound_budget

* `utilisation` near 1.0 with **no** upstream 429s → the ceiling is higher than
  configured. Raise it.
* Upstream 429s (`provider_rate_limited` in logs) while utilisation is below 1.0
  → the real ceiling is lower. Lower it.
* `refusedDeadline` rising → clients are being shed by **us**. They receive
  `429 outbound_budget_exhausted`, which is retryable and carries a Retry-After.
* `refusedProbe` rising is **normal and not shedding** — it counts the
  non-blocking "budget right now?" question the route loop asks each route, and
  those usually end in a successful failover to the other route.
* `waitedMs / waited` is the latency the pacing costs, in ms per waiting request.

A squeeze on one route is a **failover**, not an error: the loop asks each route
without waiting, and only waits when every route is dry. `VOYAGE_LIMITER_WAIT_MS`
bounds that wait and must stay below the desktop client's 25s request timeout —
waiting past it spends budget on a response nobody is listening for.

One worst-case rerank is **2,000,000 tokens** (`MAX_SINGLE_REQUEST_TOKENS`: the
estimator charges the query once per document, so a capped query costs 200x).
The limiter raises a key's share to admit one of those; if it could not, such a
request would wait out its whole deadline for room nothing could free. If you
lower `VOYAGE_DIRECT_TPM` below that, those reranks are refused outright and the
server logs it loudly at startup of the first request on that route.

Client: `NATIVELY_MODE_INDEX_EMBED_BATCH` (100, clamped to the provider's 32),
`..._LOCAL` (16 — higher SIGTRAPs the ONNX arena), `..._BATCH_CHARS` (24,000),
`..._MAX_CONCURRENT_FILES` (2), `..._BATCH_RETRIES` (2), `NATIVELY_API_URL`.

## Deploy checklist

1. `OPENROUTER_API_KEY` set on Railway.
2. `node scripts/check-tracked-imports.mjs --index` — **`--index`, not the
   default**: the default checks `HEAD`, so with a modified `server.js` it reads
   the committed copy and reports a false green while a new lib is untracked.
3. Migrations applied (015 is current; the Voyage work added none).
4. After deploy, confirm `embedding.managed.configured: true`.
5. Watch `embedding.managed.outbound_budget` for a day and tune
   `VOYAGE_DIRECT_TPM` per the section above — the shipped default is a
   conservative guess, not this account's measured ceiling.

## Cost

`usage_events` has **no cost column**. OpenRouter's measured per-call
`usage.cost` reaches telemetry only. A `voyage4` / `rerank25lite` price card must
exist in natively-control or those ledger rows price as `no_effective_card`.
