# Natively Desktop ↔ API Contract Audit (Phase 0)

**Date:** 2026-06-01
**Scope:** How the desktop app talks to `api.natively.software`, with focus on the
embedding path and what an embedding-model change can/can't affect.

## 0. Headline finding (changes the migration's risk model)

**The desktop app does NOT use the server for embeddings.** It embeds locally via its
own provider chain, hitting Google directly with the *user's own* Gemini key. The
server's `/v1/embed` endpoint is a separate, internally-used proxy. Therefore:

- Changing the **server** embedding model cannot affect desktop RAG / resume / JD /
  persona / negotiation / semantic search — those run entirely on the desktop's own
  vectors (stored per-install in SQLite).
- The desktop app is **already** on `gemini-embedding-2 @ 768` with rollback levers and
  re-index safety (see `docs/embedding-migration-analysis.md`).

## 1. Authentication

| Mechanism | Header | Validated by | Notes |
|---|---|---|---|
| Paid API key | `x-natively-key` | `validateKey()` | 30s cache; checks active/suspended; atomic quota (migration 001) |
| Trial token | `x-trial-token` | `validateTrial()` | JWT (`TRIAL_JWT_SECRET`); 15s cache |
| Admin | `x-admin-secret` / `ADMIN_SECRET` | per-route | 403 if env unset |
| Webhooks | HMAC-SHA256 (Dodo), `x-telegram-bot-api-secret-token` | timing-safe compare | |

`authenticate()` accepts either a paid key or a trial token. Quota gates: transcription
minutes, AI requests, search requests (per `PLANS`).

## 2. REST endpoints (embedding-relevant subset)

| Endpoint | Auth | Embedding-related? |
|---|---|---|
| `POST /v1/chat` | key/trial | No (chat waterfall: Groq→Gemini→Scout) |
| `POST /v1/chat/completions` | key/trial | No |
| `POST /v1/embed` | paid key | **Yes** — `{ text } → { embedding, model, dimensions }` |
| `POST /v1/search` | key/trial | No (Tavily) |
| `GET /health` | none | reports provider health |
| `GET /v1/usage` | key | quota counters |

### `/v1/embed` contract (the only embedding endpoint)
**Request:** `{ "text": string }` (required).
**Response:** `{ "embedding": number[768], "model": string, "dimensions": 768 }`.
**Billing:** routed through `billAI()` (atomic quota, migration 001).
**Consumers:** internal only — **no desktop or `src/` caller** (verified by grep; the only
`v1/embed` hits in the app are OpenAI's `api.openai.com/v1/embeddings` URL, unrelated).

> Contract change in this migration: the `model` field in the response will change from
> `text-embedding-004`/`gemini-embedding-001` to `gemini-embedding-2`/`gemini-embedding-001`.
> `dimensions` stays `768`. `embedding` stays a 768-float array. **No breaking shape change.**

## 3. WebSocket endpoints

`/ws` (audio/STT): connection auth via key/trial in query/headers; reconnect with 1001 on
redeploy; audio routing Deepgram→GoogleSTT→ElevenLabs; provider switching via shadow probes.
**No embedding involvement** — STT only. Out of scope for this migration except to confirm
no coupling (confirmed: none).

## 4. Implicit assumptions found

| Assumption | Where | Status |
|---|---|---|
| Embeddings are 768-dim | server `outputDimensionality:768`; desktop `DEFAULT_DIMS=768` | Held by both |
| Response shape `{embedding:{values}}` | `callEmbedModel` | Verified live |
| `text-embedding-004` is available | server primary (pre-fix) | **FALSE — 404** (see verification doc) |
| Desktop uses server embeds | (mission premise) | **FALSE — desktop embeds locally** |

## 5. Compatibility & migration risks

| Risk | Severity | Mitigation |
|---|---|---|
| Server primary `004` is dead → every embed wastes a round-trip + falls through | Medium | Phase 4 fix: make `gemini-embedding-2` primary, `001` fallback |
| Mixing 001/2 vectors (incompatible space, same dims) | **High** (desktop) | Already mitigated: `embedding_space` filter + re-index (Phase 3 doc) |
| Response `model` string changes | Low | Field is informational; no consumer branches on it (verified) |
| Old installed app versions | Low | They embed with their own bundled default + own key; server change doesn't reach them |
| Dropping `outputDimensionality` → 3072 | High if it happened | Kept explicit in fix; structurally rejected by desktop tables |

## 6. Rollback plan (server)
- `ENABLE_LEGACY_TEXT_EMBEDDING_004=true` re-inserts `004` as first attempt (no-op while it 404s, but available if Google re-enables it).
- `NATIVELY_EMBED_PRIMARY` / `NATIVELY_EMBED_FALLBACK` env vars pin model names without a redeploy.
- Reverting the commit restores prior behavior; vectors are unaffected (server stores none).

## 7. Rollback plan (desktop) — already present
- `NATIVELY_GEMINI_EMBED_MODEL` / `NATIVELY_GEMINI_EMBED_DIMS` env vars pin the model/dims
  (e.g. back to `gemini-embedding-001 @ 768`) without a rebuild.
- Changing the model changes the `embedding_space`, which auto-triggers re-index — switching
  back also re-indexes back. Search returns "empty, not wrong" during re-index.
