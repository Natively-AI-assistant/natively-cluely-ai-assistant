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

Outbound token budgets: `VOYAGE_DIRECT_EMBED_TPM` (6,000,000),
`VOYAGE_DIRECT_RERANK_TPM` (3,000,000), `OPENROUTER_TPM` (8,000,000),
`VOYAGE_PER_KEY_SHARE` (0.5), `VOYAGE_LIMITER_WAIT_MS` (15,000).

## Outbound token limiter

`RATE_LIMIT_MAX` caps **requests** per key (120/min). The providers cap
**tokens**, account-wide. Only the first was enforced, which is why a rerank of
58 documents could 429 in 700ms while 50 and 60 succeeded — nothing knew how much
a request was about to spend. `lib/tokenLimiter.js` gives each route a token
bucket and reserves against it before every upstream call.

### The upstream's real limits (Voyage Tier 1, confirmed 2026-09-08)

|                   | RPM   | TPM       | max/request          | other |
|-------------------|-------|-----------|----------------------|-------|
| `voyage-4`        | 2,000 | 8,000,000 | 320,000 tokens       | 1,000 inputs, 32K context, dims 256/512/1024/2048 (**default 1024**) |
| `rerank-2.5-lite` | 2,000 | 4,000,000 | 600,000 processed    | 1,000 docs, query ≤ 8,000 tok, query + any one doc ≤ 32,000 tok |

Tier 1 is "payment method on file". **Tier 2 (≥ $100 paid) doubles TPM** to
16M/8M; Tier 3 (≥ $1,000) reaches 24M. This account is Tier 1 — raising the
budgets past the table above needs a tier change, not a config change.

**The two models have DIFFERENT ceilings, so they get different buckets.** Voyage
meters per model; OpenRouter meters the project. That is why `budgetScope` exists
on the route: one bucket for Voyage would have to be sized at rerank's lower
ceiling (wasting half the embedding budget) or at embedding's (letting rerank run
to twice its own limit), and two buckets for OpenRouter would sum to twice the
one project limit that exists.

Defaults sit at ~75% of each ceiling, because a limiter set AT a ceiling still
lets bursts reach it. `OPENROUTER_TPM` is against a measured ~12,000,000/min.

`voyage-4`'s **default dimension is 1024** — which is exactly why an OpenRouter
request that silently ignored `output_dimension` returned a 1024-wide vector
with a 200 rather than an error.

### Tuning

    curl -H "x-admin-secret: $ADMIN_SECRET" $API/admin/health-detail \
      | jq .embedding.managed.outbound_budget

* `utilisation` near 1.0 with **no** upstream 429s → there is room under the
  tier ceiling. Raise it, up to the table above.
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

One worst-case rerank is **500,000 tokens** (`MAX_SINGLE_REQUEST_TOKENS`: the
estimator charges the query once per document, so the query cap is a 200x
multiplier); a worst-case embed is 256,000. Both are DERIVED from the input caps
and both are asserted to stay inside Voyage's per-request ceilings above, so
raising an input cap fails a test rather than producing a 400 in production.

The limiter raises a key's share to admit one largest request; if it could not,
such a request would wait out its whole deadline for room nothing could free.
Lower a bucket below that and those requests are refused outright — the server
logs both conditions loudly on the first request through that bucket. Read the
log after a config change; that warning is the only sign the per-key fairness
guarantee has been weakened.

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
5. Watch `embedding.managed.outbound_budget` for a day. The defaults are ~75%
   of the Tier 1 ceilings above; raise them only if utilisation runs near 1.0
   without upstream 429s.
6. **Credit balance is a separate limit from rate.** The account holds ~$10, so
   `out_of_credits` is a likelier failure than a rate limit. It is handled the
   same way — cool the route, fail over to OpenRouter — but no limiter setting
   prevents it; only topping up does.

## Cost

`usage_events` has **no cost column**. OpenRouter's measured per-call
`usage.cost` reaches telemetry only. A `voyage4` / `rerank25lite` price card must
exist in natively-control or those ledger rows price as `no_effective_card`.
