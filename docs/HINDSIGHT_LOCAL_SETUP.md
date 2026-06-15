# Hindsight Local Setup (Optional Long-Term Memory)

Natively works **fully without Hindsight**. This is an opt-in, power-user/self-hosted feature that
adds cross-meeting long-term memory ("what did we discuss last time?", recurring patterns, course
memory). When Hindsight is not installed/configured/running, Natively's memory provider is a
**Noop** — live answers, local global search, and meeting summaries all keep working unchanged.

> **Source:** verified from the Hindsight repo (MIT, `github.com/vectorize-io/hindsight`) during the
> Intelligence OS Phase 0 research. See `NATIVELY_EXTERNAL_RESEARCH_NOTES.md`.

## Production / shipped app

Hindsight's server is Python + an embedded Postgres + a HuggingFace model — **far too heavy to bundle**
into the signed Electron app, and there's no precedent for bundling a Python runtime here. So, exactly
like Ollama and the Codex CLI, Hindsight is an **optional, user-provisioned sidecar**: `HindsightManager`
(`electron/services/HindsightManager.ts`) health-checks a configured server and the app degrades to
**Noop** when it's absent. Config comes from **SettingsManager** (so it works in a packaged build, not
just a dev shell), with `HINDSIGHT_BASE_URL` env taking precedence for development.

Two supported targets — **same code path, just a different `baseUrl`:**
- **Cloud** (zero local deps): sign up at `https://ui.hindsight.vectorize.io/signup`; set
  `hindsightBaseUrl` to your Cloud URL + `hindsightApiKey`. Note: memory data lives on their servers.
- **Local** (fully private/on-device): run the server (`bash scripts/hindsight-start.sh`, needs
  `pip install hindsight-all`); set `hindsightBaseUrl` to `http://localhost:8888`.

Settings keys (in `SettingsManager`): `hindsightBaseUrl`, `hindsightApiKey`, `hindsightAutoStart`,
`hindsightServerCommand`, `hindsightLlmProvider`. **Default off** (no baseUrl) — opt-in only.

> **Current scope:** the app health-checks + connects to a server you've already started (local or
> Cloud). **Auto-spawning** a local server from the app (start/stop/poll, auto-start-when-installed
> like Ollama) is a planned follow-up — `HindsightManager.start()`/`stop()` are stubbed for it. Until
> then, start the local server yourself (or point at Cloud).

## Requirements

- **The TS client** in Natively: already declared as an `optionalDependency`
  (`@vectorize-io/hindsight-client@^0.8.2`). Natively's adapter lazy-requires it (and esbuild keeps
  it external), so it loads from `node_modules` at runtime and falls back to Noop if absent.
- **An LLM provider + API key** for the Hindsight server (OpenAI / Anthropic / **Gemini** / Groq /
  Ollama / lmstudio / minimax) — Hindsight uses an LLM for fact extraction and reflect. Natively
  already has `GEMINI_API_KEY`, so Gemini is the path of least resistance.
- A vector-capable Postgres — **the embedded `pg0` (bundled) is used automatically**, so you do NOT
  need to install or run Postgres yourself for local use.

## Run the server — Python embedded (recommended, NO Docker)

This is the verified local path (the dev machine has Python 3.12 + the Gemini key; Docker is not
required).

```bash
# 1. Install the embedded server (bundles pg0 Postgres + pgvector + the API):
pip3 install hindsight-all -U          # Intel Macs: pip3 install hindsight-all-slim -U

# 2. Start it (reads GEMINI_API_KEY from your env; first boot downloads embedding models):
GEMINI_API_KEY=... python3 scripts/hindsight-dev-server.py
# → "[hindsight-dev-server] READY at http://127.0.0.1:8888"
```

The helper `scripts/hindsight-dev-server.py` runs `HindsightServer(llm_provider="gemini",
llm_model="gemini-2.5-flash", llm_api_key=$GEMINI_API_KEY, port=8888)` and keeps it alive until
Ctrl-C. Override with `HINDSIGHT_PORT`, `HINDSIGHT_LLM_PROVIDER`, `HINDSIGHT_LLM_MODEL`,
`HINDSIGHT_START_TIMEOUT`. First boot downloads `BAAI/bge-small-en-v1.5` + a reranker (~1 min);
subsequent boots are fast (HF-cached).

> **Async extraction:** retain runs server-side fact extraction asynchronously (via the LLM), so a
> just-retained fact is **not** instantly recallable — it appears a few seconds later. This is why
> Natively retains post-meeting and recalls later in search, never on the live answer path.

### Alternatives
- **Docker** (if you have it): `docker run -it --pull always -p 8888:8888 -p 9999:9999 -e HINDSIGHT_API_LLM_API_KEY=$GEMINI_API_KEY -e HINDSIGHT_API_LLM_PROVIDER=gemini -v hindsight-data:/home/hindsight/.pg0 ghcr.io/vectorize-io/hindsight:latest`
- **Hindsight Cloud** (hosted): sign up at `https://ui.hindsight.vectorize.io/signup`, use its base URL + an API key (set `HINDSIGHT_API_KEY`). Note: memory data then lives on their servers (privacy consideration for a local-first app).

## LLM provider chain + retry/fallback (recommended over single-model)

Hindsight's LLM (used for fact extraction on retain + synthesis on reflect) can follow Natively's
**provider priority chain with automatic retry/fallback**, so a memory op always resolves even when
the primary model/provider fails. Use the launcher instead of calling the Python script directly:

```bash
bash scripts/hindsight-start.sh
```

It (1) loads provider keys from `.env`, (2) generates a `litellm.Router` config via
`scripts/hindsight-llm-config.mjs`, exports it as `HINDSIGHT_API_LLM_LITELLMROUTER_CONFIG`, and
(3) starts the server. Hindsight forwards that JSON **verbatim** to `litellm.Router`, which rotates
through the chain on failure and retries transient errors (5xx / 429 / timeout).

**Priority (key-gated — an entry is included only when its provider key is in `.env`):**
`Gemini → OpenAI → Claude → DeepSeek → Groq → Ollama`. Within Gemini:
`gemini-3.5-flash → gemini-3.1-flash-lite → gemini-3.1-pro-preview`. Model names **mirror**
`electron/services/ModelVersionManager.ts` so Hindsight stays in lockstep with the app. Every model
string is env-overridable (`HINDSIGHT_LLM_GEMINI_PRIMARY`, `HINDSIGHT_LLM_OPENAI`,
`HINDSIGHT_LLM_CLAUDE`, …); retries/timeout via `HINDSIGHT_LLM_NUM_RETRIES` / `HINDSIGHT_LLM_TIMEOUT`.
Enable the local Ollama fallback with `HINDSIGHT_LLM_ENABLE_OLLAMA=1`.

**Retry/backoff + context-size** (set as defaults by the dev server): per-op guards
`HINDSIGHT_API_RETAIN_LLM_MAX_RETRIES=3`, `_INITIAL_BACKOFF=1`, `_MAX_BACKOFF=15`, `_TIMEOUT=45`
(+ reflect variants); and `HINDSIGHT_API_CONSOLIDATION_MAX_TOKENS=2048` so a small-context (4096-cap)
fallback model doesn't truncate the structured consolidation JSON. The local embedding model
(`bge-small-en-v1.5`, 512-token chunks) is unaffected by the LLM chain.

> **Natively API as the first LLM is intentionally NOT in the chain yet.** Its `/v1/chat/completions`
> picks the model server-side, so it can't be a per-model litellm fallback target. A future special
> server endpoint (Hindsight → Gemini-3.1-flash-lite only) will add it; until then the chain starts
> at Gemini.

## Health check

```bash
curl -s http://localhost:8888/health   # or open the control-plane UI on :9999
```

## Configure Natively

1. `npm install @vectorize-io/hindsight-client`
2. In `.env` (see `.env.example`):
   ```
   HINDSIGHT_BASE_URL=http://localhost:8888
   HINDSIGHT_API_KEY=            # only for Hindsight Cloud
   HINDSIGHT_TIMEOUT_MS=800
   ```
3. Enable the feature flags **in this order** (each is `NATIVELY_*=1` env or a SettingsManager key):
   1. `NATIVELY_HINDSIGHT_MEMORY=1` — turns the provider on at all (without this it's Noop).
   2. `NATIVELY_HINDSIGHT_POST_MEETING_RETAIN=1` — async-retain meeting summaries after a meeting
      ends (the safest first step; retain only, no recall).
   3. *(future)* global recall in search, then **live recall last** — only after the above are
      validated.

## Isolation & privacy (how Natively scopes memory)

Natively's `HindsightTagBuilder` enforces isolation two ways (defense in depth), per the research:

- **Bank per tenant** — `org_<id>` when an org is present, else `user_<id>`. Banks are strictly
  isolated by Hindsight; no cross-bank leakage.
- **Strict scope tags** on every retained item — `user:<id>`, `org:<id|personal>`,
  `visibility:private`, `source:<type>`, `mode:<mode>`, plus context tags (`meeting:`, `session:`,
  `course:`, `lecture:`, `company:`, hashed `participant:`, `date:`). Recall filters with
  `tags_match: "all_strict"`, which **excludes untagged/foreign** memories. Participant ids are
  hashed, never stored raw. Isolation is enforced by **tags + bank, never metadata alone**.

## Timeouts & async (never blocks live answers)

- **retain** is async/queued (concurrency-1, backpressure-bounded) — the live answer path only
  enqueues and returns.
- **recall** is bounded by an `AbortController` + `Promise.race` timeout (live ≤ 800ms, global
  2–5s). On timeout/error it returns `[]` and the answer proceeds **without** memory.
- **reflect** is offline/deep-analysis only — never on the live answer path.

## Failure fallback

If the Hindsight server is down or unreachable:

- Live answers still work (no dependency).
- Local global search still works (local DB only).
- Meeting summaries still save.
- Retain calls are skipped (the queue worker logs and drops; a future version may retry).
- No user-facing crash — the adapter degrades to Noop on any construction/call failure.

## Backup / restore

Hindsight state lives in Postgres (the `hindsight-data` Docker volume for `pg0`, or your external
DB). Back up the database with standard Postgres tooling (`pg_dump` / volume snapshot). Natively
keeps its own meeting data in its local SQLite DB independently, so a Hindsight loss never loses
meetings — only the long-term-memory index, which can be rebuilt by re-retaining.
