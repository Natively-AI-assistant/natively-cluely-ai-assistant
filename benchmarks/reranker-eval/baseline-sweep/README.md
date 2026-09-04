# Baseline sweep — every reranker against *no* reranker

A second corpus and a different question from the harness one directory up.

`../run.mjs` compares reranker candidates on a fixture corpus of resumes and
JDs. This one asks a narrower thing: **does each reranker beat doing nothing,
and by how much** — across every route the app can take, including the ones the
sibling harness does not reach (local GGUF, and installed extensions).

## Why a separate corpus

Forty passages across eight topics. Each topic contributes ONE passage that
answers its question and FOUR that discuss the same subject in the same
vocabulary without answering it. A bi-encoder scores all five alike, so
separating them is exactly the work a reranker does — and it is the only way to
leave headroom above a strong embedder. An earlier attempt with topically
distinct passages had the embedder at 18/24 top-1 before any reranker ran, and
the differences between models vanished into noise.

Three phrasings per topic: plain, keyword-shifted toward a distractor, and
deliberately vague.

## Running it

```bash
npm run build:electron          # the sweep loads the built ports, not the sources
export OPENROUTER_API_KEY=...   # baseline embedder + the OpenRouter rows
export JINA_API_KEY=...         # optional; without it the Jina rows skip

node benchmarks/reranker-eval/baseline-sweep/build-corpus.mjs corpus.json   # regenerate (already committed)
node benchmarks/reranker-eval/baseline-sweep/baseline.mjs corpus.json baseline.json

# then one row at a time — a fresh process each, because llama.cpp and ONNX
# each hold hundreds of MB and one process sweeping ten models measures memory
# pressure rather than reranking
node benchmarks/reranker-eval/baseline-sweep/run-one.mjs onnx  ms-marco-minilm-l6      baseline.json out/x.json
node benchmarks/reranker-eval/baseline-sweep/run-one.mjs gguf  jina-reranker-v3.5-q4km baseline.json out/x.json
node benchmarks/reranker-eval/baseline-sweep/run-one.mjs openrouter cohere/rerank-4-pro baseline.json out/x.json
node benchmarks/reranker-eval/baseline-sweep/run-one.mjs jina   jina-reranker-v3.5      baseline.json out/x.json
node benchmarks/reranker-eval/baseline-sweep/run-one.mjs extension natively-jina-reranker baseline.json out/x.json
```

`baseline.json` freezes the embedded candidate list, so every reranker sees the
IDENTICAL pool and a re-run costs no embedding spend. Regenerate it only when
the corpus changes.

Local rows need the model installed (Settings → Reranker, or
`localModelInstaller.installCatalogModel`). Extension rows load the extension's
own `dist/` build from `~/natively-extensions/`.

## Reading the output

- **MRR** over ALL queries, not just answered ones — a model that returns null
  half the time must not outscore one that answers badly.
- **`+n/-n`** counts queries where the gold passage moved up / moved down
  against the baseline. A model can gain top-1 while regressing others, and
  that is what caught the broken extensions.
- **`failed`** counts null or incomplete returns. The seam rejects a partial
  ranking wholesale and keeps the existing order, so those look like success
  from outside — which is the whole reason this column exists.

## Results

`docs/reranker-benchmark-2026-09-04.md` — the 2026-09-04 run, and the source of
the `recommended` flags in `electron/rag/rerankerModelCatalog.ts`.
