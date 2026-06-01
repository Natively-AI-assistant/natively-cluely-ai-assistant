# Embedding Migration — Final Report (Phase 11)

**Date:** 2026-06-01
**Branch:** `fix/overlay-startup-slide`
**Verification:** Live Gemini API + 100-concurrent stress + booted-server integration +
3 independent agent passes (code-reviewer ×2, desktop-verifier).

---

## BEFORE

| | Server (`natively-api`) | Desktop app |
|---|---|---|
| Primary model | `text-embedding-004` | already `gemini-embedding-2` |
| Fallback model | `gemini-embedding-001` | provider chain (Ollama/local) |
| Dimensions | 768 | 768 |
| **Reality** | **`text-embedding-004` 404s on the key** → every embed wasted a round-trip + warning, then silently ran on `gemini-embedding-001` | correct |
| Observability | none | n/a |
| Risk | dead primary; no health/telemetry | already safe (space-keyed) |

## AFTER

| | Server | Desktop app |
|---|---|---|
| Primary model | **`gemini-embedding-2`** (env: `NATIVELY_EMBED_PRIMARY`) | `gemini-embedding-2` (unchanged) |
| Fallback model | `gemini-embedding-001` (env: `NATIVELY_EMBED_FALLBACK`) | unchanged |
| Legacy `004` | kept behind `ENABLE_LEGACY_TEXT_EMBEDDING_004=true` (off) | n/a |
| Dimensions | 768 (env: `NATIVELY_EMBED_DIMS`, dimension-guarded) | 768 |
| Health | `providerHealth.embedding2` / `embedding001` + circuit breaker | n/a |
| Telemetry | requests/success/failure/fallback/timeout/auth/quota/bad_request, avg+p95+p99, per-model attempts; `/health` block; optional PostHog/Axiom | n/a |
| Reliability | primary→fallback failover; breaker fast-skips hard-down models; bad-input (400) cannot down the service | unchanged |

### Measured (live, 100 concurrent, `gemini-embedding-2 @ 768`)
- 100/100 success, 0 fallback, 0 dimension errors.
- Latency avg **1507ms**, p95 **2295ms**, p99 **2438ms**, wall 2.5s for 100.

---

## Files modified

| File | Change |
|---|---|
| `natively-api/server.js` | Embedding waterfall, health, telemetry, `/health` block (see functions below) |
| `electron/rag/*` | **None** — verified only; desktop was already on v2 with full safety |

### Functions added/modified in `server.js`
- `EMBED_PRIMARY_MODEL/_FALLBACK_MODEL/_DIMS`, `ENABLE_LEGACY_004`, `LEGACY_004_MODEL` (`:2136`)
- `embedTelemetry` + `recordEmbedLatency` + `embedPercentile` + `embedTelemetrySnapshot` (`:2147`, `:2180`)
- `providerHealth.embedding2 / embedding001` (`:771`)
- `markEmbeddingFailed` (`:780`), `markEmbeddingHealthy` (`:804`), `embeddingSlotAvailable` (`:815`)
- `classifyEmbedHttp` (`:2873`) — 401/403→auth, 429→out_of_credits, 404→model_error, 400→bad_request
- `callEmbedModel` (`:2886`) — env dims, classified errors, dimension guard
- `tryEmbedSlot` (`:2945`) — health+telemetry per attempt, never throws
- `getEmbedding` (`:2971`) — legacy(flag)→primary→fallback waterfall, request-level counters
- `shipEmbedMetric` (`:3019`) — fire-and-forget PostHog/Axiom
- `/health` (`:3101`) — embedding status + telemetry

## Telemetry added
`embedding_provider, model, latency_ms, dimensions, success, fallback_used`, plus aggregate
counters and avg/p95/p99 at `GET /health`. Optional shipping to PostHog (`POSTHOG_API_KEY`,
`POSTHOG_HOST`) and Axiom (`AXIOM_TOKEN`, `AXIOM_DATASET`).

## Tests added/run
- Live API contract probes (ListModels + embedContent) for all 3 models.
- 100-concurrent live stress + edge cases (empty/50k/unicode/bad-model).
- Health state-machine unit checks (10/10): 400 cannot down slots; 404 opens breaker;
  5-strike transient; non-destructive half-open; auth opens immediately.
- Booted-server integration: `/health` embedding block; `/v1/embed` auth (401) + no-crash.

## Migration risks & status
| Risk | Status |
|---|---|
| Server dead primary (004) | **Fixed** (2 primary, 001 fallback) |
| 001↔2 incompatible space (desktop) | **Already mitigated** (space filter + lazy reindex) — verified |
| Response contract change | None (shape `{embedding, model, dimensions:768}` unchanged) |
| Old installed apps | Unaffected (self-embed with own key) |
| Self-inflicted outage from bad input | **Fixed** (400→bad_request never opens breaker) |
| 3072 default if dims dropped | Guarded (explicit `outputDimensionality`, dimension_mismatch reject) |

## Rollback plan
- **Server:** `NATIVELY_EMBED_PRIMARY=gemini-embedding-001` (env, no redeploy) → instant; server stores nothing. `ENABLE_LEGACY_TEXT_EMBEDDING_004=true` if 004 returns. Revert commit for full rollback.
- **Desktop:** `NATIVELY_GEMINI_EMBED_MODEL=gemini-embedding-001` (+ dims 768) → index re-aligns to v1 lazily, no rebuild.

## Verdict
**Production-ready.** Server APPROVE (0 critical/high/medium after fix loop); desktop VERIFIED
safe end-to-end. No vector corruption path; full observability; instant, consequence-free rollback.
