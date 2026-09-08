# Embedding & Retrieval Benchmark Report

All figures measured against **production** (`api.natively.software`) with a real
API key, 2026-09-08. Machine-readable results in `benchmarks/results/`.
Harness: `scratchpad/bench/` (corpus generator, runner, K-sweep, bake-off, chaos,
E2E session drivers).

## Method

Corpora are generated with **exact ground truth**: every fact carries a unique id
and its sentence locates the gold chunk by string containment, so scoring is a
lookup rather than a judgement. Questions span four difficulty tiers:

| tier | construction |
|---|---|
| easy | shares the component id AND the attribute word |
| medium | shares the id; attribute paraphrased away from the document wording |
| hard | **no id** — reachable only through a described property |
| extreme | sibling components with near-identical prose differing only in id and values, so lexical similarity actively points at the wrong chunk |

A correction worth recording: the first run scored `hard` against a single
arbitrarily-chosen fact, but at 100k tokens **every** (cluster, kind) pair was
shared by multiple components (worst case 20). That measured ambiguity, not
difficulty. Gold is now the union of every genuinely-correct chunk.

## Retrieval quality — 440 questions

| corpus | chunks | vec@1 | vec@10 | vec@20 (ceiling) | **rerank@1** | lift | % of ceiling |
|---|---|---|---|---|---|---|---|
| 4k tok | 16 | 73.3% | 100% | 100% | **100.0%** | +26.7 | 100% |
| 8k tok | 33 | 70.0% | 97.5% | 100% | **100.0%** | +30.0 | 100% |
| 32k tok | 128 | 57.9% | 88.6% | 92.9% | **92.1%** | +34.3 | 99.2% |
| 100k tok | 400 | 41.9% | 74.4% | 85.0% | **84.4%** | +42.5 | 99.3% |

**The reranker recovers 99–100% of everything the vector stage surfaces.** It is
not the limiting factor at any size. Retrieval loss at scale is vector recall@K:
a gold chunk outside the top-K is one the reranker never sees.

The adversarial tier is the clearest demonstration: at 100k tokens vector search
gets `extreme` questions right 27.5% of the time and the reranker takes it to
**75.0%** — and 100% of what it was shown.

## Latency (client-observed, production, ~900 calls each)

| call | p50 | p95 | p99 | max |
|---|---|---|---|---|
| embed query (1 item) | **665 ms** | 1048 | 1869 | 2322 |
| rerank (20 docs) | **744 ms** | 1030 | 1260 | 1665 |
| embed batch (32 chunks) | 1199 ms | 1871 | — | 1871 |

End-to-end per question (embed + rerank, sequential): **p50 ≈ 1.45 s, p95 ≈ 2.5 s**.

**TTFT does not apply** and is deliberately not reported. Both endpoints return a
single JSON body with no streaming, so first-byte and last-byte are one event.

## Provider limits — measured, not assumed

| Limit | Value | Method |
|---|---|---|
| Server per-input cap (before) | 8,000 chars | two inputs identical to 8,000 chars and different after returned **cosine 1.000000000** — bit-identical vectors |
| Billed tokens beyond the cap | flat 1,333 | unchanged from 8KB to **400KB** of input |
| voyage-4 window | 32,000 tokens | a 200,000-char input reported exactly **31,993** tokens |
| Server per-input cap (after) | 32,000 chars | ≤16k tokens even at ~2 chars/token, so it can never reach the window |
| Rerank depth (model) | ≥60,000 chars | answer at 60k chars found with **+0.52** margin direct |
| Rerank depth (behind old cap) | 8,000 chars | answer at 9k+ scored **0.3281 vs decoy 0.3262** — noise |
| OpenRouter project | 12,000,000 tokens/min | hit directly while probing |

## Before / after (Phase 41)

| Property | Before | After |
|---|---|---|
| Effective embed input | 8,000 chars (~1.3k tokens) | **32,000 chars** |
| Truncation visibility | silent, `200 OK` | `truncated` + cap reported |
| Rerank margin at 9k/20k/31k chars | +0.002 (noise) | **+0.51** |
| Upstream 429 | opaque `503` | **429 + Retry-After + `retryable`** |
| Index batch → upstream requests | 100 → 4 sequential, one 30s budget | 32 → **1 request** |
| Inner vs outer timeout | 30,000 = 30,000 | **25,000 < 30,000** |
| Batch bound | item count only | count **and** 24,000 chars |
| Concurrent files indexing | unbounded | **2**, process-wide |
| Sub-batch retry | none | ≤2, `Retry-After`-honouring, jittered |
| Partial index | permanently unfinished | **resumable** via `embedded_chunk_count` |

Retrieval quality is unchanged by these — the corpus chunks to ~1,200 chars, far
under either cap. What changed is the whole-file case and the failure semantics.

## Cost

Indexing the 100k-token corpus (400 chunks) took 13 batched calls and **107,571
tokens** — 0.36% of an Ultra plan's 30M monthly embedding allowance. Benchmarking
this session consumed ~536k embedding and ~8.0M reranker tokens against the test
key. `usage_events` has no cost column, so measured per-call `usage.cost` reaches
telemetry only.

## Phase 23 — real Natively sessions (the actual Electron app, on the Natively API)

Driven through `__e2e__:upload-reference-file-from-path`, which calls the **same**
`ingestModeReferenceFile` use case the file-dialog upload does — real parsing,
chunking, embedding and persistence. Index completion is read from real durable
state, not a sleep.

**The provider was verified before measuring**, because a first run silently used
something else:

```
ACTIVE: provider natively, model voyage-4, dimensions 2048,
        space "natively:voyage-4:2048", location cloud
reranker: natively / rerank-2.5-lite
```

| file | chars | upload | index | status | chunks | embedded | retrieval | p50 |
|---|---|---|---|---|---|---|---|---|
| tiny | 4,966 | **13 ms** | 2,006 ms | ready | 4 | 4 | 6/6 | 1363 ms |
| small | 20,932 | 9 ms | 2,009 ms | ready | 14 | 14 | 6/6 | 1394 ms |
| medium | 40,773 | 8 ms | 3,013 ms | ready | 27 | 27 | 6/6 | 1463 ms |
| large | 100,554 | 21 ms | 6,038 ms | ready | 65 | 65 | 6/6 | 1470 ms |
| xlarge | 201,095 | 34 ms | 10,069 ms | ready | 131 | 131 | 6/6 | 1454 ms |
| **huge (100k tok)** | 400,533 | **46 ms** | **26,169 ms** | ready | 261 | **261** | 6/6 | 1722 ms |

- **Upload returns in 8-46 ms regardless of size.** Indexing is genuinely
  non-blocking; there is no HTTP request whose timeout could need raising.
- **A 100k-token document indexes completely in 26 s**, 261/261 chunks embedded
  through the production API.
- `embedded == chunks` at every size — the new counter reports real completion,
  which is what makes a *partial* index detectable.
- Retrieval answered 6/6 at every size, against a mode holding every previously
  uploaded file as well.

**Same run against local Ollama for comparison** (`ollama:nomic-embed-text:768`):
the 100k-token file indexed in **14.1 s** vs Natively's 26.2 s — cloud is ~1.9x
slower for bulk indexing, which is the cost of the better vector space.

## Phase 24/35 — three concurrent real clients on the Natively API

All three pinned to `natively:voyage-4:2048`, sharing one API key. A uploads the
100k-token document; B and C upload small ones simultaneously.

| user | workload | upload returned | first progress | READY |
|---|---|---|---|---|
| A | 261 chunks | +189 ms | +193 ms | **+26,448 ms** |
| B | 4 chunks | +150 ms | +153 ms | **+3,677 ms** |
| C | 14 chunks | +151 ms | +153 ms | **+4,180 ms** |

**No starvation.** B finished 7.2x sooner than A and C 6.3x sooner, each in time
proportional to its own size. This is structural rather than scheduled: each
desktop client is an independent process with its own local queue, so there is no
shared queue in which a large job could hold a place ahead of a small one. The
only shared resource is the per-key request limit, and 120/min was not approached.

## Phase 29 — format matrix (real app, Natively API)

Every format `SafeDocumentTextExtractor` accepts, each carrying the **same** facts
so extraction and retrieval are scored identically. The PDF is a real multi-page
jsPDF document; the DOCX is a genuine OOXML package.

| format | parse | extracted chars | status | chunks | facts extracted | retrieval | p50 |
|---|---|---|---|---|---|---|---|
| txt | 10 ms | 5138 | ready | 4 | 6/6 | 4/4 | 1624 ms |
| md | 7 ms | 5536 | ready | **24** | 6/6 | 4/4 | 1624 ms |
| json | 12 ms | 4214 | ready | 2 | 6/6 | 4/4 | 1742 ms |
| csv | 10 ms | 1091 | ready | 3 | 6/6 | 4/4 | 1418 ms |
| tsv | 5 ms | 1091 | ready | 3 | 6/6 | 4/4 | 1422 ms |
| xml | 4 ms | 2975 | ready | 1 | 6/6 | 4/4 | 1422 ms |
| html | 4 ms | 5309 | ready | 2 | 6/6 | 4/4 | 2282 ms |
| log | 48 ms | 5739 | ready | 2 | 6/6 | 4/4 | 1565 ms |
| **pdf** | **507 ms** | 5139 | ready | 2 | 6/6 | 4/4 | 2331 ms |
| **docx** | 75 ms | 5140 | ready | 4 | 6/6 | 4/4 | 1724 ms |

Every format extracted all six facts and retrieved 4/4. PDF is the slowest parse
by ~50x (507 ms vs 4-12 ms) and DOCX second (75 ms) — both are still far below the
embedding cost, so neither is worth optimising.

**The chunk counts show the chunker's format dispatch working**: the same content
yields 24 chunks as Markdown (headings drive the section-aware chunker), 4 as
plain text, and 1 as XML. Markdown's finer granularity is the reason heading paths
were introduced.

**RTF and ODT are NOT supported.** The brief lists them; `SAFE_DOCUMENT_EXTENSIONS`
is `.txt .md .markdown .json .csv .tsv .xml .html .htm .log .pdf .docx`. An upload
of either is refused at the extension whitelist. That is a product gap, not a bug
— but it is worth knowing it was never implemented rather than assuming it works.

Image-only / scanned PDFs are handled separately: the ingest path detects
placeholder-only content and marks the file `ocr_required` rather than embedding
page markers, which would otherwise manufacture a fake searchable document.

## Phase 30 — reranker bake-off

Full analysis in `reranking-benchmark.md`. Summary: hosted `rerank-2.5-lite` is
the most accurate (91% vs 85% top-1) at a comparable **median** (739 ms vs
708 ms), but its p99 is 8317 ms against the local model's 884 ms. Retrieval runs
on a deadline, so a late rerank is a discarded one. **The local cross-encoder
stays the default** — the measurement supports what already ships. `bge-reranker-
large` is strictly dominated: 20× slower *and* less accurate.

## Honest limits of this benchmark

- Corpora are synthetic. They give exact ground truth, which real documents cannot,
  but they are not a substitute for measuring extraction quality on real PDFs.
- Image OCR and scanned-PDF extraction quality remains unmeasured; the pipeline's
  `ocr_required` path is reached by detection, not by measuring OCR output.
- Fixtures are generated documents, not documents users actually wrote.
- Every mode scored 12/12 top-1 on the near-miss probe, so that probe **cannot
  distinguish** query/document asymmetry from sending nothing. It is reported as
  "not measurable", not as "no difference".
