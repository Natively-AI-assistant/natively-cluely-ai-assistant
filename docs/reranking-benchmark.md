# Reranking Benchmark

**Date:** 2026-09-08. Corpus: 32k-token generated document, 128 chunks, **100
questions** with exact ground truth, top-20 vector candidates handed to each
reranker. Local models were driven through their **real production path** — the
`localRerankerWorker` worker thread, same ONNX session options and tokenizer the
app uses — not a reimplementation. Raw: `benchmarks/results/rerank-bakeoff.json`.

## Results

| reranker | top-1 | % of ceiling | p50 | p95 | p99 |
|---|---|---|---|---|---|
| vector only (no rerank) | 54.0% | 58.1% | — | — | — |
| **hosted `rerank-2.5-lite`** | **91.0%** | 97.8% | 739 ms | 1249 ms | **8317 ms** |
| local `ms-marco-MiniLM-L-6-v2` *(current default)* | 85.0% | 91.4% | **708 ms** | **754 ms** | **884 ms** |
| local `bge-reranker-large` | 83.0% | 89.2% | 14458 ms | 18982 ms | 20923 ms |

*"% of ceiling" is top-1 as a fraction of the questions whose gold chunk was in
the top-20 at all. A reranker cannot find what it was never shown.*

## What this changes: nothing, and that is the finding

**Reranking is worth doing.** Every reranker beats vector-only by a wide margin —
54% → 83-91%. That is the single largest quality lever measured in this work.

**The hosted model is more accurate: 91% vs 85%, +6 points.** It also gets closer
to the ceiling (97.8% vs 91.4%), meaning it more reliably picks the right chunk
out of what it is given.

**But the tail says keep the local default.** Median latency is effectively tied —
739 ms hosted vs 708 ms local, and the local model has no network at all, so this
is a genuinely surprising result worth stating plainly: **the bundled cross-encoder
is not faster than a hosted call.** What separates them is predictability:

- local p99 **884 ms** — a tight distribution
- hosted p99 **8317 ms** — an order of magnitude worse, from provider rate limiting

Retrieval runs on a deadline (`rerankDeadlineMs`) and fails closed to the existing
order. An 8.3-second rerank is not a slow answer; it is a **discarded** one, and
the user gets un-reranked results having waited. A 6-point accuracy gain that
arrives after the deadline is worth nothing.

So the measurement **supports the arrangement that already ships**: local
cross-encoder as the default, hosted `rerank-2.5-lite` available as an explicit
opt-in for users who want the accuracy and accept the tail. The brief's rule —
change the production reranker only if benchmarks demonstrate a meaningful
improvement — is not met on latency, and latency is the stated priority.

This is worth being explicit about because the opposite conclusion was tempting:
the hosted model is newer, is the one this work added, and does win on accuracy.
It still should not become the default.

## `bge-reranker-large` should be reconsidered

It is offered in the catalogue and it is **strictly dominated**: 20× the latency
of the bundled model (14.5 s vs 0.7 s median) *and* lower accuracy (83% vs 85%).
There is no workload in this measurement where choosing it is correct. Most likely
the q8 quantisation that makes it loadable on CPU is also what costs it accuracy,
so it pays a large model's compute without delivering a large model's quality.

Recommend either removing it from the picker or labelling it clearly, since a user
choosing "large" reasonably expects better rather than worse.

## Caveats

- One 32k corpus of synthetic technical prose. Exact ground truth is why it is
  synthetic; real-document behaviour may differ.
- The hosted p99 reflects OpenRouter's 12M tokens/min **project** ceiling, which
  this session's own benchmarking was concurrently consuming. A quieter account
  would see a better tail — but the tail is a property of the shared limit, not an
  artefact, so it belongs in the decision.
- Local latency is this machine (Apple Silicon). A slower CPU shifts the local
  numbers and could reverse the median comparison.
