# Vector Dimension & Embedding-Space Audit (Phase 3)

**Date:** 2026-06-01
**Question:** Does any vector store expect 3072 dims? Are old (incompatible-space)
vectors protected from being compared against new-model query vectors?

## TL;DR

- **No code path stores or compares 3072-dim vectors.** Everything is requested at
  `outputDimensionality: 768` (server) or the provider's configured dims (desktop, default 768).
- **Dimension equality is handled** via per-dimension tables (`vec_chunks_{dim}`) + a
  byteLength guard.
- **Embedding-space incompatibility (001 vs 2, both 768d) is handled** via an
  `embedding_space` composite key filter. This is the load-bearing safety for this migration.
- The number `3072` appears only in *comments* describing Google's native default; it is
  never used as an array length or table dimension.

## Where 768 / 3072 appear

### Server (`natively-api/server.js`)
| Location | Value | Role |
|---|---|---|
| `callEmbedModel` body | `outputDimensionality: 768` | All server embeds truncated to 768 |
| comments | `3072` | Descriptive only ("native 3072, we request 768") — not used in code |

The server stores **no vectors** (0 references to pgvector/cosine/VectorStore). `/v1/embed`
returns the 768-float array to its caller; persistence/compare is the caller's concern.

### Desktop app (`electron/rag/`)
| File | Mechanism | Purpose |
|---|---|---|
| `VectorStore.ts:155,208,403` | `vec_chunks_${dim}` tables | Physically separate storage per dimension (e.g. `vec_chunks_768`, `vec_chunks_384`) |
| `VectorStore.ts:345` | `buffer.byteLength === dim*4` filter | Drop any chunk whose dimension ≠ query dimension |
| `VectorStore.ts:331-334` | `AND m.embedding_space = ?` | **Drop vectors from a different (provider:model:dims) space**, even if dims match |
| `embeddingSpace.ts` | `embeddingSpaceKey()` = `name:model:dims` | Canonical space identity; opaque equality key |
| `vectorSearchWorker.ts:211` | `vec_chunks_${dim}` | Worker selects table by query dim |
| `EmbeddingPipeline.ts` | `embedding_space` stamping + re-index queue | Re-embeds when active space ≠ stored space |
| `DatabaseManager.ts` (v16 migration) | backfill `embedding_space` for legacy rows | Old rows get a concrete v1 space string that differs from v2 → triggers re-index |

### KNOWN_DIMS
`768` is registered in `KNOWN_DIMS`, so `gemini-embedding-2 @ 768` reuses the existing
`vec_chunks_768` table — no schema change required for the desktop migration.

## The two-layer protection (why mixing can't corrupt results)

1. **Dimension layer:** different dims → different physical table + byteLength filter →
   structurally impossible to compare.
2. **Space layer:** same dims, different model (001 768d vs 2 768d) → `embedding_space`
   column differs → SQL `AND m.embedding_space = ?` excludes the stale rows.
   `NULL` space (not yet stamped / mid-reindex) is *excluded*, yielding "empty, not wrong".

## 3072 risk verdict

**No location expects 3072.** If a future change ever drops `outputDimensionality`, Google
returns 3072 by default — that would (a) land in a non-existent `vec_chunks_3072` table on
desktop (rejected by byteLength), and (b) change the server's returned vector length. Both
are caught structurally, but the `outputDimensionality: 768` parameter must remain explicit.
This is enforced in the server fix (Phase 4) and is already explicit in the desktop provider.

## Affected files (for migration)
- **Server:** `natively-api/server.js` (`getEmbedding`, `callEmbedModel`) — model name only; dims stay 768.
- **Desktop:** already migrated (default `gemini-embedding-2 @ 768`); no dimension change.
