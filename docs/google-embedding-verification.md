# Google Embedding Model Verification (Phase 2)

**Date:** 2026-06-01
**Method:** Live Gemini API calls with a production `GEMINI_API_KEY` from `natively-api/.env`.
**Rule applied:** Documentation/comments are NOT trusted. Ground truth = the live API
(`ListModels` + real `embedContent` probes). Where they disagree, the live API wins.

---

## 1. Which embedding models actually exist (live `ListModels`)

`GET https://generativelanguage.googleapis.com/v1beta/models?key=…&pageSize=1000`,
filtered to embedding-capable models:

| Model name (`models/…`)        | `supportedGenerationMethods`                                              |
|--------------------------------|---------------------------------------------------------------------------|
| `gemini-embedding-001`         | `embedContent`, `countTextTokens`, `countTokens`, `asyncBatchEmbedContent` |
| `gemini-embedding-2`           | `embedContent`, `countTextTokens`, `countTokens`, `asyncBatchEmbedContent` |
| `gemini-embedding-2-preview`   | `embedContent`, `countTextTokens`, `countTokens`, `asyncBatchEmbedContent` |

**`text-embedding-004` is NOT in the list** for this key/API version.

## 2. Live `embedContent` probes (`outputDimensionality: 768`)

Request body used (matches `callEmbedModel` in `server.js`):
```json
{ "content": { "parts": [{ "text": "…" }] }, "outputDimensionality": 768 }
```

| Model                  | HTTP | Result                                                       |
|------------------------|------|--------------------------------------------------------------|
| `gemini-embedding-2`   | 200  | ✅ `embedding.values` length **768**                          |
| `gemini-embedding-001` | 200  | ✅ `embedding.values` length **768**                          |
| `text-embedding-004`   | 404  | 🚨 `NOT_FOUND` — "is not found for API version v1beta, or is not supported for embedContent" |

## 3. Verified contract facts

- **Endpoint:** `POST /v1beta/models/{model}:embedContent` — unchanged across all three models.
- **Auth:** `x-goog-api-key` header (NOT a URL query param). Confirmed working.
- **Request shape:** `{ content: { parts: [{ text }] }, outputDimensionality }`.
  - `gemini-embedding-2` accepts this exact shape and returns a single embedding.
  - `task_type` is NOT sent by our server (we bake nothing) → no incompatibility.
    (Per Google docs, `gemini-embedding-2` does not support `task_type`; our server
    never sends it, so this is a non-issue for the server path.)
- **Response shape:** `{ embedding: { values: number[] } }` — identical for `001` and `2`.
- **Dimensions:** both `001` and `2` honor `outputDimensionality: 768` and return exactly 768 floats.
- **MRL truncation:** both models are Matryoshka-trained; 768 is a Google-recommended
  truncation point (others: 1536, 3072). Default (no param) = 3072.

## 4. Embedding-space compatibility (CRITICAL)

Per Google's own documentation, confirmed and load-bearing for this migration:

> The embedding spaces between `gemini-embedding-001` and `gemini-embedding-2` are
> **incompatible**. You cannot compare vectors from one model against the other.
> Upgrading requires re-embedding existing data.

This means **dimensions being equal (768==768) does NOT imply comparability.** A
vector store that mixes `001` and `2` vectors will return semantically random
similarity with no error. This is the single biggest migration hazard and is the
reason the desktop app keys its vectors on a composite `provider:model:dims` "space"
(see `docs/vector-dimension-audit.md`).

## 5. Discrepancies found vs. the code's own comments

`server.js` comments (pre-fix) claimed:
- "Waterfall: gemini-embedding-001 (primary) → text-embedding-004 (fallback)" — **wrong**;
  the code had `text-embedding-004` as primary, `gemini-embedding-001` as fallback.
- "text-embedding-004 … No allowlist needed for standard Gemini API keys on paid
  plans post-2025." — **false on this key**; the model 404s entirely.

→ Comments confirmed untrustworthy; all conclusions above come from live probes.

## 6. Sources

- https://ai.google.dev/gemini-api/docs/embeddings
- https://ai.google.dev/gemini-api/docs/models/gemini-embedding-001
- https://developers.googleblog.com/gemini-embedding-available-gemini-api/
- Live API: `ListModels` + `embedContent` probes (this key), 2026-06-01.
