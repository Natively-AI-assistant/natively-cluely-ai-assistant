## Reranker benchmark — every model against a no-reranker baseline

Measured 2026-09-04 on macOS arm64. Forty passages across eight topics; each
topic contributes ONE passage that answers its question and FOUR that discuss
the same subject in the same vocabulary without answering it. A bi-encoder
scores all five alike, so separating them is exactly the work a reranker does.
Twenty-four queries (three phrasings per topic: plain, keyword-shifted toward a
distractor, and deliberately vague).

Every reranker sees the IDENTICAL frozen candidate list — the whole 40-passage
pool in retrieval order — so the only thing varying between rows is the
reranker. MRR is reported alongside top-1 because the baseline is already
strong and top-1 alone has too little resolution near the ceiling. `+/-` counts
queries where the gold passage moved up / moved down against the baseline: a
model can gain top-1 while making other queries worse, and that shows here.

**Baseline (no reranker at all)** — `openai/text-embedding-3-small` @ 1536:
top-1 **18/24**, top-3 22/24, mean rank 0.583, **MRR 0.8368**

| kind | model | top-1 | MRR | ΔMRR | mean rank | +/- | median ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| openrouter | `cohere/rerank-4-pro` | 24/24 | 1 | +0.1632 | 0 | +6/-0 | 824 |
| openrouter | `voyageai/rerank-2.5` | 23/24 | 0.9792 | +0.1424 | 0.042 | +6/-0 | 524 |
| openrouter | `cohere/rerank-4-fast` | 23/24 | 0.9722 | +0.1354 | 0.083 | +5/-0 | 450 |
| openrouter | `voyageai/rerank-2.5-lite` | 23/24 | 0.9688 | +0.1320 | 0.125 | +5/-1 | 523 |
| gguf | `jina-reranker-v3.5-q4km` | 22/24 | 0.9514 | +0.1146 | 0.125 | +5/-0 | 2082 |
| openrouter | `qwen/qwen3-reranker-8b` | 22/24 | 0.9514 | +0.1146 | 0.125 | +5/-0 | 656 |
| extension | `natively-jina-reranker` | 22/24 | 0.9514 | +0.1146 | 0.125 | +5/-0 | 2712 |
| onnx | `ettin-reranker-68m` | 21/24 | 0.9205 | +0.0837 | 0.5 | +4/-1 | 2303 |
| extension | `natively-qwen3-reranker` | 21/24 | 0.9201 | +0.0833 | 0.25 | +5/-2 | 2574 |
| gguf | `qwen3-reranker-0.6b-q4km` | 21/24 | 0.9201 | +0.0833 | 0.25 | +5/-2 | 4746 |
| onnx | `jina-reranker-v2-multilingual` | 21/24 | 0.9167 | +0.0799 | 0.292 | +5/-2 | 1866 |
| onnx | `ettin-reranker-150m` | 21/24 | 0.9125 | +0.0757 | 0.375 | +4/-1 | 5860 |
| openrouter | `cohere/rerank-v3.5` | 21/24 | 0.9083 | +0.0715 | 0.583 | +4/-1 | 461 |
| openrouter | `nvidia/llama-nemotron-rerank-vl-1b-v2:free` | 20/24 | 0.875 | +0.0382 | 0.091 | +4/-0 | 568 (2 null) |
| onnx | `ms-marco-minilm-l6` | 19/24 | 0.8688 | +0.0320 | 0.625 | +4/-2 | 211 |
| gguf | `bge-reranker-v2-m3-q4km` | 19/24 | 0.8618 | +0.0250 | 0.667 | +5/-3 | 1031 |
| onnx | `bge-reranker-large` | 18/24 | 0.8469 | +0.0101 | 0.625 | +3/-4 | 6007 |
| onnx | `mxbai-rerank-xsmall` | 18/24 | 0.8394 | +0.0026 | 0.708 | +3/-4 | 662 |
| onnx | `ettin-reranker-32m` | 18/24 | 0.8299 | -0.0069 | 1.208 | +3/-5 | 753 |

Not measured: the four **Jina hosted** models — no `JINA_API_KEY` exists in
`.env` or in the app's credential store, so they were skipped rather than
guessed at. The **Ettin extension** refuses at init by design; Core runs all
three Ettin sizes itself and they appear above.

### What the numbers say

- **Every reranker except one beat doing nothing.** `ettin-reranker-32m` is the
  exception at ΔMRR −0.0069: it moved 3 queries up and 5 down. The smallest
  model in the catalogue is not worth its 132 MB here.
- **Hosted wins on both quality and latency.** `cohere/rerank-4-pro` was perfect
  (24/24, MRR 1.0) at 824 ms for a 40-passage pool, and three more hosted models
  cleared MRR 0.96 at ~500 ms. Local models pay 2-6 s for less.
- **`jina-reranker-v3.5` is the best local model** (22/24, MRR 0.9514) and it
  never made a query worse (+5/−0). It costs 2 s and 410 MB.
- **Bigger is not better.** `bge-reranker-large` (580 MB, 6 s) scored ΔMRR
  +0.0101 — below `ms-marco-minilm-l6` at 24 MB and 211 ms.
- **Core and the extensions agree exactly.** `jina-reranker-v3.5` scored
  identically through Core's in-process llama.cpp and through the extension's
  `llama-server` path — same rank on all 24 queries — and so did Qwen3. Two
  independent implementations of each protocol producing identical rankings is
  the strongest correctness evidence in this table.
- **`nvidia/llama-nemotron-rerank-vl-1b-v2:free` returned null twice** out of 24
  with no error. Its MRR is computed over the 22 it answered, so the row is not
  comparable with the rest; the seam would keep the existing order on those two.
