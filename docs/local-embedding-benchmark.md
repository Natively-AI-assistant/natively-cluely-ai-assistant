# Local embedding model bake-off — Natively

Investigation, size/license screening, standalone sanity, the matched retrieval
head-to-head, the cross-file track, the reranker track and the live-session
track are complete and reproducible. **Round 2 (§8b) re-ran the bake-off at each
family's widest variant under the cap, up to 1024 dimensions.** Every section
states what was actually executed and what was not.

**Current state (2026-09-22): the bundled default is `multilingual-e5-small`
(384d, 129.1 MiB).** The history: MiniLM → `multilingual-e5-base` (768d,
2026-09-21, never released) → `multilingual-e5-small` (2026-09-22). Each change
was chosen by the project owner from the measured data. §12c has the current
decision and §12b the superseded one. All changes are uncommitted; see §15.

**A note on pool sizes, to avoid conflating two numbers.** The retrieval table
(§8) reports `candidate recall@50`, using a 50-chunk pool — a measure of how
much a model *could* surface. The reranker track (§10) uses **30**, production's
actual `RERANK_CANDIDATE_POOL`. Different pools; not comparable to each other.

Section numbers below are this document's own. References to the commissioning
brief's numbering are written explicitly as "the brief's §N".

Generated 2026-09-21. Machine: Apple M4, 16 GB, macOS 27.0.0 (darwin).

---

## 1. How local embedding works today

Traced from source, not from documentation.

### The reference-file path

| stage | code | notes |
| --- | --- | --- |
| upload allowlist | `electron/services/SafeDocumentTextExtractor.ts:18` `SAFE_DOCUMENT_EXTENSIONS` | one Set, shared by UI dialog and backend |
| UI file dialog | `electron/ipcHandlers.ts:15969` | built from the same Set |
| backend gate | `SafeDocumentTextExtractor.ts:244` | `unsupported file type` throw |
| mode ingestion | `electron/services/ModeReferenceFileIngestion.ts:26` | re-exports the same Set as `MODE_REFERENCE_FILE_EXTENSIONS` |
| extraction | `SafeDocumentTextExtractor.ts:259` (pdf), `:297` (docx), `:309` (text) | `pdf-parse`, `mammoth`, UTF-8 decode |
| chunking | `electron/services/modes/semanticChunker.ts` | `CHUNKER_VERSION = 4` |
| embedding | `electron/rag/EmbeddingPipeline.ts` → provider | `embedBatch` documents, `embedQuery` queries |
| local provider | `electron/rag/providers/LocalEmbeddingProvider.ts` | worker-isolated |
| inference | `electron/rag/providers/localEmbeddingWorker.ts` | transformers.js 3.8.1, ONNX Runtime |
| vector store | `electron/rag/VectorStore.ts` | sqlite-vec |
| retrieval | `electron/services/modes/ModeHybridRetriever.ts` | hybrid lexical + dense |
| rerank | `electron/rag/LocalReranker.ts` via `getLocalReranker()` | confidence-gated escalation |

### The local embedding model as shipped

| property | value | source |
| --- | --- | --- |
| model | `Xenova/all-MiniLM-L6-v2` | `LocalEmbeddingProvider.ts` |
| dimensions | 384 | same |
| runtime | `@huggingface/transformers` 3.8.1 (transformers.js), ONNX Runtime | `localEmbeddingWorker.ts` |
| artifact | `onnx/model_quantized.onnx`, `dtype: 'q8'` | worker `pipeline()` call |
| pooling | `mean` | worker `pipe(texts, { pooling: 'mean' })` |
| normalization | `normalize: true` (L2, measured 1.000) | same |
| query/doc prefixes | none — `embedQuery` returns `embed` | "all-MiniLM-L6-v2 is symmetric" |
| max input | 512 tokens (`max_position_embeddings`) | `config.json` |
| threading | `worker_threads.Worker`, bounded intra/inter-op | `onnxThreadConfig.ts` |
| acceleration | CPU only. No CoreML/Metal EP is requested | worker `session_options` |
| model dir | `resources/models/Xenova/all-MiniLM-L6-v2` | `resolveModelPath()` |
| installed size | 109 MB on disk; only the 22.97 MB q8 file is loaded | measured |
| space identity | `local:xenova/all-minilm-l6-v2:384` | `embeddingSpace.ts` |
| dimension persisted | yes, in the space key on every row | `embeddingSpaceKey()` |

Startup cost is lazy: the constructor spawns nothing, and the ONNX session is
built on the first real `embed()` call. `isLoaded()` exists precisely so
callers can route to lexical retrieval during that window instead of blocking.

**Vector-space isolation already exists and is reusable.** `embeddingSpaceKey({name, model, dimensions})`
produces an opaque equality key, `RAGManager` filters retrieval by
`getActiveSpaceKey()`, and a v16 migration backfills legacy rows. This is what
§10 of the brief asks for, already built — so the bake-off encodes its extra
identity (dtype, pooling, recipe version) into the model string rather than
introducing a parallel mechanism.

---

## 2. Reference-file formats Natively actually accepts

Read from `SAFE_DOCUMENT_EXTENSIONS`, which is the single source of truth for
both the UI dialog and the backend gate. **This corrects a premise carried over
from the previous benchmark.**

| extension | accepted by UI? | accepted by backend? | parser | extracted representation |
| --- | --- | --- | --- | --- |
| `.txt` `.log` | yes | yes | UTF-8 decode + BOM strip | plain text |
| `.md` `.markdown` | yes | yes | UTF-8 decode | markdown source, structure intact |
| `.json` `.csv` `.tsv` `.xml` | yes | yes | UTF-8 decode | verbatim |
| `.html` `.htm` | yes | yes | UTF-8 decode + `htmlToText()` | markup flattened to prose |
| `.pdf` | yes | yes | `pdf-parse` (pdfjs) | `[Page N]` header per page, joined |
| `.docx` | yes | yes | `mammoth.extractRawText` | raw text, **no** styles or tables |
| 33 code/config types (`.ts` `.py` `.go` `.sql` `.yaml` …) | yes | yes | UTF-8 decode | verbatim source |

### Explicitly NOT supported

`.rtf`, `.doc`, `.odt`, `.xlsx`, `.xls`, `.pptx`, `.ppt`, `.epub`, and every
image type (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`).

The brief stated `.rtf`, `.doc` and `.odt` "were explicitly present in the
previous Natively benchmark". They are **not** in Natively's allowlist. A file
with any of those extensions is rejected at `SafeDocumentTextExtractor.ts:244`
with `unsupported file type`, before any parser runs. They are therefore out of
scope for this benchmark, and the format track below covers only formats a real
user can actually upload.

### Preprocessing facts that matter for the brief's §19

- **No OCR anywhere.** A scanned PDF yields `[Page N]` headers with empty
  bodies and then fails the `file parsed to empty text` check.
- **Images are not indexed at all** — not as images, not via OCR.
- **Tables do not retain structure.** `mammoth.extractRawText` drops the table
  grid; an HTML table goes through `htmlToText`.
- **Headings survive** in `.md` (source is verbatim) and are re-detected for
  PDFs by the chunker's dense-heading logic (`CHUNKER_VERSION = 4`).
- **Page boundaries survive** for PDFs only, as literal `[Page N]` markers.
- **Code fences survive** and are **atomic** — the chunker never splits a fenced
  block or a table, even when that yields an oversized chunk.
- **Preprocessing is NOT uniform across formats.** Each branch emits different
  whitespace. This is the documented cause of a false format effect in the
  previous benchmark, and is why §8 compares every model on one shared,
  hash-asserted chunk set rather than re-extracting per model.

---

## 3. Chunking, as production runs it

`electron/services/modes/semanticChunker.ts`, `CHUNKER_VERSION = 4`.

Boundary-driven, not size-driven:

| guardrail | value |
| --- | --- |
| merge floor | 100 tokens |
| soft target | 350 tokens |
| hard cap | 1000 tokens |
| token estimate | `ceil(chars / 4)` |
| oversized-unit split | blank-line paragraph boundaries only |
| atomic units | fenced code blocks, tables |
| chunk prefix | `[Section N.N \| pX] [context: <heading ancestor path>]` |

The benchmark holds all of this **fixed** across every candidate, per the brief's §12.

---

## 4. Candidates: size, license, revision

All eight downloaded at a pinned commit, never `main`. Every revision was
verified against the Hugging Face API after being written into the registry.
`INSTALLED SIZE` is the bytes actually written for that candidate — config +
tokenizer + the single q8 ONNX — not the repository size, which also carries
fp32/fp16/bnb4/q4/uint8 siblings Natively would never copy.

| key | repo | revision | license | dim | ctx | installed | ≤500 MiB |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| minilm-baseline | `Xenova/all-MiniLM-L6-v2` | bundled | apache-2.0 | 384 | 512 | 22.9 MB loaded | PASS |
| arctic-xs | `Snowflake/snowflake-arctic-embed-xs` | `d8c8652110` | apache-2.0 | 384 | 512 | **22.6 MiB** | PASS |
| arctic-s | `Snowflake/snowflake-arctic-embed-s` | `e596f50746` | apache-2.0 | 384 | 512 | **33.1 MiB** | PASS |
| arctic-m | `Snowflake/snowflake-arctic-embed-m` | `fc74610d18` | apache-2.0 | 768 | 512 | **105.7 MiB** | PASS |
| bge-small-en | `Xenova/bge-small-en-v1.5` | `ea104dacec` | mit | 384 | 512 | **33.1 MiB** | PASS |
| e5-small-v2 | `Xenova/e5-small-v2` | `02af799852` | mit | 384 | 512 | **33.1 MiB** | PASS |
| gte-small | `Xenova/gte-small` | `5927d1727b` | mit | 384 | 512 | **33.1 MiB** | PASS |
| nomic-v1.5 | `nomic-ai/nomic-embed-text-v1.5` | `e9b6763023` | apache-2.0 | 768 | 2048 | **131.6 MiB** | PASS |
| multilingual-e5-small | `Xenova/multilingual-e5-small` | `761b726dd3` | mit | 384 | 512 | **129.1 MiB** | PASS |

**No candidate is excluded for size.** §4 of the brief anticipated that
`arctic-m` might breach the cap; at q8 it lands at 105.7 MiB, comfortably
inside. `nomic-v1.5`'s 547 MB fp32 file was never downloaded — the q8 artifact
is 137 MB on the wire, 131.6 MiB installed.

### Licensing (§24)

All eight are Apache-2.0 or MIT: commercial use permitted, redistribution
permitted, none gated, none requiring acceptance. Verified from each source
repository's own metadata, not from memory.

Two candidates are served from a `Xenova/*` mirror because the upstream repo
ships no transformers.js-loadable q8 artifact (`BAAI/bge-small-en-v1.5` has only
fp32 `model.onnx`; `intfloat/*` ship `model_qint8_avx512_vnni.onnx`, a filename
transformers.js does not resolve). The **weights** are upstream's and the
upstream license (MIT) governs; the mirror is a re-export.

### Per-file hashes

Recorded in `manifest.json` beside each model, under
`~/Library/Application Support/natively/embedding-experiments/<key>/`, with
sha256 and byte count for every file. Reproduce with
`node scripts/download-embedding-experiments.mjs`.

---

## 5. A silent-corruption defect found before any model was scored

`localEmbeddingWorker.ts` sliced its output tensor at a hardcoded
`DIMENSIONS = 384`, regardless of the loaded model's real width:

```js
const DIMENSIONS = 384;
vectors.push(Array.from(output.data.slice(i * DIMENSIONS, (i + 1) * DIMENSIONS)));
```

Correct for MiniLM. Against a 768-dim model — `arctic-m` and `nomic-v1.5`, two
of the eight candidates — batch item *i* receives bytes belonging to item *i/2*.
The vectors are finite, unit-ish, correctly shaped, and wrong. Nothing throws.
The only symptom is degraded retrieval, which reads as a model quality result.

**This was measured, not reasoned about.**
`scripts/embedding-slicing-negative-control.mjs` reconstructs what the old loop
would have returned from the *same real arctic-m tensor* the fixed code
produced:

| batch item | cosine(old slicing, correct) |
| ---: | ---: |
| 0 | **1.000000** |
| 1 | −0.015464 |
| 2 | 0.584062 |
| 3 | −0.045578 |

Item 0 scores a perfect 1.000 even when broken — its first 384 floats genuinely
are its own. **A test that checked only the first vector of a batch could not
have seen this defect.**

The fix derives the width from `output.dims` and asserts
`data.length === batch × width`, failing loudly instead of emitting garbage.
`LocalEmbeddingProvider` additionally refuses any vector whose reported width
disagrees with the width its space key advertises.

This is also what sets the `batchEqualsSingle` threshold at 0.95 rather than a
number tuned until the suite passed: the defect's worst cosine is −0.046 and
real q8 + batch-padding noise bottoms out at 0.9947, leaving ~1.04 of empty gap.
An earlier 0.999 threshold sat *below* the noise floor and failed the baseline
MiniLM at 0.989 — a broken test, not a broken model.

---

## 6. Model-specific recipes (the brief's §18)

Read from each model's own card on 2026-09-21. These differ materially, and
applying the wrong one produces an integration bug that looks like a quality
result.

| model | pooling | query prefix | document prefix |
| --- | --- | --- | --- |
| minilm-baseline | mean | *(none — symmetric)* | *(none)* |
| arctic-xs / s / m | **cls** | `Represent this sentence for searching relevant passages: ` | *(none)* |
| bge-small-en | **cls** | `Represent this sentence for searching relevant passages: ` | *(none)* |
| e5-small-v2 | mean | `query: ` | `passage: ` |
| multilingual-e5-small | mean | `query: ` | `passage: ` |
| nomic-v1.5 | mean | `search_query: ` | `search_document: ` |
| gte-small | mean | *(none — symmetric)* | *(none)* |

Three distinct prefix schemes and two pooling modes across eight candidates.
`EmbeddingPipeline` already routes documents to `embedBatch` and queries to
`embedQuery`, so the split lands in the one correct place.

Verified working, not assumed: the `prefixChangesVector` check confirms the
query and document encodings of identical text differ (e.g. arctic-xs cosine
0.836, multilingual-e5-small 0.965) rather than the prefix being silently
dropped.

---

## 7. Standalone sanity (the brief's §8) — 13 of 14 PASS

Run through **the real compiled worker**
(`dist-electron/electron/rag/providers/localEmbeddingWorker.js`) over the real
`worker_threads` protocol under Electron's node, so the ONNX Runtime ABI matches
the app's. Deliberately not a hand-rolled transformers.js script: that would
prove nothing about whether Natively can load the model.

```
ELECTRON_RUN_AS_NODE=1 npx electron scripts/embedding-experiment-sanity.mjs
```

| model | status | dim | load ms | query p50 | query p95 | chunks/s | batch≡single |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| minilm-baseline | PASS | 384 | 157 | 2 | 3 | 76.7 | 0.9891 |
| arctic-xs | PASS | 384 | 123 | 4 | 4 | 77.8 | 0.9973 |
| arctic-s | PASS | 384 | 171 | 6 | 7 | 41.5 | 0.9947 |
| arctic-m | PASS | 768 | 211 | 18 | 20 | 14.0 | 0.9761 |
| bge-small-en | PASS | 384 | 166 | 6 | 7 | 41.5 | 0.9943 |
| e5-small-v2 | PASS | 384 | 171 | 5 | 6 | 38.5 | 0.9966 |
| gte-small | PASS | 384 | 165 | 4 | 4 | 40.6 | 0.9976 |
| nomic-v1.5 | PASS | 768 | 308 | 19 | 20 | 11.6 | 0.9806 |
| multilingual-e5-small | PASS | 384 | 504 | 5 | 6 | 31.2 | 0.9962 |

Every model passed all ten checks: correct dimension, worker-reported width
matching the vector, no NaN/Inf, L2 norm 1.000, bit-identical determinism across
repeated calls, batch-equals-single, correct batch shape, prefix actually
changing the vector, long-input truncation without throwing, and
unload/reload returning the same vector.

Raw results: `results/local-embedding-sanity.json`.

**No round-1 candidate is BLOCKED.** Every one loads in Natively's real runtime
with no new dependency, no custom code and no unsupported operator — including
`nomic-v1.5`, whose `nomic_bert` architecture needs `trust_remote_code` in
Python but is a plain exported graph in ONNX.

### Round 2 additions (see §8b)

| model | status | dim | load ms | query p50 | query p95 | chunks/s | batch≡single |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| arctic-l | PASS | 1024 | 707 | 49 | 54 | 4.7 | 0.9885 |
| bge-large-en | PASS | 1024 | 523 | 115 | 646 | 4.0 | 0.9828 |
| e5-large-v2 | PASS | 1024 | 638 | 56 | 72 | 3.8 | 0.9967 |
| multilingual-e5-base | PASS | 768 | 744 | 15 | 16 | 12.1 | 0.9699 |
| **gte-large** | **FAIL** | 1024 | 672 | 40 | 41 | 4.5 | 0.9925 |

`gte-large` fails exactly one check — `longInput` — and that single failure is
disqualifying for Natively: see §8b for the diagnosis
(`model_max_length: 1e30`). Everything else about it is healthy, which is
precisely why a benchmark that only embedded short probes would have passed it.

The four 1024-dim models confirm the §5 width fix works beyond 768: correct
1024-wide vectors, unit-norm, deterministic. Note also that width costs
throughput steeply — 3.8–4.7 chunks/s against MiniLM's 76.7.

### Cost of width

The two 768-dim candidates are roughly **4–5× slower per query** (18–19 ms p50
vs 4–6 ms) and **3–6× slower to index** than the 384-dim field. That is the
practical price of the higher-capacity models, measured on this machine rather
than inferred.

---

## 8. Retrieval benchmark

### What is real in this track, precisely

| component | what ran |
| --- | --- |
| chunking | real `semanticChunks()`, `CHUNKER_VERSION = 4`, `DEFAULT_CHUNK_OPTIONS` untouched |
| embedding | real `LocalEmbeddingProvider` (the shipped class), worker-isolated ONNX |
| query/document split | real `embedQuery` / `embedBatch`, real per-model prefixes |
| vector index | real sqlite-vec `vec0`, production DDL incl. `distance_metric=cosine` |
| KNN | the same SQL `VectorStore.searchSimilarNative` issues, same LE float32 blob |
| **not** used | the `VectorStore` *wrapper class* — `storeEmbedding` calls `DatabaseManager.getInstance()` and its search joins `chunks`→`meetings`, a meeting-transcript schema a reference corpus does not populate. The index and metric are production's; the wrapper is bypassed. §12 (live session) exercises the untouched wrapper. |

Corpus: 872 chunks from 59 files, sha256 `41e7b76b1f69c81b…`, **asserted by every
model before it embeds anything**, so "every model saw identical text" is
verified rather than assumed. 503 scorable queries, 65/65 ground-truth facts
reachable.

Relevance is deterministic, no LLM judge: a chunk counts as relevant when it
contains a ground-truth fact's text, or a ≥40-character complete sentence of an
accepted region, under whitespace normalization. Span-overlap scoring was not
available — the chunker returns no source offsets and prefixes every chunk with
`[Section N.N | pX] [context: …]`, so a chunk is not a substring of its source.
The existing harness's `accept_sets.json` is honoured (§12): without it, MiniLM's
top-5 for the free-tier query was five chunks that each state the correct
answer, all scored as misses.

### Head-to-head at matched configuration

503 queries, 872 chunks, identical chunking/preprocessing/top-K/hardware/runtime.

| model | installed MiB | dim | R@1 | R@5 | **R@10** | MRR | nDCG@10 | cand. recall@50 | q p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multilingual-e5-small | 129.1 | 384 | 0.0895 | 0.2286 | **0.3340** | 0.1533 | 0.1719 | 0.6223 | 10 ms |
| e5-small-v2 | 33.1 | 384 | 0.0875 | 0.2127 | **0.3201** | 0.1451 | 0.1690 | 0.6123 | 8 ms |
| bge-small-en | 33.1 | 384 | 0.0835 | 0.1909 | **0.3022** | 0.1352 | 0.1555 | 0.5765 | 9 ms |
| arctic-m | 105.7 | 768 | 0.0716 | 0.1928 | **0.2883** | 0.1283 | 0.1478 | 0.5646 | 24 ms |
| nomic-v1.5 | 131.6 | 768 | 0.0934 | 0.2028 | **0.2763** | 0.1405 | 0.1552 | 0.5487 | 30 ms |
| arctic-s | 33.1 | 384 | 0.0656 | 0.1869 | **0.2565** | 0.1115 | 0.1321 | 0.4811 | 8 ms |
| gte-small | 33.1 | 384 | 0.0775 | 0.1590 | **0.2366** | 0.1147 | 0.1281 | 0.4453 | 6 ms |
| **minilm-baseline** | 22.6 | 384 | 0.0616 | 0.1551 | **0.2127** | 0.1012 | 0.1166 | 0.5209 | 4 ms |
| arctic-xs | 22.6 | 384 | 0.0577 | 0.1412 | **0.1988** | 0.0936 | 0.1071 | 0.4314 | 4 ms |

### Paired bootstrap vs the freshly-measured MiniLM (the brief's §21, §22)

Paired over the same 503 queries, 2000 replicates, deterministic seed. An
interval spanning zero is reported as within noise, never as a win.

| model | Δ R@10 | 95% CI | verdict |
| --- | ---: | --- | --- |
| multilingual-e5-small | **+0.1213** | [0.0835, 0.1610] | **better** |
| e5-small-v2 | **+0.1074** | [0.0696, 0.1471] | **better** |
| bge-small-en | **+0.0895** | [0.0537, 0.1272] | **better** |
| arctic-m | **+0.0755** | [0.0378, 0.1153] | **better** |
| nomic-v1.5 | **+0.0636** | [0.0239, 0.1034] | **better** |
| arctic-s | **+0.0437** | [0.0080, 0.0775] | **better** |
| gte-small | +0.0239 | [−0.0099, 0.0557] | within noise |
| arctic-xs | −0.0139 | [−0.0457, 0.0199] | within noise |

**Six of eight candidates beat the incumbent by a statistically real margin.**

### Findings that contradict the brief's expectations

**Arctic XS does not beat MiniLM here.** §4 proposed it as "the ultra-small
replacement for MiniLM" on the strength of its card's MTEB retrieval comparison.
On Natively's own corpus, through Natively's own chunker, it is −0.0139 R@10
with an interval spanning zero — indistinguishable from the incumbent, and the
worst absolute score in the field. Arctic S, one size up, *is* a real
improvement (+0.0437). This is exactly the gap between a public leaderboard
number and a Natively retrieval result that §21 warns against.

**Size does not predict quality above ~33 MiB.** The two largest candidates
(`nomic-v1.5` 131.6 MiB, `arctic-m` 105.7 MiB) are both beaten by `e5-small-v2`
at 33.1 MiB, while costing 3–7× the query latency. The 768-dim models buy
nothing here. This claim rests on `arctic-m` independently of the caveat below:
`arctic-m` indexed at the same batch 16 as everything else.

### `nomic-v1.5` indexed at a different batch size — measured, and it does not matter

`nomic-v1.5` is the one model that did not index at batch 16. It **SIGTRAPs
inside ONNX Runtime** partway through bulk indexing at that batch size — the
same native-abort signature as the known ephemeral batch-embed OOM — and only
completed at **batch 4**. Every other model in the table used batch 16.

Batch size does perturb the vectors — padding to the longest sequence in the
batch is why this benchmark's own sanity data puts batch-vs-single cosine at
0.976–0.998. So rather than argue about whether that matters, it was
**measured**: `e5-small-v2` was re-run end to end at batch 4 and compared
against its own batch-16 run, same corpus, same queries, same index.

| metric | batch 16 | batch 4 | Δ |
| --- | ---: | ---: | ---: |
| R@1 | 0.0875 | 0.0875 | 0.0000 |
| R@5 | 0.2127 | 0.2147 | +0.0020 |
| **R@10** | **0.3201** | **0.3201** | **0.0000** |
| MRR | 0.1451 | 0.1448 | −0.0003 |
| nDCG@10 | 0.1690 | 0.1685 | −0.0005 |

**R@10 is identical and the largest movement across any metric is 0.0020** —
two orders of magnitude below `nomic-v1.5`'s +0.0636 and well inside its
interval's distance from zero. The batch-size difference is therefore **not** a
confound for the quality comparison, and `nomic-v1.5`'s delta can be read
normally.

Its **throughput** figure (3.3 chunks/s) remains not comparable — that is a
batch-4 number against everyone else's batch-16, and it is a throughput
measurement, not a quality one.

Raw: `results/batch-size-control-e5-small-v2-batch4.json`.

### Absolute values are NOT comparable to the historical benchmark

The brief cites `all-MiniLM-L6-v2` at R@10 = 0.443 from the previous harness.
The fresh measurement here is **0.2127**. That is not a regression — it is a
different measurement:

- The old harness swept **five chunk sizes and three overlaps**; Natively's
  production chunker has **no overlap**, so a fact appears in one chunk rather
  than several, and recall is structurally lower.
- The old harness scored **span overlap** (any chunk touching the span);
  this scores **evidence containment**.
- The old harness's MiniLM was almost certainly sentence-transformers **fp32**;
  Natively runs transformers.js **q8**.

§21 asks for a freshly measured baseline through the same code path, which is
what the delta column above uses. The historical 0.443 is reported here only to
say explicitly that it must not be compared against these numbers.

### Per-category results (the brief's §22)

A single R@10 hides real disagreement — the ranking changes by category.

| model | text (239) | code (105) | long-doc (100) | hard-negative (59) | multilingual (15) |
| --- | ---: | ---: | ---: | ---: | ---: |
| multilingual-e5-small | 0.3556 | **0.3714** | 0.2000 | 0.4068 | **0.5333** |
| e5-small-v2 | — | 0.3238 | **0.2700** | — | 0.3333 |
| bge-small-en | — | 0.3333 | 0.1600 | — | 0.4000 |
| arctic-m | — | 0.2667 | 0.1900 | — | 0.4000 |
| arctic-s | — | 0.2571 | 0.2000 | — | 0.4667 |
| nomic-v1.5 | — | 0.2857 | 0.1900 | — | 0.3333 |
| gte-small | — | 0.2476 | 0.1600 | — | 0.2667 |
| **minilm-baseline** | — | **0.1714** | 0.2100 | — | 0.3333 |
| arctic-xs | — | 0.1714 | 0.1500 | — | 0.3333 |

**Code retrieval is where the incumbent is weakest.** MiniLM manages 0.1714 on
the code track; `multilingual-e5-small` more than doubles it at 0.3714 and three
other candidates exceed 0.32. Given the brief's note that code and developer
material "matters disproportionately for Natively", this is the single largest
practical gap found.

**Long documents are the one track where MiniLM is competitive** (0.2100, beaten
only by `e5-small-v2`'s 0.2700). Nothing here recommends a 768-dim model for
long content: `arctic-m` and `nomic-v1.5` both score *below* the incumbent.

**Multilingual-E5 wins its own track** (0.5333 vs the incumbent's 0.3333) and
loses nothing in English — it is simultaneously the best overall model. n=15, so
this is directional rather than tight; see §13 limits.

### Cross-file / multi-hop track (the brief's §13 — 75 queries, scored separately)

These queries carry `target_facts: []` — the original harness scores them on
**required-file recall**, not fact spans, because the answer deliberately spans
two to four files. Feeding them through the fact scorer silently dropped all 75
(the first pass reported `cross_project_R@10: null` for that reason). Scored
correctly, reusing each model's already-built index:

| model | any file @10 | **all files @10** | file recall @10 | all files @50 |
| --- | ---: | ---: | ---: | ---: |
| **bge-small-en** | **0.6757** | **0.1757** | **0.3953** | **0.4730** |
| e5-small-v2 | 0.5676 | 0.1622 | 0.3491 | 0.4324 |
| arctic-m | 0.5135 | 0.1622 | 0.3300 | 0.4054 |
| nomic-v1.5 | 0.5135 | 0.1216 | 0.3029 | 0.3649 |
| multilingual-e5-small | 0.4865 | 0.1486 | 0.3007 | 0.3784 |
| arctic-s | 0.5000 | 0.0946 | 0.2770 | 0.3378 |
| gte-small | 0.5000 | 0.0676 | 0.2669 | 0.1892 |
| arctic-xs | 0.4324 | 0.0811 | 0.2545 | 0.2568 |

**`bge-small-en` leads this track**, though it is third overall — the clearest
example of why a single ranking would be misleading. Multi-hop retrieval is hard
for every candidate: even the best model assembles *all* required files for only
18% of queries at K=10, rising to 47% at K=50. That gap between @10 and @50 is
the argument for reranking a wide pool rather than trusting top-10.

The baseline's cross-file row is pending — its index was being rewritten by the
reranker pass when this track ran.

### Per-model raw output

`results/raw-retrieval/<model>.json` (per-query records included),
`results/local-embedding-benchmark.json`, `results/local-embedding-benchmark.csv`.

---

## 8b. Round 2 — the widest variant of each family

Round 1 took the *small* member of every family. Round 2 takes the **widest
member that fits the 500 MiB cap**: 1024-dim where possible, 768-dim where the
1024 variant breaches it. This is also the first real exercise of the
tensor-width fix (§5) at **1024 dimensions** — round 1 only reached 768.

| key | repo | dim | installed | verdict |
| --- | --- | ---: | ---: | --- |
| `arctic-l` | `Snowflake/snowflake-arctic-embed-l` | 1024 | 322.1 MiB | scored |
| `bge-large-en` | `Xenova/bge-large-en-v1.5` | 1024 | 322.1 MiB | scored |
| `e5-large-v2` | `Xenova/e5-large-v2` | 1024 | 322.1 MiB | scored |
| `multilingual-e5-base` | `Xenova/multilingual-e5-base` | 768 | 282.0 MiB | scored |
| `gte-large` | `Xenova/gte-large` | 1024 | 322.1 MiB | **BLOCKED** |
| `multilingual-e5-large` | `Xenova/multilingual-e5-large` | 1024 | **552.0 MiB** | **EXCLUDED — installed artifact > 500 MiB** |

`nomic-v1.5` (768) and MiniLM (384) are already at their families' maximum
width; the 384-dim models cannot emit 768 at all, so "run them at 768" is only
meaningful as "use the wider sibling", which is what this round does.

### The width fix holds at 1024

All four 1024-dim models returned correctly-shaped 1024-wide vectors, unit-norm,
bit-identical across repeated calls, with batch-equals-single cosines of
0.982–0.997. The defect in §5 would have silently mangled every one of them.

### Two genuine runtime failures

**`gte-large` — INTEGRATION FAILURE, and the cause is exact.** It throws inside
ONNX on any input over 512 tokens:

```
Non-zero status code returned while running Add node. Name:'/embeddings/Add_1'
Attempting to broadcast an axis by a dimension other than 1. 512 by 1931
```

The cause is its **`tokenizer_config.json`, which declares
`model_max_length: 1e30`**. transformers.js therefore never truncates, the
sequence overruns the model's 512 position embeddings, and the position-embedding
add fails. Compare the same field across the repos actually used here:

| model | `model_max_length` | long input |
| --- | ---: | --- |
| `gte-small` | 512 | OK |
| `e5-large-v2` | 512 | OK |
| `bge-large-en` | 512 | OK |
| **`gte-large`** | **1e+30** | **throws** |

This is a **packaging defect in that repository, not a property of GTE** — the
small sibling is correctly configured and passed. It matters for Natively
specifically because the chunker's hard cap is 1000 tokens and **17 of the 872
corpus chunks exceed 512**, so indexing dies on roughly 2% of a real corpus.
Any future model adoption should validate `model_max_length` before shipping,
or truncate explicitly rather than trusting the repo.

**The three 335M/1024-dim models exceed Natively's per-batch embed timeout.**
At Natively's batch of 16, `arctic-l`, `bge-large-en` and `e5-large-v2` all hit:

```
[LocalEmbeddingProvider] Worker request 2 timed out after 30000ms
```

`WORKER_EMBED_TIMEOUT_MS` is **30 s** (`LocalEmbeddingProvider.ts:39`), and a
16-chunk batch of real 350–1000-token chunks at 1024 dimensions does not fit
inside it. All three complete at batch 4. This is the **same class of problem as
`nomic-v1.5`'s SIGTRAP** and it is now the rule rather than the exception:
**every model above ~130 MiB in this benchmark required a reduced ingest batch.**
Adopting any of them means making the embed batch size per-model, not global.

(The batch-size control in §8 measured the effect of batch 4 vs 16 on R@10 at
**0.0000**, so these rows remain comparable on quality.)

### Results — does more width actually buy anything?

Ranked by **reranked R@10**, the stack Natively actually ships:

| model | MiB | dim | dense R@10 | **reranked R@10** | unrecoverable | q p95 | ingest batch |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `e5-large-v2` | 322.1 | 1024 | 0.3380 | **0.4333** | 46.7% | 54 ms | **4** |
| `multilingual-e5-base` | 282.0 | 768 | 0.3201 | **0.4333** | 45.0% | 19 ms | 16 |
| `e5-small-v2` | 33.1 | 384 | 0.3201 | 0.4167 | 51.7% | 8 ms | 16 |
| `arctic-l` | 322.1 | 1024 | **0.3459** | 0.3833 | 50.0% | 76 ms | **4** |
| `multilingual-e5-small` | 129.1 | 384 | 0.3340 | 0.3667 | 45.0% | 10 ms | 16 |
| `minilm-baseline` | 22.6 | 384 | 0.2127 | 0.3667 | 53.3% | 4 ms | 16 |
| `bge-large-en` | 322.1 | 1024 | 0.3042 | 0.3500 | 60.0% | 79 ms | **4** |

`arctic-l` takes the **dense** crown (0.3459, +0.1332 vs MiniLM — the largest
paired delta in the benchmark) but falls to 4th once the reranker runs.

### The conclusion width forces

**Going wider buys very little, and costs a great deal.**

| | `e5-small-v2` | `e5-large-v2` | change |
| --- | ---: | ---: | ---: |
| installed | 33.1 MiB | 322.1 MiB | **9.7×** |
| query p95 | 8 ms | 54 ms | **6.8×** |
| ingest batch | 16 | 4 | forced down |
| dense R@10 | 0.3201 | 0.3380 | +0.0179 |
| **reranked R@10** | **0.4167** | **0.4333** | **+0.0166** |

Ten times the disk and seven times the latency, for **+0.0166 reranked R@10** —
a difference smaller than the gap between adjacent models in the small tier, and
one that requires abandoning Natively's ingest batch size to obtain.

**`multilingual-e5-base` is the strongest of the large tier**, not the 1024-dim
models: it ties `e5-large-v2`'s best-in-benchmark 0.4333 while keeping **batch
16**, a 19 ms p95 (a third of `e5-large-v2`'s), 40 MiB less disk, and the
lowest unrecoverable rate in the field alongside `multilingual-e5-small`. If
something larger than 33 MiB is wanted, this is the one that behaves.

**The BGE family wins cross-file at both sizes** — `bge-small-en` 0.6757 and
`bge-large-en` 0.6351 any-file@10, first and second. A family trait, not a
size effect; `bge-large-en` is otherwise the weakest of the large tier.

Raw: `results/raw-retrieval/`, `results/crossfile/`, `results/rerank/`.

---

## 8c. Comparison with earlier results

Two separate comparisons, kept apart because only one of them is a fair fight.

### A. Round 1 vs Round 2 — same harness, same corpus, same queries

This **is** a fair comparison: identical chunk set (sha256 `41e7b76b…`), identical
503 queries, identical index and metric. Only the model changed.

| family | small variant | widest under cap | Δ dense R@10 | Δ reranked R@10 | size multiple |
| --- | --- | --- | ---: | ---: | ---: |
| **Arctic** | `arctic-xs` 384d · 0.1988 | `arctic-l` 1024d · **0.3459** | **+0.1471** | +0.2333 | 14.2× |
| | `arctic-s` 384d · 0.2565 | `arctic-l` 1024d · 0.3459 | +0.0894 | +0.0500 | 9.7× |
| **BGE** | `bge-small-en` 384d · 0.3022 | `bge-large-en` 1024d · 0.3042 | **+0.0020** | +0.0167 | 9.7× |
| **E5** | `e5-small-v2` 384d · 0.3201 | `e5-large-v2` 1024d · 0.3380 | +0.0179 | +0.0166 | 9.7× |
| **Multilingual-E5** | `multilingual-e5-small` 384d · 0.3340 | `multilingual-e5-base` 768d · 0.3201 | **−0.0139** | **+0.0666** | 2.2× |
| **GTE** | `gte-small` 384d · 0.2366 | `gte-large` — | — | — | BLOCKED |
| **Nomic** | — | `nomic-v1.5` 768d · 0.2763 | — | — | already widest |

Three results worth stating plainly:

**BGE gains essentially nothing from 10× the size** — `bge-small-en` 0.3022 →
`bge-large-en` 0.3042 is **+0.0020 dense R@10**, far inside noise, for 33.1 MiB →
322.1 MiB. It is the cleanest demonstration in the benchmark that width is not
where the quality is.

**Multilingual-E5 gets *worse* on dense retrieval going from small to base**
(0.3340 → 0.3201) while getting substantially *better* after reranking
(0.3667 → **0.4333**). The wider model orders its top-10 less well but puts more
relevant material in the pool (unrecoverable 45.0% for both, but the base
converts far better under the cross-encoder). A dense-only evaluation would have
picked the wrong one.

**Arctic is the only family where width genuinely pays** (+0.1471 over
`arctic-xs`), and that is mostly because `arctic-xs` is the weakest model in the
benchmark. Measured against the fairer `arctic-s`, the gain is +0.0894 — real,
but bought with 9.7× the disk and a forced ingest-batch reduction.

### B. This benchmark vs the earlier Python harness — NOT a fair comparison

`embedding-benchmark/reports/MASTER-main.md` (2026-08-31) reports
`minilm-l6-v2` at **R@10 0.443**; this benchmark measures **0.2127** for the same
model name. That is not a regression, and the two numbers must not be subtracted.
They are different measurements of different things:

| | earlier harness | this benchmark |
| --- | --- | --- |
| purpose | which **cloud** model to ship as default | which **local** model ≤500 MiB |
| incumbent compared against | `gemini-embedding-2` (3072d, cloud) | `Xenova/all-MiniLM-L6-v2` (bundled) |
| chunking | `naiv-1024-10` — naive 1024-token windows, **10% overlap** | Natively `semanticChunker` v4, boundary-driven, **no overlap** |
| relevance rule | character-**span overlap** | evidence **containment** (fact text or ≥40-char sentence) |
| MiniLM runtime | Python / sentence-transformers (fp32) | transformers.js **q8** in Natively's ONNX worker |
| reranker | Voyage **rerank-2.5** (cloud, paid) | `ms-marco-MiniLM-L-6-v2` q8 (bundled, local) |
| corpus | 79 files, 660 queries | 59 files → 872 chunks, 503 scorable queries |
| runner | standalone Python | Natively's real chunker + provider + sqlite-vec |

The two structural causes of the gap are both mechanical: **overlap** (a fact
straddling a boundary appears in two windows there and one chunk here) and the
**stricter relevance rule**. The earlier harness also measured MiniLM at its own
best configuration, `naiv-4096-10`, where it reached **0.505** — further still
from anything measurable on Natively's production chunker, which has no 4096-token
setting.

The brief's §21 asks for a *freshly measured* baseline through the same code
path, which is exactly why every delta in this document is against the 0.2127
figure and never against 0.443.

### What reproduced across both benchmarks

Despite sharing no code, no chunker and no reranker, three findings replicate —
which is the strongest evidence in either document that they are properties of
the problem rather than of a harness:

| finding | earlier harness | here |
| --- | --- | --- |
| **Reranking dominates model choice** | +0.153 R@5 (rerank-2.5); "the spread between models collapses from 0.044 to 0.009" | +0.1334 R@10 (local ms-marco) — larger than every model-vs-model delta |
| **Two models cannot share one index** | at every mix ratio each model retrieved 100% its own vectors | enforced structurally: one DB file per model, keyed by space |
| **Bigger/pricier is not better** | `qwen3-embedding-8b` (4096d) *lost* to the 1024d incumbent | `bge-large-en` gains +0.0020 over `bge-small-en` for 9.7× the size |

The earlier harness's fourth headline — that whitespace normalisation was worth
more than the model choice (0.42 R@10 in one column) — is precisely why this
benchmark hashes one shared chunk set and makes every model assert it before
embedding (§8).

---

## 9. Live session — what actually happened inside Natively

`scripts/embedding-live-session.mjs` launches the **real Electron app** against
an isolated throwaway `userData`, attaches over CDP, and drives the real E2E IPC
surface. Not Playwright (it breaks `safeStorage`), and never the user's own
profile.

### The app path works end to end

| stage | result |
| --- | --- |
| app launch + CDP attach | OK |
| `e2eInvoke` bridge | OK |
| `modes:create` | OK, real mode id |
| `embedding:set-config {provider:'local'}` | OK → `activeSpace: local:xenova/all-minilm-l6-v2:384` |
| real upload × 6 formats | **all OK** through the real parser |
| `__e2e__:inspect-retrieval` | OK, real context block returned |

Real uploads, one per major supported category, through
`ModeReferenceFileIngestion` (§2's real parser path):

| file | category | result | extracted chars | ingest |
| --- | --- | --- | ---: | ---: |
| `billing-notes.md` | markdown | OK | 760 | 15 ms |
| `billing-notes.txt` | plain text | OK | 749 | 5 ms |
| `subscriptions.ts` | code | OK | 272 | 3 ms |
| `limits.json` | json | OK | 99 | 3 ms |
| `plans.csv` | csv | OK | 59 | 2 ms |
| `overview.html` | html | OK | 58 | 4 ms |

The `.html` row is worth noting: 58 extracted characters from a document whose
markup is ~180 bytes — `htmlToText()` flattening the table as §2 describes.

### The live track did NOT reach the dense path — and why

**Every live run indexed `lexical_only` with `embeddedChunkCount: 0`.** No
per-model live retrieval quality number is reported, because a run that embedded
nothing proves nothing about an embedding model. Three separate causes were
identified, each confirmed from source:

1. **A credential-less install indexes reference files lexical-only.** With no
   cloud keys, `EmbeddingProviderResolver` logs *"No cloud/Ollama provider
   available; using bundled local embedding model lazily"* and files land
   `lexical_only`. `[ProviderStatus] local-embedding ready` appears in the log
   but means only that the packaged **asset** loads — not that anything was
   embedded.

2. **`ModeHybridRetriever` deliberately forces lexical for a local + manual
   query.** `shouldUseLexicalForLocalManualQuery()`
   (`ModeHybridRetriever.ts:1215`) returns true when the active provider is
   `local` and meeting state is not explicitly "no meeting" — an ONNX-arena
   pressure guard, already narrowed on 2026-09-19 so `meetingActive === false`
   lifts it. `__e2e__:inspect-retrieval` cannot pass `meetingActive`, so it
   arrives `undefined` and the conservative branch holds. **Harness limitation,
   not a product defect.** Worked around with
   `NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL=0`.

3. **The re-index path skipped embedding when the provider was not yet loaded,
   and never forced the load.** — **FIXED 2026-09-21, live-verified. See §9b.** `LocalEmbeddingProvider.isLoaded()` deliberately
   reports false until the first real `embed()`, so `EmbeddingPipeline.isReady()`
   is false and `retryAllLexicalOnlyFiles()` / `indexReferenceFile()` decline to
   block on it. `__e2e__:reindex-embeddings` returned in 13–30 ms having embedded
   nothing, and the worker never logged *"Loading feature-extraction model"*.
   This persisted after cause 2 was cleared.

Scoped precisely: the lazy load itself is **not** broken. The §8 runs drove the
same `LocalEmbeddingProvider` down the same lazy path and it loaded and embedded
all 872 chunks — because something actually called `embedBatch`. The live
finding is narrower and specific: *the re-index entry points do not trigger that
first call*, so a mode whose files were ingested before the pipeline was ready
stays `lexical_only` when re-indexed. This is worth a product owner's eye; it is
**not** evidence that a key-less user's local vectors are never built, and this
report makes no such claim.

An attempt to force the load via `embedding:test {provider:'local'}` returned
`not_configured`: `buildCandidates()` does not include the bundled fallback,
which is registered separately as `fallbackProvider`. So **the Settings "Test"
button cannot test the bundled local model** — a small, separate observation.

### What this means for the benchmark

The §8 retrieval numbers stand on their own: they were produced by the real
`LocalEmbeddingProvider` through the real chunker into a real sqlite-vec index,
verified by a per-run assertion that the native index was live and held all 872
rows. What the live track adds is the **application-level integration picture**,
and there it found three concrete reasons the local embedder can be present,
healthy, and unused. Raw evidence: `results/live-session/*.json`.

---

## 9b. The re-index defect — fixed and live-verified

The third live-session cause (§9) was a real production deadlock, not a harness
artifact. Two `EmbeddingPipeline` methods disagreed about what "ready" meant:

```
isReady()      = provider !== null && provider.isLoaded()   -> FALSE  (lazy, not loaded)
waitForReady() = `if (this.provider) return;`               -> resolves IMMEDIATELY
```

The bundled local model is registered lazily — assigned at once, ONNX session
built only on the first real `embed()`, with `isLoaded()` reporting false until
then *by design*, so a live query routes to lexical instead of stalling on a
60-second model load.

Indexing inherited that gate. `reindex-embeddings` awaited `waitForReady()`, got
an instant resolve, then failed its own `isReady()` check and wrote every file
off as `lexical_only`. **Nothing in the indexing path ever performs the embed
that would load the model, so the retry path hit the same gate forever** — a
deadlock, not a race. A user who never records a meeting (meeting ingest embeds
directly and would break the cycle) could have reference files that are never
vectorised at all.

### The fix

`EmbeddingPipeline.ensureProviderLoaded()` forces the load for callers that can
afford to block, and `ModeHybridRetriever.indexFileInner` calls it **only on the
indexing path** before deciding `lexical_only`. The query path is untouched —
stalling a live turn on a cold load is precisely what `isLoaded()` exists to
prevent, and a test pins that. A provider that does not implement `isLoaded()`
(every cloud provider) returns immediately with no probe, so no hosted provider
gains a network call.

### Verified, in this order

**Failing first.** `LazyLocalEmbedderIndexesVectors2026_09_21.test.mjs` was
written against the unfixed code and failed exactly the two indexing assertions
while the query-path and already-loaded guards passed — so the guards are not
vacuous. After the fix, 5/5 pass.

**Then in the real application.** The same live-session harness that exposed the
defect, re-run unchanged:

| | before | after |
| --- | --- | --- |
| `reindex-embeddings` | 13–30 ms | **302 ms** |
| chunks embedded | **0 / 9** | **9 / 9** |
| file status | `lexical_only` ×6 | `ready` ×6 |
| worker log | *(no model load)* | `[LocalEmbeddingWorker] Loading feature-extraction model` → `loaded successfully` |
| 2nd/3rd query latency | 983 / 1627 ms | **8 / 5 ms** |

Raw: `results/live-session/minilm-baseline.json`.

**This also closes the §9 gap**: the live session now reaches the dense path, so
a per-model live retrieval run is possible where previously it was not.

---

## 9c. Live session — all 13 models, in the real application

Now that §9b's fix lets the bundled embedder actually build vectors, every scored
model was driven through the real Electron app (isolated `userData`, real parser,
real `ModesManager` index, real `ModeHybridRetriever`), one at a time, in
**production mode**.

| model | model loaded in-app (worker log) | embedded | top-1 correct | dense-scored snippets | query ms (q1/q2/q3) |
| --- | --- | ---: | ---: | ---: | --- |
| minilm-baseline | `Xenova/all-MiniLM-L6-v2` | 9/9 | 3/3 | 17/17 | 206 / 2 / 4 |
| arctic-xs | `Snowflake/snowflake-arctic-embed-xs` | 9/9 | 3/3 | 27/27 | 7 / 2 / 4 |
| arctic-s | `Snowflake/snowflake-arctic-embed-s` | 9/9 | 3/3 | 27/27 | 58 / 10 / 39 |
| arctic-m | `Snowflake/snowflake-arctic-embed-m` | 9/9 | 3/3 | 14/14 | 325 / 3 / 22 |
| arctic-l | `Snowflake/snowflake-arctic-embed-l` | 9/9 | 3/3 | 27/27 | 555 / 5 / 615 |
| bge-small-en | `Xenova/bge-small-en-v1.5` | 9/9 | 3/3 | 27/27 | 10 / 2 / 5 |
| bge-large-en | `Xenova/bge-large-en-v1.5` | 9/9 | 3/3 | 27/27 | 635 / 6 / 637 |
| e5-small-v2 | `Xenova/e5-small-v2` | 9/9 | 3/3 | 27/27 | 13 / 7 / 5 |
| e5-large-v2 | `Xenova/e5-large-v2` | 9/9 | 3/3 | 27/27 | 697 / 2 / 607 |
| gte-small | `Xenova/gte-small` | 9/9 | 3/3 | 27/27 | 7 / 1 / 6 |
| nomic-v1.5 | `nomic-ai/nomic-embed-text-v1.5` | 9/9 | 3/3 | 27/27 | 105 / 3 / 35 |
| multilingual-e5-small | `Xenova/multilingual-e5-small` | 9/9 | 3/3 | 27/27 | 17 / 2 / 19 |
| **multilingual-e5-base** (chosen) | `Xenova/multilingual-e5-base` | 9/9 | **3/3** | 27/27 | 629 / 7 / 661 |

> **Correction (2026-09-22).** Four rows of this table (`arctic-l`,
> `bge-large-en`, `e5-large-v2`, `multilingual-e5-base`) came from runs where
> the app **also selected Gemini** part-way through (the init race in §9d), so
> their retrieval may have been served by Gemini rather than the model named.
> Their clean production-mode runs (`results/live-session/<model>.prod.*`, local
> provider only, verified from the log) also scored **3/3 correct at rank 1 on
> the dense path**, so the conclusion stands. The contaminated runs are not
> evidence for it. The other nine rows were local-only throughout.

**39 of 39 queries put a chunk containing the literal answer first.** For every
model the worker log names the model that was actually loaded, so no row can be
MiniLM mislabelled as a candidate. Every returned snippet carries a numeric
`vectorScore`, which is direct proof that the dense arm scored it (§9's harness
reached only the lexical path).

What this track does and does not show. It proves each model **works inside
Natively end to end**: upload, parse, chunk, embed, persist, retrieve. It does
**not** rank models against each other. Six small files and three direct
questions are easy enough that every model gets them right; the quality ranking
comes from §8's 503-query benchmark, not from here.

Two real observations:

- **Wide models cost ~600 ms on some queries in the live app** (q1/q3 for
  `arctic-l`, `bge-large-en`, `e5-large-v2`, `multilingual-e5-base`), against
  single-digit ms for the 384-dim models. That is the user-visible latency cost
  of the chosen default, measured in the real app.
- **`arctic-m` admits fewer chunks** (4–5 per query against 9 for most models)
  but still ranks the answer first. That is consistent with a different cosine
  distribution interacting with the fixed `0.4·lexical + 0.6·cosine ≥ 0.15`
  admission floor. Observed, not investigated further.

### A false alarm, and what caused it

The first two sweeps reported the **wide models returning zero snippets on fully
`ready` indexes**, intermittently, including `multilingual-e5-base`. An earlier
version of this section called that a product defect. **It was not.** Every miss
had `ok=false`, every success `ok=true`. Once CDP-level errors were surfaced
instead of being read as `undefined`, the cause was explicit:

```
CDP: Inspected target navigated or closed
```

In development mode every window loads the Vite dev server at
`http://127.0.0.1:5180`. The harness ran no dev server, so windows kept failing
(`ERR_CONNECTION_REFUSED`) and **reloading underneath the CDP session**, and any
call in flight during a reload was lost. The slower-starting 768/1024-dim models
overlapped that reload window most, which made a harness fault look like a
model-size effect. The same artifact produced an apparent "queries during
indexing return nothing", which is also withdrawn.

Fixed in the harness by running the app in **production mode** (the renderer
loads `dist/index.html` over `file://`, with nothing to retry; this is what users
run) and by recording CDP errors explicitly so a lost call can never again be
read as an empty result. The pre-fix sweeps are kept under
`results/live-session-early-read/` as evidence.

The harness also now **backs up and restores `~/Documents/natively_debug.log`**
around every run. Earlier runs truncated it, which is what failed
`AdversarialNewInstall` (§9b).

Raw: `results/live-session/<model>.json`, with the full app log beside each.

---

## 9d. A real bug found by the live comparison: a stale embedding init overwrites the user's choice

The live-session model comparison (§9e) first reported **three different
embedders producing byte-identical evidence on all 503 questions**, including
identical per-snippet cosine scores (0.769, 0.763, 0.616…). Two models cannot
produce identical cosines, so a single provider was serving every run. The app
log showed which one, and why:

```
line   2  dotenv: injected env (68) from .env           ← cloud keys, read from the CWD
line  91  EmbeddingPipeline: Initializing  (mode: auto)   ← boot init starts, probes cloud
line 325  openai probe 1/3 failed — retrying …            ← 429s: the boot init is SLOW
line 264  EmbeddingPipeline: Initializing  (mode: manual, provider: local)  ← user's choice
line 276  Selected provider: local (384d)                  ← …honoured
line 643  Selected provider: gemini (3072d)                ← the BOOT init finally finishes
line 646  RAGManager: running on gemini while the selected provider is unavailable
```

`EmbeddingPipeline.initialize()` starts `_doInitialize()` immediately, without
awaiting or cancelling one already in flight, and `_doInitialize()` assigns
`this.provider = resolution.provider` unconditionally after its `await`. When two
initializations overlap, **whichever resolve finishes last wins**, not whichever
was requested last. A slow boot-time "auto" resolve (cloud probes retrying a
429, or finding a local Ollama server) can therefore complete *after* a newer
explicit selection and silently replace it.

Consequences:

- **Privacy.** A user who explicitly selects on-device embeddings can end up
  embedding their reference documents with a **cloud** provider, while Settings
  shows the choice they made.
- **Correctness.** Files indexed before and after the switch land in different
  spaces. Measured in one run's database: chunk rows in both
  `gemini:gemini-embedding-2:3072` and the local 384-d space, while every file
  reported `ready`.
- The window is widest at launch, which is exactly when Settings changes, key
  saves and a first-run trial token arrive.

Scope of evidence. Reproduced repeatedly in live runs, and it contaminated four
rows of §9c (corrected there). The root cause is confirmed by reading
`initialize()` / `_doInitialize()`: there is no generation guard.

**FIXED 2026-09-22.** `initialize()` now bumps a monotonically increasing
`initGeneration`, and `_doInitialize()` checks it after each of its two awaits
(local-provider disposal and the resolve). A superseded initialization
installs nothing: it never assigns `provider` or `fallbackProvider`, never
writes `last_embedding_space`, never arms a re-probe, and disposes any local
provider it resolved. A superseded init that throws is ignored, so it can no
longer demote the newer provider to the fallback.

The resolve goes through an instance method, `resolveEmbeddingProvider()`,
because `EmbeddingProviderResolver` is **inlined into the pipeline bundle**. A
test that patches the separately imported resolver class does nothing: the
first draft of the test did exactly that, and the real resolver found the local
Ollama server.

`EmbeddingInitLatestWins2026_09_22.test.mjs` (4 tests) overlaps a slow stale
resolve with a fast newer one:

- **Negative control:** with only the guard disabled (`isStale = () => false`),
  2 of 4 fail exactly as the live bug did: `actual: 'gemini'` where the user
  chose `local`, and `actual: 'local'` where the user chose `openai`.
- **With the guard:** 23/23 pass, including the existing boot-demotion and
  pinned-space suites.

The harness workaround described below is no longer required, but it is kept:
it still makes each run's provider unambiguous.

The comparison harness avoids the race rather than fixing it: it **pre-seeds
`embedding: manual/local` in the profile** (a user's saved choice, so the boot
init is itself manual-local and filters every other provider out) and launches
the app from a clean working directory, so `dotenv` injects no cloud keys. It
also fails any run in which a non-`local` provider is selected at any point.

---

## 9e. e5 vs MiniLM inside a real Natively session (503 questions, full corpus)

The per-model live check (§9c) proves each model works but cannot rank them:
its fixture is too easy. This track uploads the **whole benchmark corpus** (59
files, 900 app chunks) through the real parser into a real mode, indexes it with
the real `ModesManager`, and asks **all 503 questions** through
`__e2e__:inspect-retrieval`: hybrid lexical + dense fusion, the confidence-gated
local cross-encoder, the token budget. What is scored is the **final ranked
evidence the app hands the LLM**, not the embedding in isolation.
`scripts/embedding-live-corpus-compare.mjs` + `…-analyse.mjs`.

**Validity.** Each run had an isolated profile with `embedding: manual/local`
pre-seeded, launched from a clean working directory (`dotenv` injected 0 vars),
and was checked from its own log: `Selected provider: local` and nothing else,
the named model loaded in the worker, no self-poison, 0 failed calls. The first
attempt was **invalid** and is quarantined in `results/live-corpus-invalid/`:
the init race (§9d) had Gemini serving every run, producing identical output for
three different "models". Relevance uses the benchmark's ground truth: each
returned snippet is matched to its benchmark chunk by text, which succeeded for
94.8–96.0% of snippets. Unmatched snippets count as misses for every model
alike. The app produced 900 chunks against the offline snapshot's 872.

| model | dim | index 900 chunks | hit@1 | hit@3 | answer anywhere in evidence | MRR | query p50 | query p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **MiniLM** (previous default) | 384 | **22 s** | 0.1252 | 0.2167 | **0.4692** | 0.2088 | 35 ms | **1,235 ms** |
| **multilingual-e5-base** (current default) | 768 | 167 s | **0.1571** | **0.2386** | 0.4235 | **0.2265** | 67 ms | 102 ms |
| e5-small-v2 | 384 | 54 s | 0.1511 | 0.2286 | 0.4254 | 0.2208 | 39 ms | 45 ms |
| **multilingual-e5-small** (bundled since 2026-09-22, §12c) | 384 | 51 s | 0.1491 | 0.2286 | 0.4195 | 0.2179 | 40 ms | 43 ms |

Paired against MiniLM, same 503 questions, 2000 bootstrap replicates:

| | Δ hit@1 | Δ hit@3 | Δ answer anywhere | Δ MRR |
| --- | --- | --- | --- | --- |
| multilingual-e5-base | **+0.0318** [0.0080, 0.0577] **better** | +0.0219 [−0.0020, 0.0457] noise | **−0.0457** [−0.0775, −0.0159] **worse** | +0.0177 [−0.0029, 0.0375] noise |
| e5-small-v2 | **+0.0258** [0.0040, 0.0477] **better** | +0.0119 [−0.0119, 0.0378] noise | **−0.0437** [−0.0755, −0.0139] **worse** | +0.0120 [−0.0060, 0.0304] noise |

By track (hit@3):

| track | MiniLM | e5-base | e5-small-v2 |
| --- | ---: | ---: | ---: |
| text (239) | 0.2218 | **0.2427** | 0.2218 |
| code (105) | 0.3524 | 0.3619 | **0.3714** |
| long documents (100) | 0.0500 | **0.1200** | 0.1100 |
| hard negatives (59) | **0.2373** | 0.2034 | 0.2034 |

### What this says

**Inside the real app, the gap is far smaller than the offline benchmark
suggested.** Offline, pure dense retrieval put `multilingual-e5-base` +0.1074
R@10 ahead of MiniLM (§8). Through Natively's full retrieval stack, where
lexical scoring, the reranker and the token budget all shape the evidence, the
top-3 gain is +0.022 and within noise. The embedding model is one input among
several, and the others damp it.

**e5-base is better at putting the right chunk first**: +0.032 hit@1,
significant, and the first chunk is the one the LLM leans on most. It is clearly
better on **long documents** (0.12 vs 0.05 hit@3), where MiniLM barely works.

**But its evidence contains the answer *less often* overall**: −0.046,
significant. MiniLM's final evidence block more often holds a correct chunk
*somewhere*, just not first. A plausible mechanism fits a second observation:
**66 of MiniLM's 503 queries took over 500 ms (p95 1,235 ms), against 0 for
either e5 model**, while evidence size was the same (~12 snippets). That is
consistent with the confidence-gated cross-encoder escalating more often on
MiniLM's weaker, lower-confidence retrievals, widening what it considers and
catching more answers at a latency cost. **Unconfirmed**: the app does not log
escalation per query.

**Hard negatives favour MiniLM slightly** (0.237 vs 0.203), within a
59-question track.

**e5-small-v2 matches e5-base inside the app** on every metric (all within a
few thousandths), at a third of the indexing time (54 s vs 167 s), 8× less disk,
and a 45 ms p95. The gap between the two e5 models that §8 measured offline does
not survive the full stack either.

**Costs of e5-base in the real app:** indexing is **7.6× slower** than MiniLM
(167 s vs 22 s for 900 chunks). Typical query latency is higher (67 vs 35 ms
p50), but the worst case is far better (102 vs 1,235 ms p95).

---

## 9f. Hosted vs local in the same real session: Gemini `gemini-embedding-2`

The same 503-question, full-corpus, real-app suite as §9e, run once more with a
**hosted** embedder. The three local runs were **not** re-run; their results
are reused as-is.

**Validity.** The profile was pre-seeded with `embedding: manual/gemini`. A
manual cloud pin makes Gemini the resolver's only candidate, so no boot-time
auto resolve can substitute anything (§9d). The run launches from the repo
directory so the app can read the key from `.env`. The failure mode flips for
this run: a Gemini outage or quota error would fall back to the **local** model.
So the run was rejected if any other provider was selected, any local embedding
model loaded, or any fallback activity was logged. Result: `Selected provider:
gemini` only, no local model loaded, no fallback, space at the end
`gemini:gemini-embedding-2:3072` (location `cloud`), 0 failed calls, 900/900
chunks embedded.

*Independent confirmation of §9d.* This run's scores (hit@1 0.1511, hit@3
0.2406, anywhere 0.4334, MRR 0.2274) are **identical to four decimals** to the
invalid first attempts labelled "MiniLM" and "e5-base". Those runs were indeed
served by Gemini.

| model | where | dim | index 900 chunks | hit@1 | hit@3 | answer anywhere | MRR | query p50 | query p95 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **gemini-embedding-2** | **cloud** | 3072 | 58 s | 0.1511 | **0.2406** | 0.4334 | **0.2274** | **686 ms** | **774 ms** |
| multilingual-e5-base (default) | on-device | 768 | 167 s | **0.1571** | 0.2386 | 0.4235 | 0.2265 | 67 ms | 102 ms |
| e5-small-v2 | on-device | 384 | 54 s | 0.1511 | 0.2286 | 0.4254 | 0.2208 | 39 ms | 45 ms |
| MiniLM | on-device | 384 | 22 s | 0.1252 | 0.2167 | **0.4692** | 0.2088 | 35 ms | 1,235 ms |

**Gemini vs the bundled default (multilingual-e5-base), paired:**

| Δ hit@1 | Δ hit@3 | Δ answer anywhere | Δ MRR |
| --- | --- | --- | --- |
| −0.0060 [−0.0239, 0.0099] noise | +0.0020 [−0.0159, 0.0199] noise | +0.0099 [−0.0040, 0.0239] noise | +0.0009 [−0.0116, 0.0136] noise |

**Gemini vs MiniLM:** hit@1 **+0.0258** (better), MRR **+0.0186** (better),
hit@3 +0.0239 (CI lower bound exactly 0.0000, borderline), answer anywhere
**−0.0358** (worse).

hit@3 by track: code **0.381** (e5-base 0.362, MiniLM 0.352), long documents
**0.140** (e5-base 0.120, MiniLM 0.050), hard negatives 0.237 (tied with
MiniLM, e5-base 0.203), text 0.222 (e5-base 0.243).

### What this says

**Inside the real app, the bundled multilingual-e5-base is statistically
indistinguishable from hosted Gemini embedding 2.** All four metrics are within
noise, with small deltas (≤0.01), while e5-base answers each query about
**10× faster** (67 vs 686 ms p50), runs entirely on-device, and costs nothing
per call. Gemini's own edge is concentrated in code and long documents, by
margins too small to separate here.

**Gemini indexes faster** (58 s vs 167 s for 900 chunks). Bulk cloud embedding
beats a 768-d model on this CPU. It pays for that on every query instead, since
each question is a network round trip.

**MiniLM's "answer somewhere in the evidence" advantage holds against Gemini
too** (−0.036 for Gemini), so it is a MiniLM-specific effect rather than an e5
weakness. That fits the earlier observation that only MiniLM's retrievals are
slow (66 queries over 500 ms), consistent with the confidence-gated reranker
widening its evidence more often. Still unconfirmed.

Scope. One authored corpus. The app's full stack (lexical fusion, reranker,
token budget) damps every embedder's influence, which is exactly why these gaps
are so much smaller than the dense-only numbers in §8. Only Gemini was tested
as the hosted tier; Voyage and OpenAI were not run. OpenAI returned 429 during
these sessions.

---

## 10. Interaction with Natively's real reranker

The reranker is the **real bundled cross-encoder**: `getLocalReranker()` →
`Xenova/ms-marco-MiniLM-L-6-v2` q8. Not `models/Xenova/bge-reranker-base` at the
repo root — `download-models.js` records that bge was removed entirely on
2026-09-04 and ms-marco replaced it; that directory is stale leftover. Measuring
against it would have been a wasted track.

Pool = **30**, production's `RERANK_CANDIDATE_POOL`. Sampled at 60 queries,
deterministically evenly-spaced so **every model reranked the same queries**.
A full 503-query × 50-passage pass costs ~35 minutes per model; this track is
sampled and labelled as such, while §8's numbers remain full-corpus.

| model | dense R@10 | reranked R@10 | gain | rescued | lost | **unrecoverable** | rerank p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multilingual-e5-small | 0.3667 | 0.3667 | +0.0000 | 4 | 4 | **45.0%** | 4470 ms |
| e5-small-v2 | 0.2833 | **0.4167** | **+0.1334** | 9 | 1 | **51.7%** | 3937 ms |
| minilm-baseline | 0.2333 | 0.3667 | +0.1334 | 9 | 1 | 53.3% | 2367 ms |
| arctic-m | 0.2833 | 0.3000 | +0.0167 | 2 | 1 | 58.3% | 3957 ms |
| arctic-s | 0.2000 | 0.3333 | +0.1333 | 10 | 2 | 60.0% | 2694 ms |
| nomic-v1.5 | 0.2000 | 0.3000 | +0.1000 | 7 | 1 | 61.7% | 3533 ms |
| bge-small-en | 0.2500 | 0.3333 | +0.0833 | 6 | 1 | 63.3% | 3702 ms |
| gte-small | 0.1667 | 0.2667 | +0.1000 | 6 | 0 | 66.7% | 2088 ms |
| arctic-xs | 0.1500 | 0.1500 | **+0.0000** | 1 | 1 | **80.0%** | 3462 ms |

`unrecoverable` is the number the brief's §14 actually asks for: **how often the
embedding model failed so badly that reranking could not recover** — nothing
relevant anywhere in the 30-chunk pool, so no reranker could help.

### What this changes

**`e5-small-v2` is the best model after reranking** (0.4167), overtaking
`multilingual-e5-small` — which gains nothing from the reranker because its
dense ordering is already close to what the cross-encoder would produce
(4 rescued, 4 lost, net zero). On the full stack Natively actually ships, the
33.1 MiB model wins.

**`arctic-xs` is the clearest reject in the whole benchmark.** It is not merely
weakest on dense retrieval — it has an 80% unrecoverable rate, so the reranker
cannot save it (+0.0000, 1 rescued against 1 lost). A model whose relevant chunk
is absent from the pool four times in five is not a MiniLM replacement under any
weighting.

**Reranking is worth more than the model choice for most candidates.** A
+0.1334 rerank gain exceeds every dense model-vs-model delta in §8. It costs
2–4.5 s p50 per query, which is why production gates it behind a confidence
escalation rather than running it always.

**Unrecoverable rate tracks candidate recall, not top-1.** `multilingual-e5-small`
has both the best pool recall (45.0% unrecoverable, lowest) and the best dense
R@10 — consistent with §8's `candidate recall@50` of 0.6223. The brief
anticipated a model with "mediocre top-1 but strong top-50 candidate recall"
being valuable; no candidate here shows that profile, because pool recall and
top-10 rank together across the set.

### Operational limit found (the brief's §20)

At pool **50** under CPU contention, `LocalReranker` repeatedly hit
`Worker request timed out after 15000ms` and kept the pre-rerank order. The
first sweep was abandoned for that reason. At production's pool of **30** with
the machine otherwise idle, **zero** timeouts occurred across all nine models
(`rerank_failures: 0` in every file). The 15 s worker timeout is a real ceiling:
widening the rerank pool beyond production's 30 is not free, and a machine under
load can silently degrade to the un-reranked ordering. Raw:
`results/rerank/*.json`.

---

## 11. Three conclusions (the brief's §23)

Deliberately three, not one — the ranking changes by axis.

### Best ultra-small replacement → `arctic-s` (33.1 MiB)

**Not `arctic-xs`**, which the brief proposed for this slot. Arctic XS is
−0.0139 R@10 against MiniLM with an interval spanning zero: indistinguishable
from the incumbent, and last in the field. Its card's MTEB comparison does not
survive contact with Natively's corpus and chunker.

`arctic-s` is +0.0437 R@10 (CI [0.0080, 0.0775], significant), costs 33.1 MiB
against MiniLM's 22.6 MiB, and holds query p95 at 8 ms against 4 ms. If the
constraint is genuinely "smallest thing that is really better", this is it.

Honest caveat: `e5-small-v2` is the *same installed size* (33.1 MiB) and more
than twice the gain. `arctic-s` only wins this category if something other than
size and quality is decisive.

### Best English model under 500 MB → `e5-small-v2` (33.1 MiB)

+0.1074 R@10 (CI [0.0696, 0.1471]), 0.3238 on the code track against the
incumbent's 0.1714, the **best long-document score in the field** (0.2700, the
only model to beat MiniLM there), second-best cross-file, 33.1 MiB, 8 ms p95.

It beats both 768-dim candidates while being a quarter of their size and a third
of their latency. For a bundled default this is the strongest
quality-per-megabyte in the set.

**And it is the best model on the full stack Natively actually ships.** After
the real cross-encoder it reaches **0.4167** — the highest reranked score in the
benchmark, ahead of `multilingual-e5-small` — with the second-lowest
unrecoverable rate (51.7%). If only one model is adopted, this is the one.

### Best multilingual model under 500 MB → **this benchmark cannot answer it**

An earlier draft of this section named `multilingual-e5-base` on the strength of
its overall reranked score. That was reasoning from the wrong column. On the
**multilingual track itself** the three candidates disagree violently, and the
ordering inverts depending on which number you read:

| model | MiB | multilingual R@10 (n=15) | reranked R@10 (overall) |
| --- | ---: | ---: | ---: |
| `multilingual-e5-small` | 129.1 | **0.5333** | 0.3667 |
| `arctic-l` | 322.1 | 0.4000 | 0.3833 |
| `minilm-baseline` | 22.6 | 0.3333 | 0.3667 |
| `e5-small-v2` | 33.1 | 0.3333 | 0.4167 |
| **`multilingual-e5-base`** | 282.0 | **0.2667** | **0.4333** |

`multilingual-e5-base` has the **best overall reranked score and the worst
multilingual-track score in the group** — below the English-only incumbent.
Either the multilingual track is too small to mean anything, or the model is bad
at the thing its name promises. **n=15 cannot distinguish those two
explanations**, and 0.5333 vs 0.2667 on 15 queries is 8 correct versus 4.

So no multilingual recommendation is made. Committing 282 MiB of installer on
the back of 15 queries would be exactly the "public leaderboard ≠ Natively
retrieval" error this benchmark caught with `arctic-xs`.

**What to do instead:** if multilingual reference material matters, build a
real multilingual track first — several hundred queries across the languages
actually present in user corpora, with same-language, English→non-English and
non-English→English directions scored separately (the brief's §13 asks for all
three; only same-language was measured here). Until then, note that
`multilingual-e5-small` costs 129.1 MiB and delivers **exactly the incumbent's
reranked score** (0.3667 vs 0.3667) — it is not a cheap multilingual win.

### Best overall practical candidate — depends on the axis Natively weights

There is no single winner, and saying otherwise would misrepresent the data:

> **Superseded by the decision in §12b**: the project owner selected
> `multilingual-e5-base` (768d, 282.0 MiB). The table below is the evidence that
> was put in front of that decision, kept as-is rather than rewritten to agree
> with it.

| if the priority is… | pick | why |
| --- | --- | --- |
| **quality per megabyte on the shipped stack** | **`e5-small-v2`** | 0.4167 reranked at 33.1 MiB / 8 ms, batch 16 intact |
| absolute best quality, cost no object | `e5-large-v2` **or** `multilingual-e5-base` | both 0.4333 reranked; the base keeps batch 16 and is 3× faster |
| best dense retrieval before reranking | `arctic-l` | 0.3459, largest paired delta (+0.1332) — but drops to 4th after rerank |
| multi-hop / cross-file answers | **`bge-small-en`** | leads cross-file (any@10 0.676) at 33.1 MiB |
| multilingual | **unresolved** | the n=15 track contradicts the overall score; see §11. Do not buy 282 MiB on 15 queries |
| smallest possible footprint | keep **MiniLM** | nothing at ≤22.6 MiB beats it; `arctic-xs` does not |

If forced to a single answer: **`e5-small-v2`**, and round 2 strengthens rather
than weakens that. The widest models the cap allows buy **+0.0166 reranked R@10
for 9.7× the disk, 6.8× the query latency, and a forced reduction of the ingest
batch from 16 to 4**. That is not a trade Natively should take for a bundled
default. The honest summary of "retry at the highest dimension" is: **width was
tested to 1024 and it does not pay.**

All are Apache-2.0 or MIT, commercially usable, redistributable, ungated. All
load in Natively's existing runtime with no new dependency and no custom code.

---

## 12. Final table (the brief's §29)

Dense R@10 on **503 queries**; reranked R@10 on the **60-query sample** at pool
30. "Language" reflects the model's training scope, not a measured claim about
any specific language beyond the 15-query multilingual set.

> **Do not subtract these two columns.** They are different query sets, so the
> difference is not the reranker gain. The true paired gain — dense and reranked
> on the *same* 60 queries — is in §10's table (e.g. MiniLM: 0.2333 → 0.3667,
> +0.1334, not 0.3667 − 0.2127).

Sorted by reranked R@10 — the stack Natively ships. **Bold batch** marks a model
that cannot use Natively's ingest batch of 16.

| Model | Installed MB | Dim | Language | R@10 | Reranked R@10 | p95 query | Ingest batch | Status |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| e5-large-v2 | 322.1 | 1024 | English | 0.3380 | **0.4333** | 54 ms | **4** | PASS |
| multilingual-e5-base | 282.0 | 768 | multilingual | 0.3201 | **0.4333** | 19 ms | 16 | PASS — best large-tier |
| e5-small-v2 | 33.1 | 384 | English | 0.3201 | 0.4167 | 8 ms | 16 | PASS — **recommended** |
| arctic-l | 322.1 | 1024 | English | **0.3459** | 0.3833 | 76 ms | **4** | PASS — best dense |
| multilingual-e5-small | 129.1 | 384 | multilingual | 0.3340 | 0.3667 | 10 ms | 16 | PASS |
| **minilm-baseline** | **22.6** | 384 | English | **0.2127** | 0.3667 | 4 ms | 16 | incumbent |
| bge-large-en | 322.1 | 1024 | English | 0.3042 | 0.3500 | 79 ms | **4** | PASS |
| bge-small-en | 33.1 | 384 | English | 0.3022 | 0.3333 | 9 ms | 16 | PASS — best cross-file |
| arctic-s | 33.1 | 384 | English | 0.2565 | 0.3333 | 8 ms | 16 | PASS |
| arctic-m | 105.7 | 768 | English | 0.2883 | 0.3000 | 24 ms | 16 | PASS |
| nomic-v1.5 | 131.6 | 768 | English | 0.2763 | 0.3000 | 30 ms | **4** | PASS — SIGTRAPs at 16 |
| gte-small | 33.1 | 384 | English | 0.2366 | 0.2667 | 6 ms | 16 | PASS — within noise |
| arctic-xs | 22.6 | 384 | English | 0.1988 | 0.1500 | 4 ms | 16 | **rejected** — 80% unrecoverable |
| gte-large | 322.1 | 1024 | English | — | — | — | — | **BLOCKED** |
| multilingual-e5-large | **552.0** | 1024 | multilingual | — | — | — | — | **EXCLUDED — over cap** |

13 of 15 candidates scored. No candidate was excluded for licence.

### Failures, classified (the brief's §28)

| model | class | detail |
| --- | --- | --- |
| `multilingual-e5-large` | **SIZE FAILURE** | Installed artifact 552.0 MiB > 500 MiB cap. Not benchmarked; its family capped at the 768d base. |
| `gte-large` | **INTEGRATION FAILURE** | `tokenizer_config.json` declares `model_max_length: 1e30`, so transformers.js never truncates and ONNX throws on any input > 512 tokens. Repo packaging defect — `gte-small` declares 512 and works. Would die on 17 of 872 real chunks. |
| `arctic-l`, `bge-large-en`, `e5-large-v2` | **RUNTIME FAILURE (partial)** | Exceed `WORKER_EMBED_TIMEOUT_MS` (30 s) at Natively's ingest batch of 16 on real chunks. Complete at batch 4. |
| `nomic-v1.5` | **RUNTIME FAILURE (partial)** | SIGTRAP inside ONNX Runtime during bulk indexing at batch 16; completes at batch 4. |
| `arctic-xs` | **MODEL QUALITY FAILURE** | −0.0139 vs MiniLM (CI spans zero) and 80% unrecoverable after reranking. Runs perfectly; simply is not better. |
| `gte-small` | **MODEL QUALITY FAILURE (marginal)** | +0.0239, CI [−0.0099, 0.0557] — within noise. |

No LICENSE or HARDWARE failures occurred. **Every model above ~130 MiB needed a
reduced ingest batch** — that is the dominant operational finding of round 2.

---

## 12b. DECISION (SUPERSEDED by §12c) — `multilingual-e5-base` (768d) selected as the bundled default

> **Superseded 2026-09-22.** e5-base was bundled on the development branch for
> one day and never released. It is kept in `LEGACY_BUNDLED_LOCAL_MODEL_IDS`,
> so a dev profile that saved it is not routed to Ollama. The record below is
> unchanged.

**Decided by the project owner, 2026-09-21**, after the multilingual caveat below
was put in front of them. This section records the choice and what it costs; it
is a decision log, not a recommendation derived from the data alone.

Note the original request named "multilingual-e5-small at 768 dimensions". That
artifact does not exist: `multilingual-e5-small` is **384-dimensional**, E5 is
fixed-width (no Matryoshka truncation), and a 384-dim model cannot be widened to
768. The 768-dim member of that family is `multilingual-e5-base`, which is what
was selected.

### What was chosen

| property | value |
| --- | --- |
| model | `Xenova/multilingual-e5-base` |
| revision | `1ec9243030a27d1a115d5c340572074c125b58b2` |
| license | MIT — commercial use and redistribution permitted, not gated |
| dimensions | 768 |
| installed | **282.0 MiB** (278.6 MB q8 ONNX + 17.1 MB tokenizer) |
| pooling / prefixes | mean · `query: ` / `passage: ` |
| max sequence | 514 |
| space key | `local:xenova/multilingual-e5-base@q8@mean@v1:768` |

### What it buys

| metric | MiniLM | `multilingual-e5-base` |
| --- | ---: | ---: |
| dense R@10 | 0.2127 | **0.3201** (+0.1074, CI [0.068, 0.147], significant) |
| **reranked R@10** | 0.3667 | **0.4333** — best in the benchmark |
| unrecoverable after rerank | 53.3% | **45.0%** — joint best |
| code retrieval R@10 | 0.1589 | **0.3907** (≈2.5×) |
| cross-file any@10 | 0.4054 | **0.6216** |

All ten sanity checks PASS, including `longInput` — it does not share
`gte-large`'s truncation defect. It keeps **ingest batch 16**, so no per-model
batch/timeout refactor is required.

### What it costs — surfaced, accepted

| cost | MiniLM | chosen | factor |
| --- | ---: | ---: | ---: |
| installed size | 22.6 MiB | 282.0 MiB | **12.5×** |
| peak RSS during embed | 134 MB | **491.8 MB** | **3.7×** |
| ingest throughput | ~20 chunks/s | **4.76 chunks/s** | **4.2× slower** |
| query p95 | 4 ms | 19 ms | 4.8× |
| model load | 157 ms | 744 ms | 4.7× |

The **RSS figure is the one to watch**, not the disk. Natively already runs
concurrent ONNX sessions (Whisper STT, the ms-marco reranker, this embedder),
and the worker isolation in `LocalEmbeddingProvider` exists because of nine real
macOS crash reports from exactly that pressure. *(Corrected 2026-09-22: an
earlier version said the memory gate would "refuse more often" for this model.
It will not. `hasEnoughMemoryForOnnxSession()` is a fixed free-memory floor
blind to model size, so it admits a 492 MB model under exactly the conditions it
admits a 134 MB one. See §13 step 4.)* **This was not load-tested against a live
meeting.**

### The caveat that stands

On the 15-query multilingual track this model scored **0.2667 — the worst of the
multilingual candidates, below the English-only incumbent's 0.3333**, while
`multilingual-e5-small` scored 0.5333. n=15 cannot separate "track too small"
from "model weak at the thing its name promises". The choice was made with this
visible. **It is not evidence-backed for multilingual retrieval specifically**,
and it should not be described to users as a multilingual improvement until a
real multilingual evaluation exists (§14).

What *is* evidence-backed: it is the best model in this benchmark on the full
shipped stack for English and code retrieval.

---

## 12c. DECISION — `multilingual-e5-small` (384d) replaces e5-base as the bundled default

**Decided by the project owner, 2026-09-22.** They asked for e5-small in place of
e5-base. It was measured in the same live session (§9e), and they chose it with
the one statistically significant loss in front of them.

### What was chosen

| property | value |
| --- | --- |
| model | `Xenova/multilingual-e5-small` |
| revision | `761b726dd34fb83930e26aab4e9ac3899aa1fa78` |
| license | MIT |
| dimensions | 384 (fixed; E5 has no Matryoshka truncation) |
| installed | **129.1 MiB** (5 files, sha256-pinned in `resources/models/Xenova/multilingual-e5-small/manifest.json`) |
| pooling / prefixes | mean · `query: ` / `passage: ` |
| space key | `local:xenova/multilingual-e5-small:384` |
| memory gate | shared ONNX floor **+0.2 GB** (`extraMemoryHeadroomGB`; e5-base had +0.5) |

### Paired against e5-base, live session, 503 questions, 2000 replicates

| metric | Δ vs e5-base | 95% CI | verdict |
| --- | ---: | --- | --- |
| hit@1 | −0.0080 | [−0.0199, 0.0020] | noise |
| hit@3 | −0.0099 | [−0.0219, 0.0000] | noise (upper bound touches 0) |
| answer anywhere | −0.0040 | [−0.0179, 0.0099] | noise |
| **MRR** | **−0.0086** | [−0.0174, −0.0012] | **worse (significant)** |

Against MiniLM it is +0.0239 hit@1 (CI [0.0000, 0.0477], borderline) and
+0.0091 MRR (noise). It is −0.0497 on answer-anywhere (**worse**, the same
pattern every e5 model shows, §9e). Long-document hit@3 is 0.100 against
MiniLM's 0.050.

### What the switch buys over e5-base

| | e5-base | e5-small | |
| --- | ---: | ---: | --- |
| installed | 282.0 MiB | 129.1 MiB | 2.2× smaller |
| peak RSS during embed | 397 MB | 198 MB | 2× less |
| index 900 chunks (live) | 167 s | 51 s | 3.3× faster |
| live query p50 / p95 | 67 / 102 ms | 40 / 43 ms | |

### Migration, verified live

The width did not change from MiniLM (384 → 384), so the width check alone
would not trigger a re-embed. The **space key** does: it includes the model id.
In a live upgrade, an existing MiniLM-indexed profile was relaunched on the new
build. The app re-indexed, and all 9 chunk rows landed in
`local:xenova/multilingual-e5-small:384`. The answers were 3/3 correct, with no
sentinel self-poison, and only the local provider was selected. A saved
`Xenova/all-MiniLM-L6-v2` or `Xenova/multilingual-e5-base` selection resolves
to the bundled model, not to Ollama (`isBundledLocalModelId`).

### The caveat that stands

This model has the best multilingual-track score in the benchmark (0.5333), but
that track has only **n=15**. Multilingual support is kept, but it is not
evidence-backed as a multilingual improvement. Cross-language retrieval was
not measured.

---

## 13. Recommended next implementation step

Written for the decision in §12b (`multilingual-e5-base`). **Steps 1–4 are now
implemented, and they carried over unchanged to the §12c switch.** For
e5-small, the model-aware headroom is +0.2 GB, not +0.5. Step 5 is done on
macOS: packaged build (§18.2) and the live-meeting memory test (§18.5), which
found and fixed a quit crash (§18.6, §18.7). **Windows remains open**: it
requires physical Windows verification.

**Step 1 — land the worker correctness fix alone, first.** The tensor-width
derivation and shape assertion (§5) are a bug fix independent of any model
choice: a no-op for MiniLM, and the thing that stops a 768-dim default from
emitting silently corrupt vectors. Merging this before the model swap means the
swap lands on a worker that is already correct. Keep
`embedding-slicing-negative-control.mjs`'s check in CI against a small 768-dim
fixture.

**Step 2 — fix the §9 re-index finding.** A better model is worth nothing on a
path that leaves files `lexical_only`. This gates everything below.

**Step 3 — ship the artifact beside MiniLM, do not delete MiniLM.** — **DONE
2026-09-22.** Mirrors the existing smart-turn pattern exactly:

- `resources/models/Xenova/multilingual-e5-base/manifest.json` (**tracked**) pins
  revision `1ec92430…` and all five files with byte counts and sha256.
- `.gitignore` keeps everything else in that directory out of git: the 17 MB
  tokenizer and 279 MB ONNX can never enter history.
- `download-models.js` gains `downloadManifestModel()`, which streams each file
  to `.part`, verifies sha256 and bytes, renames into place, and skips a file
  already present with the right hash. **Optional** in `npm install` (a blocked
  279 MB fetch must not break every developer's install, and Windows CI already
  flakes on model downloads) but **required** by
  `verify-packaged-local-assets.mjs`, so no release can ship without it.
- `package.json` `build.extraResources` filter gains
  `Xenova/multilingual-e5-base/**`; `electron-builder.signed.cjs` spreads
  `package.json`'s `build`, so the signed build inherits it.
- `BundledModelsShipWithoutStowaways` now also pins that the bake-off siblings
  (`multilingual-e5-small`, `multilingual-e5-large`, `e5-small-v2`,
  `bge-large-en-v1.5`) never ride along, plus the prefix trap
  (`multilingual-e5-base/**` must not match `multilingual-e5-small/`).

Verified: the real `download-models.js` fetched all five files from the pinned
revision in 79 s; a second run re-downloaded nothing; `shasum` of the ONNX
equals the manifest; `git status` sees only `manifest.json`;
`verify:packaged-local-assets` OK; rag suite and `test:scripts` green. A
**negative control** removed the filter line and the stowaways test failed with
*"…would NOT be copied into the installer"*, so the guard is not vacuous.

Not yet done for step 3: an actual `electron-builder` packaging run proving the
files land inside the `.app` / NSIS installer (that is step 5's packaged-build
check). Installer grows by **~282 MiB on both macOS and Windows**.

*Found while doing it:* the new comment's apostrophe ("developer's") broke
`canonicalFiles()`, which extracts paths from `download-models.js` with a
`'…/…'` regex. A source-parsing test failing on a comment, not on code.

- Add the four files to `REQUIRED_MODEL_FILES` in `scripts/download-models.js:11`
  and to `scripts/verify-packaged-local-assets.mjs:35` — the packaged-release
  gate is the one place these stay mandatory.
- `LocalFallbackAssets` / electron-builder `extraResources` must carry the new
  directory; `resolveModelPath()` needs no change (it already probes for the
  requested model's `tokenizer.json`).
- ~~**Keep MiniLM bundled as the low-memory fallback.**~~ **CORRECTED
  2026-09-22 — this was wrong on both counts.** (1) There is no second local
  slot: `EmbeddingPipeline` builds its fallback as `new LocalEmbeddingProvider()`
  (`EmbeddingPipeline.ts:223`), the same class as the local primary, so changing
  that class's model changes both at once and MiniLM cannot "sit behind" the new
  model without new architecture. (2) `hasEnoughMemoryForOnnxSession()`
  (`onnxThreadConfig.ts:521`) is a **fixed free-memory floor that is blind to
  model size**. It does not refuse the bigger model more often; it admits it
  under exactly the conditions it admits MiniLM, after which the new model uses
  3.7× the memory. That is the real risk of the flip, and step 4 has to address
  it explicitly. (`resources/models/Xenova/all-MiniLM-L6-v2/onnx/model.onnx` is a 90 MB
  fp32 file nothing loads — deleting it recovers 90 MB and is safe.)

**Step 4 — the default flip, which is a migration.** — **DONE 2026-09-22**, as
the owner chose: *flip + model-aware memory gate*.

What changed:

- **`electron/rag/bundledLocalEmbedding.ts` (new)** is now the one definition
  of the bundled model: id, width, pooling, `query:`/`passage:` prefixes, dtype,
  and `extraMemoryHeadroomGB`. The provider, worker defaults, embedding
  catalogue, config identity and fallback preflight all read it. Before this,
  each carried its own `'Xenova/all-MiniLM-L6-v2'` literal.
- **`LocalEmbeddingProvider`** is driven by one always-present recipe: the
  bundled model by default, the experiment when one is set. The production
  space key is `local:xenova/multilingual-e5-base:768`. The prefixes now apply
  on the production path (they never did for MiniLM, which is symmetric).
- **Model-aware memory gate.** `hasEnoughMemoryForOnnxSession(extraGB = 0)` and
  `getMinFreeGBForOnnxSession(extraGB = 0)`: the shared floor plus the loading
  model's own headroom (0.5 GB for this model, from its measured 0.36 GB extra
  peak RSS plus margin). Every other caller passes nothing, so the reranker,
  Whisper and the rest are unchanged. Negative or NaN headroom can never lower
  the floor.
- **Catalogue** names the bundled model and no longer marks it `lightweight`,
  so the "your embeddings are lightweight" notice stops. That notice is keyed
  on `minilm` in the space key, so it would have stopped regardless.
- **`download-models.js`**: the new model is now **required** at install, as
  MiniLM was. An install with no working default embedder silently runs
  lexical-only. MiniLM stays bundled for one release as a zero-download
  rollback (reverting `bundledLocalEmbedding.ts` alone restores it). Its removal
  (23 MB) is a tracked follow-up.

**A migration hazard found by reading, fixed, then verified live.**
`embeddingConfigIdentity.ts` treated any saved `local` model id other than the
bundled one as **Ollama-served**. Settings persists the id, so every install that
had picked the old bundled model has `Xenova/all-MiniLM-L6-v2` saved. After the
flip, those users would have been routed to Ollama asking for a model it does
not serve. "Bundled" is now a set (`isBundledLocalModelId`) that includes the
legacy id.

**A real bug found by the upgrade test: a launch poisoned itself.** The ONNX
load sentinel is a cross-launch crash guard: written before an ONNX worker
spawns, cleared on ready. The next launch's cold-start `consumePoisonedOnnxLoad()`
(in a `setImmediate`) treats any leftover record as a crash and disables that
model for the launch. It could not tell *which* launch wrote the record. On
upgrade, startup re-indexing (made possible by step 2) began loading the model
before the `setImmediate` ran, and the consume reported this launch's **own
in-flight load** as a previous crash:

```
re-indexing "billing-notes.md" (was pending)            ← starts the load, writes sentinel
Recovered from a local embedding crash.
  Xenova/multilingual-e5-base is skipped this launch     ← a model no earlier launch loaded
[LocalEmbeddingProvider] skipped: previous launch poisoned the load   ×6
Feature-extraction model loaded successfully.            ← the load itself was fine
```

Result: all six files `lexical_only`, 0/9 embedded, on an otherwise healthy
upgrade. This is **family-generic**: the reranker and Whisper share the
mechanism. Fixed in `onnxLoadSentinel.ts` by stamping each record with a launch
id. This launch's own record is left on disk (so a hard death of this launch
still poisons the next one) and is never reported. A previous launch's record is
still reported, including when an early load overwrote it before the consume
ran. A record with no launch id (written by an older build) keeps its meaning.
`OnnxSentinelSelfPoison2026_09_22.test.mjs` was written **failing-first**
(red on exactly the two self-poison invariants).

The launch identity is held on `globalThis`, not in module scope, and that
matters. `build-electron.js` inlines this module into several bundles, each with
its own module scope. Confirmed in the build: `main.js`, `modelPreloader.js`
and `onnxLoadSentinel.js` each carry their own copy and none `require` a shared
one. A module-level id would differ per copy, so a sentinel written by one copy
and consumed by another would read as a different launch and the self-poison
would come back. The first version of this fix had exactly that flaw. It passed
live only because writer and consumer happened to share `main.js`. A test now
writes through `modelPreloader.js`'s copy and consumes through
`onnxLoadSentinel.js`'s, so the two copies must agree. The Whisper sentinel
suite's three write-then-consume cases were updated the same way as the
generic suite's four. The existing sentinel suite's
four write-then-consume cases now mark the relaunch explicitly, because they
always *meant* "a previous launch crashed".

**Upgrade, verified live on one persistent profile, two launches:**

| | launch 1: pre-flip install | launch 2: new build, same profile |
| --- | --- | --- |
| saved selection | `local` / `Xenova/all-MiniLM-L6-v2` | *(unchanged, not re-saved)* |
| active space | `local:xenova/all-minilm-l6-v2:384` | `local:xenova/multilingual-e5-base:768` |
| `lightweight` notice | true | **false** |
| model loaded in-app | `Xenova/all-MiniLM-L6-v2` | `Xenova/multilingual-e5-base` |
| reference files | uploaded, 9/9 embedded | **not re-uploaded**; `pending` → re-indexed → **9/9, all `ready`** |
| queries correct @1 | 3/3 | **3/3**, all dense-scored |
| routed to Ollama? | — | **no** |
| self-poison lines | — | **0** (before the fix: 6, and 0/9 embedded) |

The database agrees: every `mode_reference_index_state` row is `ready` in
`local:xenova/multilingual-e5-base:768`, and every stored chunk vector is
**768** wide. No 384-wide MiniLM rows remain to mix with.

Not covered by the upgrade test: meeting-transcript vectors and knowledge/profile
documents re-embedding into the new space (existing machinery with its own
tests, not driven live here), and an upgrade where the user never activates the
mode (re-index is triggered by mode activation / prewarm).

- `LocalEmbeddingProvider`'s `model`/`dimensions` become the new values, so the
  space key changes to `local:xenova/multilingual-e5-base@q8@mean@v1:768`.
  `RAGManager` filters by `getActiveSpaceKey()`, so **every existing local
  vector becomes unreachable, not wrong** — correctness is safe, but each user
  silently re-indexes their whole corpus at **4.76 chunks/s** (≈4× slower than
  today). A large reference set is minutes of work. This needs a UX decision,
  not just a code change.
- **`vec_chunks_768` already exists on every install** — it is in
  `DatabaseManager.KNOWN_DIMS` (`:2791`) and provisioned at startup, confirmed in
  the live-session log. No table migration is required, which is a genuine
  advantage of 768 over an unusual width.
- Add the model to `embeddingCatalog.ts`'s `local` list so Settings names what is
  actually storing the vectors.
- `embedQuery`/`embedBatch` must apply `query: ` / `passage: `. Today
  `embedQuery` is a plain `embed()` because MiniLM is symmetric; this model is
  not, and omitting the prefixes silently costs retrieval quality.

**Step 5 — verify before release.** Windows run (nothing here executed on it);
a packaged build, since development-mode success proves nothing about ASAR; and
a live-meeting memory test, because 491.8 MB alongside Whisper and the reranker
is the real risk and was not load-tested.

**Do not describe this to users as a multilingual improvement** until a real
multilingual evaluation exists — see §12b and §14.

Adopting `e5-small-v2` costs **+10.5 MiB** installed and **+4 ms** query p95 over
MiniLM, for +0.1074 dense R@10 and +0.05 reranked R@10 — and it keeps the ingest
batch at 16. Every larger candidate tested (≥105.7 MiB, 768/1024-dim) requires
dropping that batch to 4 or fails outright, so "just use a bigger model" is not
a free upgrade here.

If a wider model is adopted anyway, `WORKER_EMBED_TIMEOUT_MS` (30 s) and the
ingest batch size must become **per-model**, not global.

---

## 14. Remaining risks and what was not measured

- **No Windows execution.** Everything here ran on macOS/arm64. See §16.
- **Multilingual is n=15 and internally contradictory.** `multilingual-e5-small`
  leads the track (0.5333) but ties the incumbent on the full reranked stack;
  `multilingual-e5-base` has the best reranked score in the benchmark (0.4333)
  and the worst multilingual-track score of the group (0.2667, below MiniLM).
  15 queries cannot separate "track too small" from "model weak". **Superseded
  by §18.9**: a 120-question Hindi → English track shows multilingual-e5-small
  language-invariant (Hindi cost +0.008, noise) and ahead of e5-base (+0.133).
  English → Hindi documents stays weak for every model. Only Hindi was measured;
  nothing here supports "94/100 languages".
- **The reranker track is a 60-query sample**, not the full 503.
- **The live track (§9c) proves each model works end to end but does not rank
  them.** Its fixture is too small to discriminate. It also exposes only the
  *final* ranked snippets: `__e2e__:inspect-retrieval` returns the post-rerank
  block, so a per-model live **before**-rerank ordering is still not captured.
- ~~PDF and DOCX were not scored.~~ **Closed (§18.10):** the same 8 documents in
  md/html/docx/txt/pdf give question-identical results among the structured
  formats. PDF and TXT index flat (no headings survive), and .doc/.rtf/.odt are
  refused. Long-document PDF quality is still unmeasured.
- ~~No chunk-size sweep.~~ **Closed (§18.11).**
- ~~No offline network verification.~~ **Closed (§18.4):** the provider and
  worker produce correct vectors inside a kernel sandbox that denies all network
  access (the control connect fails with `EPERM`). Scope: provider and worker,
  not the whole app.
- **Absolute numbers are corpus-specific.** The corpus is authored, not sampled
  from real Natively usage. The *deltas* are the transferable result; the
  absolute R@10 values are not a prediction of production recall.
- **`nomic-v1.5`'s SIGTRAP was not root-caused**, only bounded (fails at 16,
  survives at 4). The safe batch ceiling between 4 and 16 is unknown — and the
  same is true of the three 1024-dim models that hit the 30 s embed timeout.
- **`gte-large` was not re-tested with explicit truncation.** Its failure is
  fully diagnosed (`model_max_length: 1e30`), but no run was made with a
  corrected tokenizer config, so whether GTE-large is actually *good* is
  unmeasured — it is an integration failure, not a quality verdict.
- **`multilingual-e5-large` was never downloaded**, so its 552.0 MiB figure is
  computed from the Hugging Face blob listing, not from bytes on disk.
- **Round 2's larger models were not driven through the live session**, which
  never reached the dense path for any model (§9).

---

## 15. What was changed in the repository, and what was not

All changes are **uncommitted** on `fix/profile-pack-fk-and-gap-analysis`.

### Production changes

| file | change |
| --- | --- |
| `electron/rag/bundledLocalEmbedding.ts` | **new** — the one definition of the bundled model (`multilingual-e5-small` recipe), `LEGACY_BUNDLED_LOCAL_MODEL_IDS`, `isBundledLocalModelId()`, `bundledLocalEmbeddingFiles()` |
| `electron/rag/providers/LocalEmbeddingProvider.ts` | recipe-driven (model, dtype, pooling, prefixes, dims); `query: `/`passage: ` applied; width-mismatch refusal; model-aware memory gate |
| `electron/rag/providers/localEmbeddingWorker.ts` | slicing delegated to `embeddingTensorSlice` (**correctness fix**); defaults read from the bundled recipe |
| `electron/rag/providers/embeddingTensorSlice.ts` | **new** — width derivation + batch×width invariant |
| `electron/rag/EmbeddingPipeline.ts` | **new** `ensureProviderLoaded()` (§9b) |
| `electron/services/modes/ModeHybridRetriever.ts` | `indexFileInner` forces the lazy load before `lexical_only`. Indexing path only |
| `electron/utils/onnxThreadConfig.ts` | `hasEnoughMemoryForOnnxSession(extraGB)` / `getMinFreeGBForOnnxSession(extraGB)` |
| `electron/utils/onnxLoadSentinel.ts` | per-launch `launchId` on `globalThis`, so a launch never reads its own sentinel as a previous-launch crash, across bundles |
| `electron/rag/embeddingCatalog.ts`, `embeddingConfigIdentity.ts` | catalogue entry built from the recipe; saved legacy bundled ids no longer routed to Ollama |
| `electron/services/LocalFallbackAssets.ts` | required files derived from the recipe |
| `src/components/settings/EmbeddingSettings.tsx` | display fallback id |
| `scripts/download-models.js` | manifest-driven, sha256-verified download of the bundled model (fatal on failure); MiniLM still fetched as a rollback asset |
| `resources/models/Xenova/multilingual-e5-small/manifest.json` | **new, tracked** — 5 pinned files with sha256 |
| `package.json` (`build.extraResources`), `scripts/verify-packaged-local-assets.mjs`, `.gitignore` | ship and verify the e5-small directory; model binaries stay untracked |

### Tests

`EmbeddingTensorSlice2026_09_21`, `LazyLocalEmbedderIndexesVectors2026_09_21`,
`OnnxSentinelSelfPoison2026_09_22` (**new**, incl. a cross-bundle case). Also
updated: `OnnxLoadSentinel`, `WhisperLoadSentinel`, `EmbeddingCatalog`,
`LocalEmbeddingProviderRealModel` (asserts 384) and
`BundledModelsShipWithoutStowaways` (e5-base, e5-large, e5-small-v2 and
bge-large must not ship).

### R&D-only (inert in production)

`electron/rag/embeddingExperiments.ts` and the `scripts/embedding-*.mjs`
harnesses. The seam is inert unless `NATIVELY_EMBEDDING_EXPERIMENT` names a
registered key. An unknown key throws. Executed, not asserted:

```
OK   resolveEmbeddingExperiment() === null
OK   name === 'local'
OK   dimensions === 384
OK   model === 'Xenova/multilingual-e5-small'
OK   space === 'local:xenova/multilingual-e5-small:384'
OK   embedQuery !== embed (asymmetric: query:/passage: prefixes applied)
OK   vector width is 384
OK   unknown key throws instead of falling back to MiniLM

PRODUCTION DEFAULT OK: env var unset -> bundled multilingual-e5-small, prefixes applied.
```

### Not changed

Cloud embedding behaviour, the local reranker, the vector schema, and the
`resolveModelPath` candidate ordering (packaged/dev/ASAR). The **init race
(§9d) is documented but not fixed.** No destructive migration: old-space vectors
are re-embedded through the existing space-key re-index path.

---

## 16. Validation

- `Covered by automated macOS branch tests` — `npm run typecheck:electron` clean;
  9/9 models pass the sanity suite through the real compiled worker.
- `Tested physically on macOS` — all downloads, sanity runs and the negative
  control executed on this machine (Apple M4, 16 GB, darwin 27.0.0).
- `Requires physical Windows verification` — no Windows leg was run. The changed
  code contains no new platform branch, no new path construction and no new
  shell invocation; `path.join` is used throughout and the experiment cache
  location is derived from `os.homedir()`. The **bundled** MiniLM path on
  Windows is unchanged by construction, since the experiment branch cannot
  activate without the env var. This still needs a Windows run before any of it
  is relied upon.
- `Reviewed but not executed on Windows` — `scripts/download-embedding-experiments.mjs`
  defaults its cache to a macOS-style `Library/Application Support` path. That
  is an **R&D script only**, never shipped and never imported by the app, but it
  would need an `app.getPath('userData')`-style location before any Windows use.

### Commands actually executed

Every one of these was run; none is aspirational.

```
npm run typecheck:electron                       # clean
npm run build:electron                           # artifact verified on disk
node scripts/download-embedding-experiments.mjs  # 8 candidates, sha256 recorded

ELECTRON_RUN_AS_NODE=1 npx electron scripts/embedding-experiment-sanity.mjs
ELECTRON_RUN_AS_NODE=1 npx electron scripts/embedding-slicing-negative-control.mjs
ELECTRON_RUN_AS_NODE=1 npx electron scripts/embedding-experiment-inert-check.mjs
ELECTRON_RUN_AS_NODE=1 npx electron scripts/embedding-corpus-prepare.mjs

# retrieval sweep, once per model
SKIP_RERANK=1 NATIVELY_EMBEDDING_EXPERIMENT=<key> \
  ELECTRON_RUN_AS_NODE=1 npx electron scripts/embedding-retrieval-bench.mjs
# nomic-v1.5 additionally needed EMBED_BATCH=4 (SIGTRAP at 16)

# batch-size control
EMBED_BATCH=4 NATIVELY_EMBEDDING_EXPERIMENT=e5-small-v2 ... embedding-retrieval-bench.mjs

# cross-file and reranker tracks, once per model
NATIVELY_EMBEDDING_EXPERIMENT=<key> ... scripts/embedding-crossfile-bench.mjs
RERANK_QUERIES=60 RERANK_POOL=30 NATIVELY_EMBEDDING_EXPERIMENT=<key> ... scripts/embedding-rerank-bench.mjs

node scripts/embedding-analyse.mjs

# live session (real Electron app, isolated userData)
CDP_PORT=9437 NATIVELY_EMBEDDING_EXPERIMENT=minilm-baseline node scripts/embedding-live-session.mjs
```

**Not run:** `npm test`, `npm run test:ci`, any Windows command, any packaging
or signing step. The changed files carry no new test; the existing suites were
not executed against this branch.

---

## 17. Reproduction

```bash
node scripts/download-embedding-experiments.mjs
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron scripts/embedding-experiment-sanity.mjs
ELECTRON_RUN_AS_NODE=1 npx electron scripts/embedding-slicing-negative-control.mjs
ELECTRON_RUN_AS_NODE=1 npx electron scripts/embedding-corpus-prepare.mjs

for k in minilm-baseline arctic-xs arctic-s arctic-m bge-small-en \
         e5-small-v2 gte-small nomic-v1.5 multilingual-e5-small; do
  SKIP_RERANK=1 NATIVELY_EMBEDDING_EXPERIMENT=$k \
    ELECTRON_RUN_AS_NODE=1 npx electron scripts/embedding-retrieval-bench.mjs
  NATIVELY_EMBEDDING_EXPERIMENT=$k \
    ELECTRON_RUN_AS_NODE=1 npx electron scripts/embedding-crossfile-bench.mjs
  RERANK_QUERIES=60 RERANK_POOL=30 NATIVELY_EMBEDDING_EXPERIMENT=$k \
    ELECTRON_RUN_AS_NODE=1 npx electron scripts/embedding-rerank-bench.mjs
done

node scripts/embedding-analyse.mjs
```

`nomic-v1.5` needs `EMBED_BATCH=4`, or it SIGTRAPs.

### Output artifacts

```
docs/local-embedding-benchmark.md          this report
results/local-embedding-benchmark.json     48 fields per model
results/local-embedding-benchmark.csv      same, flat
results/local-embedding-sanity.json        per-model sanity checks
results/corpus-snapshot.json               the shared, hash-asserted chunk set
results/model-sizes.json                   installed/artifact bytes
results/raw-retrieval/<model>.json         per-query records
results/crossfile/<model>.json             required-file recall
results/rerank/<model>.json                reranker gain + unrecoverable rate
results/live-session/<model>.json          live app evidence
results/indexes/natively_refs__<model>__<dim>d__v1.sqlite
results/batch-size-control-e5-small-v2-batch4.json
results/comparison-round1-vs-round2.json   per-family small-vs-wide deltas
```

---

## 18. Closing the open items (2026-09-22)

Every item that §13 step 5 and §14 left open, in the order it was closed. Each
entry states exactly what was executed.

### 18.1 Init race: fixed

See §9d. `EmbeddingInitLatestWins2026_09_22.test.mjs` passes 4/4, and its
negative control fails 2/4.

### 18.2 Packaged build: validated on macOS arm64

An unsigned `--mac dir --arm64` build through the project's own
`scripts/package-app.js`, with the afterPack hook ad-hoc signing the bundle.

- `verify-packaged-local-assets.mjs --app Natively.app` passes.
- The bundle ships `models/Xenova/` = `ms-marco-MiniLM-L-6-v2` (23 MB) and
  `multilingual-e5-small` (129 MB). **No MiniLM.** All 5 e5-small files match the
  pinned manifest's sha256.
- **The packaged binary ran the full live-corpus track** (`APP_BINARY=…/Natively`,
  503 questions). The model resolved from `Contents/Resources`, the worker ran
  from `app.asar.unpacked`, and the numbers are identical to the dev tree to four
  decimals: hit@1 0.1491, hit@3 0.2286, answer-anywhere 0.4195, MRR 0.2179,
  0 failed calls, 0 self-poison. Indexing took 124 s against the dev tree's
  51 s, but a back-to-back dev re-run on the same machine took 82 s at a load
  average of 12–13, because another session was running a test suite. That
  latency difference is **not** attributable to packaging.

Two build traps met on the way; neither is caused by this change.

- A self-referencing `node_modules/node_modules → node_modules` symlink, created
  by a concurrent session's `ln -s` without `-n`, made `npm ls` report every
  dependency missing. electron-builder then fell back to its manual walker and
  failed on the `onnxruntime-node` override. Unlinking it fixed the build.
- `scripts/package-app.js` reports electron-builder's exit code correctly. An
  earlier "exit 0" was the background wrapper's code, not the build's.

**Not done: Windows packaging.** The `package.json` filter, `download-models.js`
and the verifier are shared code paths, and the verifier's `--platform win32`
list is unchanged apart from the model files. `Requires physical Windows
verification`.

### 18.3 MiniLM unshipped

Nothing loads MiniLM at runtime any more. A saved `Xenova/all-MiniLM-L6-v2`
selection resolves to the bundled model (`isBundledLocalModelId`), and old-space
vectors are re-embedded by the space-key re-index (verified live, §12c).

Removed from:
- the `extraResources` filter;
- `download-models.js` (required list and download step);
- `verify-packaged-local-assets.mjs`;
- both repair shell scripts, which now install e5-small. They had never been
  updated for the switch.

Its three tracked config/tokenizer files are untracked (`git rm --cached`; the
local copies stay on disk and are now ignored). `BundledModelsShipWithoutStowaways`
now pins MiniLM as must-not-ship.

The R&D baseline `minilm-baseline` fetches pinned revision `751bff37` into the
experiments cache. All four files were checked **byte-identical** (sha256) to the
copy that shipped, so every earlier MiniLM number remains comparable.

**Two related thresholds were checked: neither changes behavior.**
- `semanticAdmissionGate` has no calibrated floor for any local space, and an
  unknown space means legacy admission.
- `resolveMinSimilarity` returns 0.25 for every space.

One untested consequence follows from the second: e5 cosines sit high even for
unrelated text, so that 0.25 floor, which filtered weak MiniLM matches in meeting
retrieval (`RAGRetriever`), now filters almost nothing. The benchmark does not
exercise that path.

### 18.4 Offline: proven at the kernel level

The real provider and its worker ran under `sandbox-exec` with a profile of
`(deny network*)`.

- **Controls:** inside the sandbox, `fetch('https://huggingface.co')` fails
  (`ENOTFOUND`) and a raw TCP connect to 1.1.1.1:443 fails with **`EPERM`**. The
  same connect succeeds outside it.
- **Result:** inside the sandbox, the model loaded and produced correct 384-d
  vectors with the prefixes applied, and all 8 inert-check assertions passed.
- **Scope:** the provider and worker, not the whole app.

### 18.5 A live meeting with every local ONNX model resident

`scripts/embedding-live-meeting-memory.mjs` drives the real app:
1. local STT (Parakeet CTC 0.6B, 583 MB, both channel workers) is selected and a
   real meeting started;
2. the full 59-file corpus is uploaded and indexed during the meeting;
3. 40–120 reranked retrievals run during the meeting;
4. the meeting ends and the app quits.

It samples the RSS of the whole process tree every 500 ms. A run is invalid
unless both STT workers report `worker ready`, the reranker loads, and the
named embedder loads. The first attempt used a cached `distil-large-v3` that
turned out to be **truncated on disk**: both STT workers failed to load and that
run still "passed", which is why the ready check exists. That run is kept in
`results/live-meeting-memory-invalid/`.

| run | embedder | peak (tree) | STT load | indexing in meeting | queries in meeting | gate refusals |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| A | e5-small | 2,592 MB | 2,592 | 1,787 | 1,777 | 0 |
| B | e5-small | 2,410 MB | 2,410 | 2,342 | 1,567 | 0 |
| C | e5-small | 2,178 MB | 1,770 | 2,178 | 1,936 | 0 |
| D | e5-small | 3,192 MB | 3,192 | 2,867 | 1,678 | 0 |
| — | **MiniLM** | **3,174 MB** | 3,174 | 2,062 | 2,176 | 0 |

**No memory-gate refusal and no out-of-memory in any run. All 120 queries
reached the dense path during the meeting.** Peak tree memory varies by about
1 GB between identical e5-small runs, and is dominated by the STT model load, so
e5-small's +78 MB (§12c) **cannot be distinguished from noise** under a real
meeting. MiniLM's peak fell inside the e5-small range. n=4 against n=1, on one
16 GB machine shared with another session: `Tested physically on macOS`, not a
statistical claim.

### 18.6 A crash found by that test: quitting mid-inference aborted the app. Fixed.

Two meeting runs died with **SIGABRT**, with macOS crash reports showing:

```
onnxruntime_binding.node  Napi::InstanceWrap<InferenceSessionWrap>::InstanceMethodCallbackWrapper
libc++abi                 __cxa_throw → std::__terminate → abort()
```

Both followed a **quit**: `[Lifecycle] before-quit reason=user-quit`, then
`terminating due to uncaught exception of type Napi::Error`. The quits were not
issued by the harness. A concurrent session confirmed it had not killed these
apps, and the timing matches the user quitting a window.

**Isolated with a deterministic repro:**
- Launch the real app with **no meeting and no STT**, upload the corpus, start
  indexing, and quit through the app's own `quit-app` IPC 15 s later.

| build | quit mid-index | aborted |
| --- | --- | ---: |
| before the fix, e5-small | 4 runs | **4/4** |
| before the fix, **MiniLM** | 3 runs | **3/3** |
| quit before indexing started (control) | 7 runs | 0/7 |
| **after the fix**, e5-small | 4 runs | **0/4**, exit code 0 |

**Pre-existing, and not caused by the switch.** MiniLM aborts identically. The
switch makes it more likely, because indexing takes about 2.3× longer and so
the window is open for longer.

**Cause.** Nothing stopped the local embedding worker on quit. Process exit tore
the worker thread down inside a native ONNX call, the binding threw into the
dying environment, and libc++ aborted. A quit during model **load** had a second
consequence: the load sentinel survived, so the next launch read a clean quit as
a crashed load and skipped local embedding.

**Fix.**
- `LocalEmbeddingProvider.shutdownForQuit()` refuses new requests, waits for the
  in-flight batch (bounded), clears the sentinel, and terminates an idle worker.
  That is the same safe path `dispose()` takes on a config change.
- `before-quit` in `main.ts` defers the quit **once**, only when a worker still
  owes a reply: at most 5 s, measured 1.1–3.5 s.
- The live-provider registry lives on `globalThis`, because the provider is
  inlined into more than one bundle.

Tests: `LocalEmbeddingQuitDrain2026_09_22.test.mjs`, 6 tests. Its negative
control, the wait loop removed, fails the drain-order test.

**Not covered by this fix, same crash class, unverified:**
- the reranker worker and the STT workers mid-inference at quit;
- the SIGTERM/SIGINT path, which calls `app.exit()` and bypasses `before-quit`.

### 18.7 A second defect behind it: an interrupted file stayed `indexing` forever. Fixed.

After a clean quit mid-index, the same profile was relaunched. The launch sweep
re-indexed the 38 `pending` files, but the 2 files that were `indexing` at the
quit **stayed `indexing`**. After 90 s: 502/900 chunks embedded, and nothing
would ever resume them.

`retryLexicalOnlyFiles` covered `lexical_only`/`failed`/`pending` only. Mode
activation re-indexes any non-ready file, but an already-active mode is never
re-activated. This is also pre-existing: before the fix, the abort left files in
exactly the same state.

**Fix.** `RETRY_ELIGIBLE_INDEX_STATUSES` now includes `indexing`, and is exported
once. `ModesManager` had two private copies of the set. Resuming is safe even if
a file is genuinely mid-index, because `indexFile` is single-flight per file id.

- **Test:** `InterruptedIndexResumes2026_09_22.test.mjs` failed first with
  `actual: []`, as the live repro did; it now passes 4/4.
- **Live:** quit mid-index, then relaunch. The profile's database shows **59/59
  files `ready`, 900/900 chunks embedded**.

### 18.8 `OllamaManagerGating` failures: a test fix

Two tests assumed nothing listens on 127.0.0.1:11434, which is Ollama's real
default port. One comment even said "non-default port". On a machine running
Ollama they got `ready` instead of `missing_optional_dependency`. They now use
the closed port 1, and pass 5/5 with Ollama live.

### 18.9 Cross-language track, and a defect it exposed. Fixed.

§14 said cross-language retrieval "was **not** measured at all" and that the
multilingual claim rested on 15 questions. There are now two directions.

**Hindi question → English documents (120 questions).** The first 120
text-track questions were translated into Hindi the way a Hindi-speaking
engineer would ask them: prose in Hindi, identifiers left in Latin script
(`embedding-benchmark/queries/crosslang_hi_to_en.json`). The chunk-level ground
truth carries over **unchanged** from the English originals. A control set asks
the same 120 questions in English, so the cost of the language is a paired,
per-question delta. 69 of the 120 are pure Hindi; 51 carry a Latin identifier.

| model | Hindi R@10 | English control | cost of Hindi (95% CI) | pure-Hindi only |
| --- | ---: | ---: | --- | --- |
| **multilingual-e5-small** | **0.4333** | 0.4250 | **+0.008 [−0.067, 0.075], noise** | −0.015, noise |
| multilingual-e5-base | 0.3000 | 0.4667 | −0.167 [−0.250, −0.083], worse | −0.159, worse |
| e5-small-v2 (English) | 0.1583 | 0.4583 | −0.300 [−0.400, −0.208], worse | −0.319, worse |
| MiniLM (English) | 0.0667 | 0.2417 | −0.175 [−0.250, −0.100], worse | −0.203, worse |

**The bundled model is effectively language-invariant here.** It beats MiniLM by
**+0.367** R@10 [0.283, 0.450] (pure Hindi +0.348), and beats
multilingual-e5-base by **+0.133** [0.042, 0.233]. §12c's "multilingual support
is not evidence-backed" is now evidence-backed, for Hindi → English, on n=120.

**The English cross-encoder undoes it.** With every query reranked (the bench's
setting), e5-small's Hindi R@10 falls **0.433 → 0.217**, while its English
control rises 0.425 → 0.567. The reranker costs −0.350 [−0.442, −0.250] on Hindi.
ms-marco-MiniLM is an English model. Production reranks the bundled model only
on a low-confidence gate, and in the live run below **0 of 120** Hindi questions
showed a rerank score. So this penalty was not observed in the app. Caveat: that
count relies on `rerankScore` appearing in the evidence block.

**English question → Hindi documents (56 questions, file-level).** Six English
prose documents were translated into Hindi (`embedding-benchmark/corpus-crosslang/hi/`)
and swapped into an otherwise-English index; the other 53 files are distractors.
The English control is the same index with the originals.

| model | Hindi docs R@10 | English control | cost |
| --- | ---: | ---: | --- |
| multilingual-e5-small | 0.2321 | 0.6250 | −0.393, worse |
| e5-small-v2 | 0.2321 | 0.6429 | −0.411, worse |
| multilingual-e5-base | 0.1786 | 0.6250 | −0.446, worse |
| MiniLM | 0.0179 | 0.5357 | −0.518, worse |

Every model pays heavily in this direction. e5-small is best-tied, and MiniLM
collapses (+0.214 R@10 for e5-small over MiniLM, significant). **English
questions over Hindi documents remain weak for every candidate under 500 MB.**

**The defect.** The same 120 Hindi questions asked **inside the real app** (live
harness, `QUERY_FILE`) scored answer-anywhere 0.250 against 0.633 for English.
For **65 of 120** questions, not one returned snippet carried a vector score:
the evidence was the first rows of an unrelated CSV. The dense path never ran.

`wordsOf()` (and BM25's copy) stripped every character outside `[a-z0-9]`, so a
pure-Hindi question tokenized to **zero** words. `ModeHybridRetriever.retrieve()`'s
zero-token short-circuit then returned the fallback shape before the embedder
saw the query. A multilingual embedder could not help a question the tokenizer
had erased.

**Fix.** Both tokenizers keep `\p{L}\p{M}\p{N}`. Marks matter: Devanagari vowel
signs and virama are combining marks. `NonLatinQueryTokens2026_09_22.test.mjs`
failed 4/6 first. Its ASCII-invariance checks compare the old and new
expressions over **every ASCII paragraph of the repository's `docs/`** (tracked
text, so the check also runs in CI, where the gitignored benchmark corpus is
absent) and pass: English tokenization is byte-for-byte unchanged. The 133 existing tokenizer tests pass.

**Live, same 120 questions, before → after (paired):**

| | before | after | Δ (95% CI) |
| --- | ---: | ---: | --- |
| questions with no dense evidence | 65 | **0** | |
| answer anywhere in evidence | 0.250 | **0.483** | **+0.233 [0.158, 0.308], better** |
| hit@3 | 0.083 | 0.158 | +0.075 [0.025, 0.133], better |
| MRR | 0.088 | 0.143 | +0.055 [0.022, 0.083], better |
| hit@1 | 0.042 | 0.042 | 0.000, noise |

It is still below English (answer-anywhere −0.150). That is expected: 40% of
the hybrid score is lexical, and Hindi words cannot match English text. Top-1 is
the weak point.

### 18.10 Format track: PDF / DOCX / HTML / TXT / MD

`embedding-benchmark/corpus/formats/` holds the same 8 documents in 8 formats,
but had no questions. 24 were written, 3 per document, each paraphrased so that
lexical overlap does not give it away. Each carries its answer sentence,
verified verbatim in the markdown source (`embedding-benchmark/queries/formats_track.json`).

One real app session had one mode per format. The files went through the real
parsers: `pdf-parse`, `mammoth`, `htmlToText`. A snippet is relevant when it
contains the answer sentence, both reduced to lowercase letters and digits
(`scripts/embedding-live-format-track.mjs`, multilingual-e5-small).

| format | uploaded | chunks | hit@1 | hit@3 | anywhere | MRR |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| .md | 8/8 | 33 | 0.833 | 0.833 | 0.917 | 0.848 |
| .html | 8/8 | 25 | 0.833 | 0.833 | 0.917 | 0.848 |
| .docx | 8/8 | 41 | 0.833 | 0.833 | 0.917 | 0.848 |
| .txt | 8/8 | **8** | 0.917 | 0.917 | 1.000 | 0.938 |
| .pdf | 8/8 | **8** | 0.917 | 0.958 | 1.000 | 0.941 |
| .doc / .rtf / .odt | **refused** (`reference_upload_failed`) | | | | | |

- **The three structured formats give question-for-question identical results:**
  the same 4 misses at the same ranks. The parsers preserve the content, and the
  chunker recovers the same sections.
- **PDF and TXT come out flat: one chunk per document.** No headings survive
  `pdf-parse`, so the structure-aware chunker has nothing to split on. On these
  1 KB documents that scores *higher*, since the whole document is always the
  chunk. On long PDFs it is the opposite: the earlier real-PDF extraction work
  found **0 headings** in real PDFs, and an unsectioned 50-page PDF is chunked by
  size alone. The format effect is structured vs flat, not a parser losing text.
- Unsupported formats are refused cleanly, not indexed as binary garbage.
- n=24 on short documents. This shows format invariance of content; it does not
  measure long-document PDF quality.

### 18.11 Chunk-size sweep

The production chunker (target 350 tokens, max 1000) against a smaller (target
200, max 600) and a larger (target 600, max 1500) configuration, other
parameters scaled proportionally (`embedding-corpus-prepare.mjs`
`CHUNK_OPTIONS=`). Same corpus, same 503 questions, and ground truth rebuilt per
chunking by the same rules. Paired per question against production.

| model | chunking | chunks | dense R@10 | Δ vs 350 | reranked R@10 | Δ vs 350 | long-doc R@10 |
| --- | --- | ---: | ---: | --- | ---: | --- | ---: |
| e5-small | 200 | 922 | 0.3718 | **+0.038, better** | 0.4453 | −0.010, noise | 0.270 (+0.070, better) |
| e5-small | **350** | 872 | 0.3340 | | **0.4553** | | 0.200 |
| e5-small | 600 | 844 | 0.3161 | −0.018, noise | 0.4115 | **−0.044, worse** | 0.230 |
| MiniLM | 200 | 922 | 0.2644 | +0.052, better | 0.3996 | +0.010, noise | 0.210 |
| MiniLM | 350 | 872 | 0.2127 | | 0.3897 | | 0.210 |
| MiniLM | 600 | 844 | 0.2008 | −0.012, noise | 0.3698 | −0.020, noise | 0.210 |

- **Chunk size is a weak lever on this corpus.** The chunker is structure-driven,
  so moving the target from 200 to 600 changes the chunk count by only about
  ±5%, and the median chunk stays about 290 characters.
- **Smaller chunks help the dense stage but not the shipped stack.** The
  +0.038 dense gain for e5-small disappears after the cross-encoder (−0.010,
  noise). Larger chunks cost −0.044 after reranking.
- **No change recommended.** Production 350 is the best reranked configuration
  for the bundled model. Changing it forces a re-index of every user's files
  (`CHUNKER_VERSION`) for a gain that exists only before reranking. The one
  signal worth watching: long documents gain +0.070 at 200. If long-document
  recall becomes a priority, test a length-conditional target, not a global
  change.
- Measurement note: the first pass compared against the round-1 350 result,
  which carries no reranked metrics, and showed a spurious "+0.44 better". The
  analyser now requires a reranked reference and refuses to run without one.

### 18.12 The benchmarked models in the local embedding catalog

PR #582 (on `main`) added a curated local catalog, `EMBEDDING_MODEL_CATALOG` in
`electron/rag/embeddingModelCatalog.ts`, which is what Settings → Local
Embeddings lists. It held MiniLM (marked bundled), BGE-small, two Qwen3 GGUF
models and four Jina GGUF models. Merged into this branch, it now also carries
**every model the benchmark brief named**:

| catalog id | model | dim | download | benchmark dense R@10 |
| --- | --- | ---: | ---: | ---: |
| `multilingual-e5-small` | Multilingual E5 Small (**bundled**) | 384 | ships with the app | **0.334** |
| `e5-small-v2` | E5 Small v2 (recommended) | 384 | 34.7 MB | 0.320 |
| `bge-small-en-v1.5` | BGE Small EN v1.5 (was present) | 384 | 34.7 MB | 0.302 |
| `snowflake-arctic-embed-m` | Snowflake Arctic Embed M | 768 | 110.8 MB | 0.288 |
| `nomic-embed-text-v1.5` | Nomic Embed Text v1.5 | 768 | 138.0 MB | 0.276 |
| `snowflake-arctic-embed-s` | Snowflake Arctic Embed S | 384 | 34.7 MB | 0.257 |
| `gte-small` | GTE Small | 384 | 34.7 MB | 0.237 |
| `minilm-l6-v2` | MiniLM L6 v2 (was bundled; now a download) | 384 | 23.7 MB | 0.213 |
| `snowflake-arctic-embed-xs` | Snowflake Arctic Embed XS | 384 | 23.7 MB | 0.199 |

- **Recipes are the benchmarked ones.** Each entry carries `pooling`,
  `queryPrefix` and `documentPrefix`, identical to `embeddingExperiments.ts`.
  The revision and every file's sha256 are the bytes the benchmark downloaded.
  `CatalogBenchmarkModels2026_09_22.test.mjs` (18 tests) pins all of it.
- **`main`'s provider had no prefix support**, so every asymmetric model (e5,
  Arctic, BGE, Nomic) would have run on bare text. The merged provider applies
  the catalog entry's prefixes: queries through `embedQuery`, chunks through
  `embedBatch`.
- **The existing BGE entry was misconfigured**, with mean pooling and no query
  instruction. It now uses CLS pooling plus `Represent this sentence for
  searching relevant passages: `, per its model card and the benchmark recipe.
- The argument-less provider (the offline fallback) and the catalog's single
  `bundled` entry are multilingual-e5-small. Settings keys its "built-in" row on
  the `bundled` flag, not a hardcoded id. A saved legacy
  `Xenova/all-MiniLM-L6-v2` shows the bundled row as selected, matching what
  actually runs.
- Not added: the round-2 wide models (Arctic L, BGE large, E5 large, GTE large,
  multilingual-e5-base). They were not in the brief, cost 5–10× the disk for
  little measured gain (§8b), and GTE large fails on long inputs.

**Live, in the real app, through its own IPC** (`embedding:install-local-model`
→ `embedding:test-local-model` → `embedding:use-local-model`, then index and ask
the 24 format-track questions; `CATALOG_MODEL=` in
`scripts/embedding-live-format-track.mjs`):

| model | download + sha256 | in-app test | active space after switch | indexed | hit@1 | hit@3 | MRR |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| bundled e5-small (reference) | ships | | `local:xenova/multilingual-e5-small:384` | 33/33 | 0.833 | 0.833 | 0.848 |
| e5-small-v2 | 8.4 s, all files match | pass, 177 ms | `local:xenova/e5-small-v2:384` | 33/33 | 0.833 | 0.833 | 0.848 |
| Arctic Embed S | 7.0 s, all match | pass, 158 ms | `local:snowflake/snowflake-arctic-embed-s:384` | 33/33 | 0.833 | 0.875 | 0.852 |
| GTE Small | 6.7 s, all match | pass, 140 ms | `local:xenova/gte-small:384` | 33/33 | 0.833 | 0.833 | 0.848 |
| Nomic v1.5 (768-d) | 20.3 s, all match | pass, 223 ms | `local:nomic-ai/nomic-embed-text-v1.5:768` | 33/33 | 0.833 | 0.875 | 0.852 |

Each app quit by itself with exit code 0. The 8 short documents are too easy
to rank these models against each other (the benchmark in §8 does that); this
proves each entry downloads, verifies, loads, switches space and retrieves in
the real app. Arctic XS/M were not driven live; they share Arctic S's recipe and
code path.

Harness trap met on the way: the harness closed its CDP socket **before**
sending `quit-app`, then killed only the `node_modules/.bin/electron` shim. The
orphaned app kept the debug port, and two later runs silently measured that old
instance. The validity checks caught it: the run's own log showed no model
load. The harness now quits through the socket, kills whatever holds the port,
and refuses to start if the port is taken.

### 18.13 High-end tier: Arctic Embed L v2.0, mxbai-embed-large-v1, Qwen3 Embedding 0.6B (ONNX)

Added to the catalog on request, as larger options for powerful machines, and
put through the same benchmark first. Files, sizes and licenses were verified
against Hugging Face. The recipes come from each repo's own sentence-transformers
config (pooling mode and `prompts`); every file is sha256-pinned at a fixed
revision.

| catalog id | download | pooling / query prompt | dense R@10 | reranked R@10 | code R@10 | Hindi→English R@10 (English ctl) | peak RSS | index | query p95 |
| --- | ---: | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| multilingual-e5-small (built-in, ref.) | ships | mean · `query: ` | 0.334 | 0.455 | 0.364 | 0.433 (0.425) | 261 MB | 9.4 ch/s | 10 ms |
| `snowflake-arctic-embed-l-v2.0` | 587 MB | CLS · `query: ` | **0.362** | 0.454 | **0.384** | 0.433 (0.500) | 411 MB | 3.1 ch/s | 57 ms |
| `mxbai-embed-large-v1` | 338 MB | CLS · retrieval instruction | 0.284 | 0.412 | 0.305 | 0.100 (0.383) | 512 MB | 3.0 ch/s | 51 ms |
| `qwen3-embedding-0.6b-onnx` | 625 MB | last-token · Qwen3 instruction | 0.253 | 0.403 | 0.298 | 0.092 (0.283) | 618 MB | 2.9 ch/s | 121 ms |

- **Arctic L v2.0 is the best dense model measured**, and matches the built-in
  model after reranking. On Hindi it costs −0.067 against its own English
  control (worse; the built-in model costs nothing). It is the one worth offering
  to people with good machines, and it is listed as *High-end*. It is not a
  better default: equal after the reranker, at 4.5× the download and 3× slower
  indexing.
- **mxbai** is English-only and trails the built-in model on every metric.
  Listed as *Pro*.
- **Qwen3 0.6B (q8 ONNX) trails the built-in model** and is weak on Hindi,
  despite its multilingual training. Listed as *Experimental*, with the numbers
  in its note. The tokenizer does append `<|endoftext|>` (verified), and the
  prompt is upstream's verbatim. A q8-vs-fp16 comparison to isolate quantization
  loss was attempted but could not run: transformers.js in Node rejects the fp16
  build (`Tensor.data must be a typed array (4) for float16 tensors`). So
  whether the q8 build or the model is at fault is **not established**.

Three defects surfaced while adding them, all fixed:

1. **Qwen3's pooling name would have thrown on first use.** The catalog calls
   last-token pooling `'last'` (the GGUF path's name); transformers.js calls it
   `'last_token'` and throws on `'last'`. The ONNX worker now maps it.
2. **Batching changed Qwen3's vectors.** The sanity suite's batch≡single check
   failed: worst cosine 0.892. Isolated: identical-length texts matched
   exactly (1.00000), mixed lengths did not (0.934–0.957), even for the
   longest, unpadded item. So the drift is not only pad positions. Indexing
   batches and queries embed singly, so this would have put documents and
   queries in inconsistent spaces. The worker now runs last-token models one
   text per call (batch≡single = 1.0, same 4.7 chunks/s), and the catalog caps
   the batch at 1.
3. **Long inputs crashed the process.** Both long-context models (tokenizer
   limits 8192 and 131072) timed out at the same batch in every run: four
   ~4 KB rows of `billing-events-export.csv`, about 1,800–2,400 tokens each.
   Timed alone, with nothing else running:

   | | 512 tokens | 1024 tokens | uncapped |
   | --- | ---: | ---: | --- |
   | Arctic L v2.0 | 1.9 s | **SIGTRAP** | — |
   | Qwen3 0.6B | 3.4 s | 8.0 s | **SIGTRAP** |

   A native abort takes the whole app down. New catalog field
   `maxInputTokens: 512` is applied by the worker to the tokenizer, and the
   benchmark ran with the same cap.

Found alongside, and fixed for every capped model:

- **Only the reference-file indexer honoured `maxBatchSize`.** Profile ingest
  (batches of 10) and live meeting indexing called `embedBatch` at their own
  sizes, so **Nomic (added in §18.12) could still reach the batch size that
  SIGTRAPped it**. The provider now splits any request into runs of at most the
  cap. Nomic is capped at 4, the large models at 4, and Qwen3 at 1.
- `memoryHeadroomGB` per model is the measured peak RSS rounded up to 0.1 GB:
  Arctic L v2 0.5, mxbai 0.6, Qwen3 0.7. It feeds the model-aware ONNX memory
  gate.

**Live, in the real app** (install → test → use; the 8 format-track documents
plus `billing-events-export.csv`, 65 chunks):

| model | download + sha256 | in-app test | indexed, incl. 32 long CSV chunks | hit@1 | hit@3 | aborts / timeouts | exit |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| Arctic L v2.0 | all match | pass, 836 ms | 65/65 | 0.792 | 0.875 | none | code 0 |
| mxbai large v1 | all match | pass, 610 ms | 65/65 | 0.875 | 0.875 | none | code 0 |
| Qwen3 0.6B ONNX | all match | pass, 750 ms | 65/65 | 0.792 | 0.833 | none | code 0 |

Also fixed: `embedding-experiment-sanity.mjs` and
`embedding-slicing-negative-control.mjs` still spoke the pre-merge worker
protocol (`modelId` as the transformers.js id; the merged worker reads
`hfModelId`). They failed loudly on load; they did not substitute a model.
