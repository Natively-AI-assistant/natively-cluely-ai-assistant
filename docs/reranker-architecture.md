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

**Not verified**
- macOS only. Nothing here has been executed on Windows.
- The Jina and Qwen extensions need `llama-server` on `PATH`; it is not
  installed on this machine, so their rerank path is reviewed, not run.
- The Ettin adapter's `scoreBatch()` is a scaffold that throws
  *"ONNX tokenisation/inference is not implemented yet"*. Its `init()` loads real
  weights and succeeds; it cannot yet score. Core handles this correctly — the
  throw falls back to the existing ordering — but the extension cannot rerank
  until that method is implemented in its own repository.
- No hosted rerank has been run through the live app UI; the OpenRouter path is
  covered by unit tests against a mocked fetch plus the benchmark's real API run.
