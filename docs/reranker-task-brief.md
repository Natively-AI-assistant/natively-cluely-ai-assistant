# Reranker Model Settings + OpenRouter Hosted Rerank — revised task brief

> Replaces the two original prompts ("Reranker Model Settings & Local Model Management"
> and "Add OpenRouter Hosted Reranker Support"). Written after reading the working tree
> on `feat/extension-system` at 2026-09-01. Every number, path and line reference below
> was verified in this repo or against the live OpenRouter API on that date.
>
> The original briefs were written against an architecture this branch no longer has,
> and against a starting point that has since moved a long way. **The three optional
> rerankers they ask you to build already exist**, as working extensions in sibling
> repos (see A.4). Most of brief #1's Phases 1–7 are therefore already done, and
> several of its other phases would actively violate constraints this branch commits
> to. What is actually missing is four Core-side items, listed in A.3.
>
> Read Part B before writing any code.

---

## Step 0 — the WIP is untracked. Commit or stash it first.

These exist in the working tree and are **not in git**:

```
electron/services/extensions/          (12 source files + 5 test files, ~3.3k lines)
electron/services/reranking/RerankerRegistry.ts    (305 lines)
electron/services/__tests__/ExtensionRerankerRegistry.test.mjs
resources/models/Xenova/bge-reranker-large/        (~560MB of weights)
embedding-benchmark/
```

A fresh agent that does not read them will recreate files that already exist, and
`npm run build` wipes `dist`. Commit or stash before anything else.

**Also read `/Users/evin/natively-extensions/` before planning anything.** Four sibling
repos live there — `natively-jina-reranker`, `natively-qwen3-reranker`,
`natively-ettin-reranker`, `natively-extension-registry`. They are outside this git
repo, so nothing in `git status` hints at them, and searching `electron/ src/ docs/`
will not find them. They are the reason most of brief #1 is already finished.

Also: `benchmarks/` is gitignored repo-wide. Anything new under
`benchmarks/reranker-eval/` needs `git add -f`. `benchmarks/reranker-eval/results/`
is gitignored on its own and must stay that way — machine-specific latency numbers
invite bogus cross-machine comparisons. Paste `REPORT.md` content instead.

---

# Part A — what already exists

This section replaces Phase 0 ("understand the existing architecture") of brief #1.
Do not re-derive it. Verify anything you intend to change; take the rest as given.

## A.1 The real retrieval path

```
ModeHybridRetriever.retrieve()
  → FTS + cosine hybrid candidate pool
  → maybeRerankCandidates(queryText, candidates)        ModeHybridRetriever.ts:1518
      → raceWithBudget(RERANK_BUDGET_MS = 1200)         ModeHybridRetriever.ts:1388
      → seam: getRerankerRegistry().resolvePort()       ModeHybridRetriever.ts:1545
      → else built-in LocalReranker (batches of 6)      RERANK_BATCH_SIZE, line 190
  → stamps rerankScore on each chunk
  → rankScore(c, true) orders by it                     line 1897
  → context block → LLM
```

**There is exactly one rerank seam: `ModeHybridRetriever.ts:1545`.** It is the only
call site, and everything below plugs into it or it does not ship.

One correction to what `docs/extensions.md` and `RerankerRegistry.ts:13` both claim
about this. They say a second call site "would fail those tests by design," citing
`ModeSpeculativeRerank.test.mjs`. The guard is real — `electron/services/__tests__/ModeSpeculativeRerank.test.mjs:161`,
*"rerank stays inside the existing raceWithBudget envelope (no new unbounded await)"* —
but read what it actually asserts:

```js
const src = fs.readFileSync(path.resolve(__dirname, '../../llm/WhatToAnswerLLM.ts'), 'utf8');
assert.match(src, /raceWithBudget\([\s\S]*?buildRetrievedActiveModeContextBlockHybrid/);
```

It reads `WhatToAnswerLLM.ts` and checks that the **hybrid retrieval call** is wrapped
in `raceWithBudget`. It says nothing about `ModeHybridRetriever` and would not fail if
someone added a second rerank call site. `ModeHybridRetriever.ts:1388-1400` uses a
hand-rolled `setTimeout` + `Promise.race`; there is no `raceWithBudget` symbol in that
file at all.

**So: the single seam is a deliberate design decision, not a test-enforced invariant.**
Treat it as binding anyway — but do not assume a safety net catches you if you violate
it, and do not tell a reviewer the tests will.

## A.2 The built-in reranker

| | |
|---|---|
| Model | `Xenova/bge-reranker-base`, ONNX q8 |
| Runtime | ONNX Runtime, in a worker (`electron/rag/localRerankerWorker.ts`) |
| On disk | `resources/models/Xenova/bge-reranker-base/`, fetched at postinstall by `scripts/download-models.js`, mapped via `extraResources` |
| Init timeout | `WORKER_INIT_TIMEOUT_MS = 60_000` (`LocalReranker.ts:74`) |
| Batch | 6 passages per cross-encoder call |
| Flags | `ragLocalRerank`, `ragSpeculativeRerank` — both default **ON** |

`bge-reranker-large` (~560MB) is on disk **untracked** and is **not** in
`download-models.js`'s manifest. It is not part of the shipped model set.

## A.3 The extension system (Core: Phases 1–3 built, 4–5 not)

Fully documented in `docs/extensions.md` — read it, it is accurate. The parts that
constrain this task:

- **Core contains no model-specific code and distributes no weights.** An extension
  is a separately distributed adapter carrying one model's own licence obligations.
- The Core-side `Reranker` interface is exactly five members — `id`, `name`, `init`,
  `rerank`, `dispose` (`electron/services/extensions/types.ts`). Its shape is pinned
  by `ExtensionContextAndLicenseGate.test.mjs`; "it cannot grow by accident."
- `ModelStore.ts` owns the licence gate and declares `ModelDownloader` at line 47
  **specifically so the download path can be injected later without bypassing the
  gate**. Downloading itself is unimplemented (extension Phase 4).
- `RerankerRegistry` resolves the seam: `test override > enabled extension > built-in`.
  Two gates, both required — the `extensionRerankers` flag
  (`NATIVELY_EXTENSION_RERANKERS`, **default false**, `intelligenceFlags.ts:527`)
  **and** exactly one installed+enabled extension of `type: "reranker"`. Two enabled
  rerankers → refuse and fall back.
- Everything fails closed to the built-in ordering: missing, disabled, crashed, slow,
  throwing, or an incomplete ranking all yield `null` = keep existing order.
  Incomplete rankings are rejected wholesale because `rankScore(c, true)` returns
  `-Infinity` for an unscored candidate.
- `EXTENSION_RERANK_TIMEOUT_MS = 10_000` — a **second, different** ceiling from the
  1200 ms live-path budget, needed because `LLMHelper.ts:3032` passes `budgetMs: null`
  on the document-grounded path.
- **Nothing constructs `ExtensionManager`.** No extension can run in a shipped build.
  There is no Settings → Extensions UI and no Settings row for the flag.

### What is missing on the Core side — the complete list

1. **`ModelDownloader` has no implementation.** `ModelStore.download()` throws
   `'no ModelDownloader configured (downloads land in Phase 4)'` (`ModelStore.ts:227`).
   Nothing can fetch weights.
2. **`ExtensionManager` is never constructed** outside tests. No startup wiring, no
   teardown on quit.
3. **No install path.** The extensions' READMEs document
   `natively extension install github:evinjohnn/natively-<name>` — that CLI does not
   exist. Neither does registry fetching: `ExtensionRegistry.ts` reads the *local*
   `~/.natively/extensions/registry.json` only; nothing consumes the remote
   `natively-extension-registry`.
4. **No Settings UI**, and no row for `extensionRerankers`.

That is the whole gap. It is four items, all Core-side, and none of them is a model.

## A.4 The three model extensions already exist and are built

**This is the single biggest divergence from the original briefs.** They are not in
this repo — they are sibling repos at `/Users/evin/natively-extensions/`:

| Directory | id | Model | Runtime | Licence |
|---|---|---|---|---|
| `natively-jina-reranker` | `jina-reranker-v35` | `jinaai/jina-reranker-v3.5-GGUF`, `jina-reranker-v3.5-Q4_K_M.gguf`, 397 MB, sha256 recorded | GGUF via `llama-server` (spawn + loopback) | **CC-BY-NC-4.0**, `requiresAcknowledgement: true` |
| `natively-qwen3-reranker` | `qwen3-reranker` | `QuantFactory/Qwen3-Reranker-0.6B-GGUF`, `Qwen3-Reranker-0.6B.Q4_K_M.gguf`, 484 MB, sha256 recorded | GGUF via `llama-server` | Apache-2.0, no ack |
| `natively-ettin-reranker` | `ettin-reranker` | `cross-encoder/ettin-reranker-{32m,68m,150m}-v1`, ONNX, 128/273/597 MB, sha256 on each `model.onnx` | ONNX, in-process (`filesystem.models` only, no spawn) | Apache-2.0, no ack |
| `natively-extension-registry` | — | metadata-only registry (`registry.json`, weight guard, validate script) | — | MIT |

Each has `src/`, `dist/`, `__tests__/conformance.test.mjs`, `LICENSE`, `registry-entry.json`,
`manifest.base.json` and a generator.

**Corrected 2026-09-01 after running them.** They are real adapters, but they are
not all working:

- **Ettin** — `init()` loads real weights and succeeds (1159 ms with the 32m
  model), but `scoreBatch()` throws *"ONNX tokenisation/inference is not
  implemented yet. This adapter is a scaffold; implement scoreBatch() against
  real weights before enabling this extension."* It cannot rerank.
- **Jina / Qwen** — rerank is fully implemented, including the "score every
  candidate or the host rejects the ranking wholesale" rule. Both POST to a local
  `llama-server` `/v1/rerank`, and `llama-server` is not on this machine's PATH,
  so neither has been run.

So the three extensions are structure plus one unfinished method and one missing
binary — not three finished rerankers. Core handles both cases correctly (a
throwing extension falls back to the existing ordering), but no local extension
reranker can be measured until one of them can actually score.

**Their manifests validate against Core's live schema.** Core moved in lockstep: the
`repoPath` field these manifests use is already in `ExtensionManifest.ts:67`, with a
traversal guard at line 216. `repo` is resolved (not `null`) on every model, and the
primary weight file of each carries a real sha256. Nothing here needs Core schema work.

### Two things about them that change the task

**1. Jina and Qwen require `llama-server` on the user's PATH. It is not bundled.**
From `natively-jina-reranker/README.md`: *"This extension does not vendor or download
llama.cpp. It locates `llama-server` on your PATH or at a configured path and prompts
you if it is missing."* Both declare `process.spawn` + `allowedBinaries: ["llama-server"]`
+ `network.localhost`, and `JinaReranker.ts:30` reads `ctx.config.llamaServerPath` with
a bare `'llama-server'` fallback.

This **directly contradicts brief #1 Phase 6** ("download → ready to use"; the user
should not configure a runtime or a path). For two of the three extensions that promise
cannot be kept as written. Resolve it explicitly — bundle a llama.cpp build, detect and
guide, or state the dependency up front in the install flow — and write the decision
down. Do not let the UI say "Ready" for a model whose runtime is absent.

**Ettin is the exception**: ONNX, in-process, no spawn, no external binary. It is the
only one of the three that genuinely delivers download-then-use, and it is also the
smallest. That makes it the right first extension to wire end-to-end.

**2. Ettin's ONNX runtime is a native addon, so the sandbox does not see it.**
`docs/extensions.md` is explicit that this is hole #1: a `.node` binary does its I/O
from C++ and never passes a patched `require` or global. This is known and accepted, not
a bug to fix — but say so in the trust prompt rather than implying the sandbox contains it.

## A.5 OpenRouter is already integrated (for embeddings)

`electron/rag/openrouterEmbeddingModels.ts` discovers embedding models via
`GET /models?output_modalities=embeddings` — server-side capability filter, works
unauthenticated. Credentials live in `CredentialsManager`; settings in
`SettingsManager`. Settings → Embeddings (`src/components/settings/EmbeddingSettings.tsx`,
937 lines, tab `'embedding'`, registered at `SettingsOverlay.tsx:1887`) is the freshest
in-repo pattern for: provider card, live model discovery, a Test button that sends one
real request. **Mirror it.** Do not invent a second credential store or a second
OpenRouter client.

## A.6 Local-only mode exists

`LLMHelper.setLocalOnlyMode()` / `isLocalOnly()` (`LLMHelper.ts:491, 1187, 1192`), with
"last boundary" guards at `1610`, `1643`, `1675`. That is the anchor for the hosted-rerank
privacy gate. It is a `LLMHelper` field, not a settings flag — check how it is set before
wiring to it.

## A.7 The benchmark already ran, and it already answers the product question

`benchmarks/reranker-eval/` (run.mjs / score.mjs / lib / fixtures) is built and was run
on **2026-08-31**. n = 28 scored queries, 26-chunk pools. From `results/REPORT.md`:

| Candidate | MRR | nDCG@10 | p50 | p95 | clears 1200 ms? |
|---|---|---|---|---|---|
| baseline (cosine only) | 0.483 | 0.568 | — | — | — |
| **bge-reranker-base** (shipping) | 0.539 | 0.607 | 2098 ms | **2475 ms** | **no** |
| bge-reranker-large | FAILED — subprocess timed out at 180 s | | | | unmeasured |
| openrouter-voyage-rerank-2.5 | **0.905** | 0.929 | 783 ms | **830 ms** | yes |
| openrouter-voyage-rerank-2.5-lite | 0.864 | 0.898 | 784 ms | 868 ms | yes |
| openrouter-cohere-rerank-4-pro | 0.848 | 0.876 | 752 ms | 980 ms | yes |
| openrouter-cohere-rerank-4-fast | 0.838 | 0.879 | 724 ms | 792 ms | yes |
| openrouter-cohere-rerank-v3.5 | 0.819 | 0.864 | 719 ms | 1072 ms | yes |
| openrouter-qwen3-reranker-8b | 0.890 | 0.918 | 935 ms | **5921 ms** | no |
| openrouter-nvidia-nemotron-rerank-vl-1b-v2 | FAILED — 429, free tier 20 req/min | | | | unmeasured |
| cohere-rerank-v3.5 (native API) | SKIPPED — no key | | | | unmeasured |

**Content-free top-picks** (the #1 result is a bare heading with no body text):
bge-reranker-base **7/28 = 25 %**; every hosted candidate 0–4 %; baseline 7 %.
The shipping reranker is worse than no reranker at all on this axis. This is the
strongest finding in the data and neither original brief mentions it.

Development machine, not user hardware. Caveats in `REPORT.md` are real: production
batches in 6s where the benchmark issues one call per query, so production overhead is
likely **equal or higher**, not lower.

### What this means for the task

The shipping local reranker already loses its own 1200 ms race at p95. Both original
briefs treat local rerankers as the default and hosted as an add-on. On this machine's
measured data that ordering is backwards. **Brief #2 (OpenRouter) has the stronger
premise and should be built first.**

## A.8 OpenRouter's rerank catalogue — verified live 2026-09-01

`GET https://openrouter.ai/api/v1/models?output_modalities=rerank` **works, unauthenticated.**
Returns exactly 7 models:

```
qwen/qwen3-reranker-8b                        ctx 40960
voyageai/rerank-2.5-lite                      ctx 32000
voyageai/rerank-2.5                           ctx 32000
nvidia/llama-nemotron-rerank-vl-1b-v2:free    ctx 10240
cohere/rerank-4-pro                           ctx 32768
cohere/rerank-4-fast                          ctx 32768
cohere/rerank-v3.5                            ctx  4096
```

Two corrections to brief #2's model list:

- **`qwen/qwen3-reranker-0.6b` and `qwen/qwen3-reranker-4b` do not exist on OpenRouter.**
  Only the 8B does. Brief #2 §14 recommends the 0.6B as the "small multilingual model";
  that recommendation has no target. Drop it.
- **`pricing` is `{"prompt":"0","completion":"0"}` for every rerank model, including the
  paid Voyage ones.** The models API does not expose rerank pricing. Brief #2 §8's
  "fetch current pricing from OpenRouter metadata instead of hard-coding" is not
  possible — it yields zeros. Real per-call cost **is** returned by the rerank endpoint
  itself as `usage.cost`, which is what the benchmark already records. Use that.

## A.9 The rerank request shape is already verified in-repo

`benchmarks/reranker-eval/lib/rerankers/openrouter.mjs` — confirmed empirically against
the real API on 2026-09-01:

```
POST https://openrouter.ai/api/v1/rerank
Authorization: Bearer $OPENROUTER_API_KEY
{ model, query, documents: string[], top_n }
→ { results: [{ index, relevance_score, document }], usage: { cost }, provider }
```

`results` arrives already sorted descending by `relevance_score`. Brief #2 §2's "adapt
the exact request fields to the current spec" is done — port that module, do not
re-discover it.

---

# Part B — corrections to the original briefs

## B.1 Brief #1, Phase 4 ("model registry") — **delete and replace**

A Core-level registry listing BGE / Jina / Qwen / Ettin is exactly what the extension
system exists to prevent (`docs/extensions.md`: "Natively Core contains no
model-specific code", "Core distributes no weights"). Adding one re-introduces the
coupling this branch just removed.

**Replacement:** Core ships zero new model entries. Each optional model is **one
extension**, whose `extension.json` carries its own `models[]` block with `repo`,
`repoPath`, `file`, `approxBytes`, `sha256` and its own `license`. This is not a
proposal — all three manifests are written and validate against Core's live schema
(A.4). Core's local index is `~/.natively/extensions/registry.json`
(`ExtensionRegistry.ts`); the remote catalogue is the separate
`natively-extension-registry` repo, which nothing in Core reads yet.

## B.2 Brief #1, Phase 1 (the `Reranker` interface) — **already exists, do not widen it**

The brief proposes an 8-member interface with `isInstalled` / `install` / `uninstall` /
`getCapabilities` / `getStatus`. The shipped Core interface has 5 members and its shape
is pinned by a test that exists to stop it growing.

Install/uninstall/status are **host** concerns, not adapter concerns. They belong to
`ExtensionManager` + `ModelStore`, which already model them (`ModelState` is
`not-downloaded | downloading | ready | verification-failed | blocked-unacknowledged`).
Brief #1 Phase 5.2's nine UI states map onto that enum plus the host's lifecycle —
map them, don't add a parallel state machine.

## B.3 Brief #1, Phase 7 (`RerankerRuntime` tree) — **delete**

`GGUFRuntime / ONNXRuntime / OllamaRuntime / TransformersRuntime` in Core is the same
violation as B.1. Runtimes live **inside** each extension; that is what an extension is.
Core knows `init` / `rerank` / `dispose` and nothing else. Brief #1's own rule "avoid
adding a multi-gigabyte runtime solely to support one optional model" is satisfied
automatically once the runtime ships with the extension rather than with Natively.

## B.4 Brief #1, Phase 3 (`ModelSource` abstraction) — **collapse into `ModelDownloader`**

`ModelStore.ts:47` already declares the interface, deliberately, so the licence gate is
written once and cannot be bypassed by the download path arriving later. Implement
that interface. Do not build a parallel `HuggingFaceSource` / `OllamaSource` subsystem
beside it.

On Ollama specifically: brief #1 §3.2's caution is right but the conclusion is simpler
here. An Ollama-backed reranker is an extension that declares `network.localhost` and
talks to the local Ollama HTTP API. Core needs no Ollama knowledge at all. If Ollama
cannot serve a given reranker architecture, that is that extension's problem to detect
and report, not Core's.

## B.5 Brief #1, Phase 5 + extension Phase 5 — **one surface, not two**

Brief #1 wants Settings → Reranker. `docs/extensions.md` promises Settings → Extensions.
Brief #2 §25 forbids duplicate reranker sections. All three want the same pane.

**Decision to make explicitly and record in `docs/reranker-architecture.md`:**
`Settings → Reranker` is the user-facing surface. It lists the built-in, any installed
reranker extensions, and the OpenRouter provider. A general Settings → Extensions pane
(for non-reranker extension types) can come later and link to it. Do not ship both.

This pane is also where the `extensionRerankers` flag finally gets a row — it is
env-only today, which is why brief #1's Phase 14 migration concern is already moot
(see B.7).

## B.6 Brief #2 — **do not make OpenRouter an extension**

Hosted rerank has no weights, no licence acknowledgement, no spawned binary and nothing
to sandbox. Routing it through the extension host would gate it behind
`extensionRerankers`, require `network.remote` + `allowedHosts`, and duplicate the
OpenRouter client that already exists for embeddings.

It belongs beside `openrouterEmbeddingModels.ts`, reusing `CredentialsManager` and
`SettingsManager` — which is what brief #2 §6 and §7 already say.

**That makes the single seam a three-way contest. State the chain, don't improvise it:**

```
test override  >  OpenRouter (when provider == 'openrouter')  >  enabled reranker extension  >  built-in LocalReranker
```

It must resolve **inside `RerankerRegistry.resolvePort()`**. `ModeHybridRetriever.ts:1545`
stays the only call site.

## B.7 Brief #1, Phase 14 (migration) — **already satisfied; the real work is different**

The extension flag is default-OFF and env-only, and nothing constructs
`ExtensionManager`. No existing user can have their reranker silently changed today.
The actual Phase 14 work is (a) adding the Settings row, and (b) making sure
`reranker_provider` defaults to `local` + `bge-reranker-base` for anyone with no stored
preference. Both are small.

## B.8 Two budgets, not one — brief #1 Phase 8 and brief #2 §20 both need to say which

A local extension reranker gets **10 s** on the document-grounded path
(`budgetMs: null` upstream, ceiling enforced by the registry) and **1200 ms** on the
live transcript path. Any latency claim must name which path it is about.

Report every measured p95 against **1200 ms explicitly**. "Responsive" is not a
criterion; `RERANK_BUDGET_MS` is.

Brief #1 Phase 8's candidate-depth setting (5/10/15/20): the existing pool is ~26
chunks reranked in batches of 6. Introducing a depth control changes the batching
arithmetic — say so, and keep the existing default.

## B.9 Brief #2 §15 (multimodal) — **out of scope, say so**

`ModeHybridRetriever` has no image-candidate representation. There is nothing to send.
The only multimodal model in the catalogue (`nvidia/llama-nemotron-rerank-vl-1b-v2:free`)
is free-tier at 20 req/min and 429'd mid-benchmark. Mark multimodal rerank explicitly
out of scope rather than building a speculative path with no producer.

## B.10 Brief #1's model list — the models are done; Core is what's missing

| Original brief said | Actual state |
|---|---|
| BGE Reranker Base — "bundled, included" | Correct. Stays in Core, stays the fallback. Also the worst performer measured (25 % content-free top picks, p95 2475 ms). |
| BGE Reranker Large | Untracked on disk, not in `download-models.js`, FAILED at 180 s in the benchmark. Either drop it or pre-warm it **and** raise `WORKER_INIT_TIMEOUT_MS`. Do not list it as supported while unmeasured. |
| Jina Reranker v3.5 GGUF | **Built** — `natively-jina-reranker`. Needs `llama-server` on PATH (see A.4). |
| Qwen3 Reranker 0.6B GGUF | **Built** — `natively-qwen3-reranker`, `QuantFactory/Qwen3-Reranker-0.6B-GGUF`. Needs `llama-server`. Note this is a different artifact from OpenRouter's `qwen3-reranker-8b`; the 0.6B is **not** on OpenRouter. |
| Ettin Reranker 150M | **Built** — `natively-ettin-reranker`, and it ships 32m/68m/150m, not just 150m. ONNX, in-process, no external binary. |

Brief #1's Phases 1–7 were largely about *producing* these. They exist. Delete that work
from the plan. What remains is the four Core items in A.3, and none of them is
model-specific.

# Part C — the revised task

Build in this order. Each stage ships independently and leaves the app working.

## Stage 1 — Document (blocking, small)

Write `docs/reranker-architecture.md` covering Part A above plus the decisions in
Part B: the single seam, the two budgets, the three-way resolution chain, why hosted
rerank is not an extension, and how a future OpenRouter rerank model is added without
touching the retrieval pipeline. `docs/extensions.md` already covers the extension half —
cross-reference it rather than restating it.

## Stage 2 — OpenRouter hosted rerank

Highest measured value, no new subsystem, no model downloads, no `llama-server`
dependency. The honest caveat: the three local extensions now exist, so "hosted first"
is no longer "hosted is the only thing that could work" — it is "hosted is the only
thing that has been *measured*, and it beat the shipping local reranker by +0.37 MRR
while clearing a budget the shipping one misses." Stage 4 is what would change that
ranking, and it cannot run until Stage 3 can load an extension.

1. `electron/rag/openrouterRerankModels.ts` — discovery via
   `GET /models?output_modalities=rerank`, unauthenticated, cached with last-known-good
   retained on failure. Mirror `openrouterEmbeddingModels.ts` exactly.
2. `OpenRouterReranker` implementing `RerankSeamPort` — port the request/response
   handling from `benchmarks/reranker-eval/lib/rerankers/openrouter.mjs`. Map results
   back by `index`, never by document text (duplicate chunks exist). Preserve every
   candidate's `id` / file path / chunk id / offsets locally; send only `text`.
3. Resolve it in `RerankerRegistry.resolvePort()` per B.6's chain.
4. Gate hard on `LLMHelper.isLocalOnly()` — local-only must never issue a rerank
   request, and the UI must say why the hosted option is unavailable.
5. Errors: 401/403, 402 credits, 404 model gone, 408, 429 (bounded backoff — the free
   Nemotron model really does 429 at 20 req/min), 5xx, malformed response. Every one
   falls back to the existing ordering. A rerank failure is never a user-visible error.
6. Settings: provider radio (Local / OpenRouter), model picker grouped by the live
   catalogue, key-configured indicator (**never the key itself, never in logs**),
   candidate count, top_n, explicit fallback toggle, Test connection. Cost from the
   response's `usage.cost`, labelled as measured-last-call, not from model metadata.
7. Latency instrumentation: report the network round trip as **"rerank request
   latency"**, never as inference time.

**Acceptance:** provider persists across restart; metadata survives reranking; local-only
issues zero requests (assert on a mocked fetch, not by inspection); the seam still has
one call site; `ModeSpeculativeRerank.test.mjs` still passes.

## Stage 3 — Close the four Core gaps so the existing extensions can run

This is the whole of the remaining local-reranker work. It is Core plumbing, not model
work, and it is smaller than either original brief implies.

1. **Implement `ModelDownloader`** against the interface at `ModelStore.ts:47` — the
   interface exists precisely so the licence gate is written once and cannot be
   bypassed. Resolve revision, honour `repoPath`, download only the declared files,
   resumable, progress, verify against `sha256` (recording it on first download where
   the manifest says `null` — an unknown hash is never a passing check), validate
   structure, then load + self-test before `ready`. A partial download is never usable.
   The Jina manifest's `requiresAcknowledgement: true` must block the download, and
   must keep blocking a file the user supplied by hand.
2. **Construct `ExtensionManager`** in app startup, with teardown on quit. Trust prompt
   listing every requested permission — and for Jina/Qwen that list includes
   `process.spawn` of `llama-server`, which the prompt must name honestly. Nothing
   enabled by default.
3. **Install path.** Implement whatever `natively extension install github:owner/repo`
   is going to be, plus remote registry fetch from `natively-extension-registry`. The
   extensions' READMEs already document this command; today it does not exist.
4. **Settings → Reranker** per B.5 — built-in + installed extensions + OpenRouter in one
   pane, with the `extensionRerankers` row. Never delete the active reranker; never
   leave the app with no working reranker.

**Wire Ettin end-to-end first.** It is ONNX, in-process, needs no external binary, and
its 32m variant is 128 MB — the shortest path to a genuinely working
download → verify → self-test → activate loop. Jina and Qwen add the `llama-server`
dependency on top of an already-proven path, and the A.4 decision about that dependency
should be made before either is offered in the UI.

## Stage 4 — Re-benchmark

Re-run `benchmarks/reranker-eval` with each new candidate, same embeddings, same pools,
same depth. Add the three extension rerankers as candidates — they exist, so this is runnable as soon as Stage 3 can load them, and it is the first real quality/latency number for any of them. Report p95 against 1200 ms
and against 10 s separately. Include the content-free-top-pick share — it discriminates
better than MRR here.

Do not commit `results/`. Paste `REPORT.md`.

---

## Standing rules (unchanged from the original briefs, still correct)

- Never bundle Jina weights, or any optional model's weights, in the installer.
- Never download without an explicit user action.
- Never silently switch reranker without telling the user.
- Never block startup or normal retrieval on an optional model.
- Everything fails closed to the existing ordering.
- Embedding provider and reranker provider stay independent.
- macOS and Windows both, per `CLAUDE.md`. `createPermissionBroker(platform)` takes the
  platform as a parameter — keep that pattern; do not add `process.platform` checks
  inside the extensions subsystem.
