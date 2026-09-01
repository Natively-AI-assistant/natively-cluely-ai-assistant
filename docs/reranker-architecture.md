# Reranking in Natively

How a retrieved passage gets its final order, who decides that, and how to add
another decider without touching the retrieval pipeline.

The governing idea, and the one thing to keep if everything else changes:

> **Embedding retrieval finds the candidate set. Reranking decides the order of
> those candidates.**

Those are separate choices, configured separately. A local embedder with a
hosted reranker is valid, and so is the reverse.

Companion documents: `docs/extensions.md` (the extension system itself — manifest,
permissions, sandbox, licensing) and `docs/reranker-task-brief.md` (why this was
built in this order).

---

## The pipeline

```
user query
   ↓
ModeHybridRetriever.retrieve()
   ↓  FTS + cosine hybrid scoring
candidate pool                          RERANK_CANDIDATE_POOL = 30
   ↓
maybeRerankCandidates()                 ModeHybridRetriever.ts:1518
   ↓  inside a 1200ms race              RERANK_BUDGET_MS = 1200 (line 1388)
   ↓
   resolvePort()  ────────────────────► the ONE seam, line 1545
   ↓
   rerankScore stamped on each chunk
   ↓  rankScore(c, true) orders by it   line ~1897
context block
   ↓
LLM
```

### There is exactly one seam

`ModeHybridRetriever.ts:1545` is the only place a reranker is chosen, and
`maybeRerankCandidates` is the only place one is called. Everything below plugs
in there.

A correction worth recording, because two files in this repo state it too
strongly. `docs/extensions.md` and `RerankerRegistry.ts` both say a second call
site "would fail those tests by design", citing
`ModeSpeculativeRerank.test.mjs:161` — *"rerank stays inside the existing
raceWithBudget envelope (no new unbounded await)"*. Read what it asserts:

```js
const src = fs.readFileSync(path.resolve(__dirname, '../../llm/WhatToAnswerLLM.ts'), 'utf8');
assert.match(src, /raceWithBudget\([\s\S]*?buildRetrievedActiveModeContextBlockHybrid/);
```

It reads `WhatToAnswerLLM.ts` and checks the **hybrid retrieval call** is
wrapped. It says nothing about `ModeHybridRetriever`, which hand-rolls its own
`setTimeout` + `Promise.race` and contains no `raceWithBudget` symbol at all. A
second rerank call site would not fail it.

**The single seam is a deliberate design decision, not a test-enforced
invariant.** Treat it as binding; do not assume a net catches you.

---

## Who may own the seam

`RerankerRegistry.resolvePort()` resolves, synchronously, in this order:

```
test override  >  OpenRouter (when selected)  >  enabled extension  >  built-in LocalReranker
```

| | Resolves when | Gate |
| --- | --- | --- |
| **Test override** | `ModeHybridRetriever.rerankerOverride` is set | tests only |
| **OpenRouter** | provider is `openrouter`, a key exists, a model is chosen, and privacy permits | `evaluateHostedEligibility()` |
| **Extension** | the `extensionRerankers` flag is on **and** exactly one enabled `type: "reranker"` extension | two independent gates |
| **Built-in** | always | — |

OpenRouter sits ahead of extensions because selecting a hosted provider is an
explicit choice, where an enabled extension is a standing preference.

`null` from `resolvePort()` means "use the built-in". `null` from a port's
`rerank()` means "keep the existing order".

### Everything fails closed

Missing, disabled, crashed, slow, throwing, or answering incompletely — every
one yields the pre-rerank ordering. **A reranker failure is never a user-visible
error and never changes safe-refusal behaviour.**

Incomplete rankings are rejected *wholesale*, which is the subtle one:
`rankScore(c, true)` returns `-Infinity` for a candidate with no `rerankScore`,
so a partial ranking silently sinks every unscored chunk below every scored one.
Every passage must be scored exactly once — no duplicate indices, no
out-of-range indices, no `NaN`/`Infinity` — or the whole call falls back.

### Two budgets, not one

| Path | Bound | Why |
| --- | --- | --- |
| Live transcript | **1200 ms** (`RERANK_BUDGET_MS`) | first-token latency |
| Document-grounded | **10 s** extension / **8 s** OpenRouter | `LLMHelper.ts:3032` passes `budgetMs: null`; nothing upstream bounds it |

Any latency claim must name which path it is about.

### Batch size belongs to the port

`RERANK_BATCH_SIZE = 6` splits the 30-candidate pool into 5 sequential calls.
That is an **ONNX arena-memory** measure, not a latency one, and it is exactly
wrong for a port whose cost is a round trip: five HTTP requests instead of one is
~5x the latency and ~5x the spend, enough to push a model that clears 1200 ms
well past it.

A port may declare `batchSize`. The built-in declares none and its arithmetic is
unchanged. `OpenRouterReranker` declares the whole pool.

---

## The built-in

| | |
| --- | --- |
| Model | `Xenova/bge-reranker-base`, ONNX q8 |
| Runtime | ONNX Runtime in a worker (`electron/rag/localRerankerWorker.ts`) |
| On disk | `resources/models/Xenova/bge-reranker-base/`, fetched at postinstall |
| Init timeout | 60 s (`LocalReranker.ts:74`) |
| Flags | `ragLocalRerank`, `ragSpeculativeRerank` — both default **ON** |

It is the fallback and the default, and it is deliberately not being changed.
It is also the weakest option measured — see *Measurements* below.

---

## Hosted rerankers (OpenRouter)

`electron/services/reranking/OpenRouterReranker.ts`.

```
POST https://openrouter.ai/api/v1/rerank
Authorization: Bearer <OPENROUTER_API_KEY>
{ model, query, documents: string[], top_n }
→ { results: [{ index, relevance_score, document }], usage: { cost }, provider }
```

Confirmed empirically against the real API (2026-09-01), not read from docs.
`results` arrives sorted descending by `relevance_score`.

### It is deliberately not an extension

Hosted rerank has no weights, no licence to acknowledge, no binary to spawn and
nothing to sandbox. Routing it through the extension host would gate it behind
`extensionRerankers`, require `network.remote` + `allowedHosts`, and duplicate
the OpenRouter client this repo already has for embeddings. It reuses the same
`openrouterApiKey` credential — one key, not two.

### Mapping back

**By index, never by returned document text.** Duplicate chunks are real in this
corpus (a heading repeated across files, boilerplate in two documents), and text
matching would attach one candidate's score to another candidate's file path,
page and offsets. Only the query and the passage text are sent — no ids, no
paths, no offsets.

### Discovery

```
GET https://openrouter.ai/api/v1/models?output_modalities=rerank
```

Server-side capability filter, no key required. **Nothing is hard-coded**: the
original brief recommended `qwen/qwen3-reranker-0.6b` and `-4b`, neither of which
OpenRouter serves — precisely how a hard-coded default ships a 404. The
catalogue is cached with last-known-good retained when discovery fails.

### No price is rendered

Every rerank model returns `pricing: {prompt: "0", completion: "0"}`, **including
the paid VoyageAI ones**. OpenRouter does not publish rerank pricing through the
models API, so any figure would read as "free" and be wrong. The real charge
comes from the response's own `usage.cost`, shown after a Test.

### Privacy

`providerDataScopes.reference_files` is the gate. It describes exactly what a
rerank request sends — retrieved document text — and is already enforced at every
other outbound boundary (`LLMHelper.ts:581, 6424`). Denying it blocks hosted
rerank **ahead of** the key and model checks, so the user is told the truth
rather than invited to fix a key that would not be used. It fails **closed** when
settings cannot be read.

`LLMHelper.isLocalOnly()` is also honoured, but note that `setLocalOnlyMode()`
has no production caller (`CodexVisionPayload2026_08_05.test.mjs:341` says so),
so today it is future-proofing rather than the real gate.

### Failures

401/403 auth · 402 credits · 404 model gone · 408 · 429 · 5xx · malformed.
Each maps to a distinguishable, actionable message — 402 must never read as
"check your API key". One bounded retry on 429/5xx, and only when the deadline
leaves room. Everything ends in `null`.

Fallback to the built-in is **opt-in** and always reported. Silently substituting
would reorder the user's evidence with a model they did not choose.

---

## Local rerankers (extensions)

An extension is a separately distributed adapter that teaches Core about one
model and carries that model's licence obligations. **Core contains no
model-specific code and distributes no weights.** See `docs/extensions.md`.

### Lifecycle, now wired

```
stageFromDirectory()       copy the payload into ~/.natively/extensions/<id>/
   ↓
ExtensionManager.install() validate manifest → trust prompt → record (enabled:false)
   ↓
ModelStore.download()      licence gate → HuggingFaceModelDownloader → sha256
   ↓
manager.enable() + load()  one Electron utilityProcess per extension
   ↓
RerankerRegistry           both gates → the seam
```

`wireExtensions()` (`appWiring.ts`) is called from `main.ts` after startup and
`disposeExtensions()` from `will-quit`. Before that call, nothing constructed an
`ExtensionManager`, so no extension could run in a shipped build.

### Downloading

`HuggingFaceModelDownloader` implements the `ModelDownloader` interface
`ModelStore` declared up front, so the licence gate is written once and cannot be
bypassed by the download path arriving later.

Three ways a download succeeds and is still wrong, all handled:

1. **A server that ignores `Range`** answers 200 with the whole file, not 206
   with the tail. Appending that to a partial produces a corrupt file of a
   plausible size. A 200 restarts from zero.
2. **`main` moves.** The commit sha is pinned before the first byte, so a resumed
   download cannot straddle two revisions.
3. **A manifest is downloaded content.** A scheme, host, traversal segment or
   extra path segment in `repo`/`repoPath` is refused before any request. A
   `null` repo id is refused — a guessed id must never be fetched.

Bytes land in `<file>.part` and are renamed only after the stream closes: nothing
observes a half-written model at its real path, and on Windows the rename would
otherwise hit the open-handle lock. The connect timeout covers headers only — a
400 MB model on a slow link is not a stuck request. (That one was a real bug,
found by downloading 128 MB for real and watching it abort twice at 30 s.)

### Installing is from a local directory

An entrypoint is real code that runs on the user's machine, and the sandbox is
defence in depth against a *sloppy* extension, not a boundary against a hostile
one. So fetching arbitrary code from a URL is materially different from
downloading weights, which are data checked against a recorded hash.

The remote registry is **metadata only** — ids, repos, versions, licence
identifiers. Remote payload installation needs signature verification, not just a
host allowlist, and is not implemented.

Staging refuses symlinks (they would place a reference to a file outside the
extension directory inside the one directory the broker treats as its own),
refuses an entrypoint that escapes, and refuses a **missing** entrypoint before
copying anything — otherwise an unbuilt extension installs cleanly and then fails
to start with a module-not-found error that reads like a Natively bug.

`node_modules` **is** copied. Skipping it looks like an obvious saving and is a
trap: the Ettin adapter does `await import('onnxruntime-node')` at init.
`node_modules/.bin` is skipped, because npm fills it with symlinked CLI shims
that would otherwise trip the symlink refusal and make every real extension
uninstallable. Native addons (`.node`) are reported at stage time: a prebuilt
addon compiled for plain Node fails under Electron's utilityProcess with
`ERR_DLOPEN_FAILED`, which reads as a Natively crash rather than as an extension
needing a rebuild.

---

## Direct install (no extension)

`Settings → Reranker → Download a different reranker`.

A curated catalogue (`electron/rag/rerankerModelCatalog.ts`) downloads a model
straight from Hugging Face into the directory `LocalReranker.resolveModelPath()`
already searches first:

```
<userData>/local-models/<org>/<name>/tokenizer.json
                                    /config.json
                                    /onnx/model_quantized.onnx
```

That is the layout transformers.js expects, so a completed download is loadable
by the reranker Core already ships. **No new runtime, no adapter, no extension
to stage.** Selection persists as `settings.reranker.localModelId`;
`reloadLocalReranker()` disposes the running worker so the switch takes effect
without a restart, and activation runs a real two-passage rerank before it
commits — a model that fails to load leaves the previous one active.

### This is a data table, not model-specific code

`docs/extensions.md`'s rule — Core contains no model-specific code — still
holds. A supported entry contributes a repository, a file list, a licence, a
`modelId` and a `dtype`. The runtime that executes it is the ONNX cross-encoder
Core already ships for `bge-reranker-base`. The rule yields for models the
existing runtime already handles; it still applies to anything needing a new one.

### What is listed, and why

| Model | Size | Runs in Core? |
| --- | --- | --- |
| MS MARCO MiniLM L6 (`Xenova/ms-marco-MiniLM-L-6-v2`) | 24 MB | **yes** — measured 157 ms |
| mxbai Rerank XSmall (`mixedbread-ai/mxbai-rerank-xsmall-v1`) | 96 MB | **yes** — measured 524 ms |
| BGE Reranker Large (`Xenova/bge-reranker-large`) | 580 MB | yes — slowest to load |
| Ettin Reranker 32M / 68M / 150M | 132–603 MB | **yes** — head applied outside the graph |
| BGE Reranker v2 m3 Q4_K_M (GGUF) | 438 MB | **yes** — llama.cpp, 71 ms warm |
| Jina v3.5 Q4_K_M, Qwen3 0.6B Q4_K_M (GGUF) | 397 / 484 MB | no — no ranking head, see below |

Every entry marked runnable had its ONNX graph opened and checked for a `logits`
output before it was listed.

### Ettin keeps its scoring head outside the ONNX graph

`cross-encoder/ettin-reranker-*`'s `onnx/model.onnx` emits **`last_hidden_state`,
not `logits`** — the export is the transformer backbone only. Loaded with
`AutoModelForSequenceClassification` it initialises cleanly and then returns
`output.logits === undefined`, which surfaces as *"unexpected logits shape —
skipping rerank"*. That is what made it look unsupported.

The scoring head is real, it just lives beside the graph as a
Sentence-Transformers module chain:

```
modules.json
  0 Transformer   -> the ONNX graph        last_hidden_state [B, T, W]
  1 Pooling       1_Pooling                pooling_mode: "cls"
  2 Dense         2_Dense                  W -> W, GELU, no bias
  3 LayerNorm     3_LayerNorm              W
  4 Dense         4_Dense                  W -> 1, Identity, bias   => the score
```

`electron/rag/sentenceTransformerHead.ts` implements it: a safetensors reader
and the four modules. The worker detects `modules.json`, loads the backbone with
`AutoModel` instead, and applies the chain per sequence. An ordinary
cross-encoder is untouched — it still takes the `logits` path.

**Validated numerically, not by eye.** sentence-transformers 5.5.1 + torch 2.12
scoring the 32M model on four pairs gives
`[-2.4756, 5.6259, -3.9399, 4.2273]`; this implementation reproduces them to
**4.05e-6** with identical ranking, in 321 ms. Those numbers are pinned in
`SentenceTransformerHead.test.mjs`.

Two details worth keeping:

- **GELU is the exact form** (`0.5x(1+erf(x/√2))`), not the tanh approximation.
  `nn.GELU` defaults to exact, and the two differ by ~1e-3 — small enough to
  look fine, large enough to reorder near-tied passages.
- **A chain not ending in a 1-wide Dense is refused.** That is an embedding
  model, and running it would yield a vector where a score is expected. So are
  a non-`cls` pooling mode, a non-F32 tensor and an unknown activation:
  approximating any of them produces a plausible wrong ordering with no error.

### GGUF runs in Core, via llama.cpp

`node-llama-cpp` gives Core a second local runtime. `electron/rag/GgufReranker.ts`
is the seam port; inference runs in `ggufRerankerWorker.ts`, a worker thread —
the same rule the ONNX reranker follows after the 2026-07-05 SIGTRAP crashes,
because llama.cpp is a native addon that can abort the thread it runs on.

**llama.cpp only ranks a model that has a ranking head.** Measured:

| GGUF | arch | result |
| --- | --- | --- |
| bge-reranker-v2-m3 Q4_K_M | `bert` | **works** — 1708 ms cold, **71 ms warm** |
| jina-reranker-v3.5 Q4_K_M | `qwen3` | refused: no ranking head |
| qwen3-reranker-0.6b Q4_K_M | `qwen3` | refused: no ranking head |

The two refusals are not a bug to fix here. Both are generative models scored a
completely different way — the reference `rerank.py` in Jina's own GGUF repo
needs a **patched** llama.cpp (sliding-window fix), the `llama-embedding` binary
with `--output-token-ids` to extract per-token hidden states, and a separate
`projector.safetensors` applied by cosine similarity. No JS binding exposes
that. Qwen3-Reranker would need yes/no token-logit scoring, which is not
implemented. Both are listed with that reason, and the installer refuses them
before spending several hundred megabytes.

Packaging note: the two `node-llama-cpp` trees are in `asarUnpack`. The existing
`**/*.node` and `**/*.dylib` patterns do **not** cover the backend libraries it
ships — `libggml-blas.so`, `libggml-cpu-apple_m1/m2_m3/m4.so`, `libggml-metal.so`
are `.so` on macOS and llama.cpp dlopens them at runtime. Without the explicit
entries the runtime works in dev and fails only once packaged.

## Settings

**One** section: `Settings → Reranker` (`src/components/settings/RerankerSettings.tsx`).
Provider is a choice *inside* it. There is deliberately no separate
"Local Reranker" and "OpenRouter Reranker" pane — only one reranker owns the
seam, so two places to configure one would let a user set two that cannot both
be active. Reranker extensions are listed there too.

Persisted under `settings.reranker`:

```jsonc
{
  "provider": "local",          // 'local' | 'openrouter'; absent === local === today's behaviour
  "openrouterModel": "voyageai/rerank-2.5-lite",
  "candidateCount": 15,
  "topN": 5,
  "fallbackToLocal": false,     // opt-in
  "lastTest": { "at": "…", "model": "…", "latencyMs": 420, "ok": true }
}
```

The API key lives in `CredentialsManager` (`openrouterApiKey`), never here —
this file is plaintext on disk. The key never crosses the IPC boundary; only
its presence does.

---

## Measurements

`benchmarks/reranker-eval`, run 2026-08-31, n = 28 scored queries, 26-chunk
pools, development machine (**not** user hardware).

| Candidate | MRR | nDCG@10 | p50 | p95 | clears 1200 ms |
| --- | --- | --- | --- | --- | --- |
| baseline (cosine only) | 0.483 | 0.568 | — | — | — |
| **bge-reranker-base** (shipping) | 0.539 | 0.607 | 2098 ms | **2475 ms** | **no** |
| voyage-rerank-2.5 | **0.905** | 0.929 | 783 ms | 830 ms | yes |
| voyage-rerank-2.5-lite | 0.864 | 0.898 | 784 ms | 868 ms | yes |
| cohere-rerank-4-pro | 0.848 | 0.876 | 752 ms | 980 ms | yes |
| cohere-rerank-4-fast | 0.838 | 0.879 | 724 ms | 792 ms | yes |
| cohere-rerank-v3.5 | 0.819 | 0.864 | 719 ms | 1072 ms | yes |
| qwen3-reranker-8b | 0.890 | 0.918 | 935 ms | **5921 ms** | no |
| bge-reranker-large | FAILED — 180 s timeout | | | | unmeasured |
| nvidia-nemotron-rerank-vl-1b-v2 | FAILED — 429, free tier 20/min | | | | unmeasured |

**Content-free top-picks** — the #1 result is a bare heading with no body text:
bge-reranker-base **7/28 (25 %)**; every hosted candidate 0–4 %; baseline 7 %.
The shipping reranker is worse than no reranker on this axis, and this
discriminates better than MRR here.

Caveats from `REPORT.md` are real: production batches in 6s where the benchmark
issued one call per query, so production overhead is likely **equal or higher**.
Results are gitignored on purpose — machine-specific numbers invite bogus
cross-machine comparisons.

The `recommended` group in the model picker is derived from this table, not from
OpenRouter's usage rankings, which measure popularity rather than quality.

---

## Adding another OpenRouter rerank model

Nothing. `?output_modalities=rerank` discovers it, the picker groups it, and the
pipeline never learns its name. Only two things are hand-maintained:

- `groupFor()` in `openrouterRerankModels.ts` — which shelf it sits on. An
  unlisted model lands in `other`, which is correct until it has been measured.
- Promotion to `recommended` requires a benchmark run. A model does not get
  promoted for being popular.

## Adding another local reranker

Write an extension. Core does not change. Implement the five-member `Reranker`
interface from `electron/services/extensions/types.ts` (`id`, `name`, `init`,
`rerank`, `dispose`) — that shape is pinned by
`ExtensionContextAndLicenseGate.test.mjs` and must not grow — declare the model
and its licence in `extension.json`, and ship the runtime inside the extension.

Score **every** candidate. If the underlying engine omits one, give it a
deterministic floor below every real score rather than dropping it; the host
rejects an incomplete ranking wholesale.

---

## Verified, and not

**Verified end-to-end**
- 128 MB download of `cross-encoder/ettin-reranker-32m-v1` from Hugging Face;
  sha256 matched the manifest; appending one byte failed verification.
- Under Electron: stage → install (recorded `enabled: false`) → flag gate
  refuses → enable → real `utilityProcess` starts → `resolvePort()` → rerank
  across the process boundary in 1 ms with correct ordering → `unloadAll()`.

**Verified for direct install**
- BGE Reranker v2 m3 (GGUF, 438 MB) installed through the app's own installer,
  sha256 verified, then reranked through the worker-backed seam port: 1708 ms
  cold, 71 ms warm, correct ordering. `rankAll` confirmed to return scores in
  input order and to score duplicate passages identically.
- Ettin 32M installed through the app's own installer (12 files, 132 MB) and
  scored against sentence-transformers: max difference 4.05e-6, identical
  ranking. The ordinary cross-encoders still take the logits path unchanged.
- `Xenova/ms-marco-MiniLM-L-6-v2` and `mixedbread-ai/mxbai-rerank-xsmall-v1`
  downloaded from Hugging Face through the installer, sha256-checked, then run
  on Core's existing runtime: 157 ms and 524 ms, both ranking the relevant
  passages first.
- Ettin's backbone-only export confirmed by reading the ONNX graph's output
  names with onnxruntime.

**Not verified**
- macOS only. Nothing here has been executed on Windows.
- The Jina and Qwen extensions need `llama-server` on `PATH`; it is not
  installed on this machine, so their rerank path is reviewed, not run.
- The Ettin *extension*'s `scoreBatch()` is still a scaffold that throws. It is
  now redundant for these models: Core runs them directly through the catalogue,
  so the extension is not the route to Ettin any more.
- No hosted rerank has been run through the live app UI; the OpenRouter path is
  covered by unit tests against a mocked fetch plus the benchmark's real API run.
