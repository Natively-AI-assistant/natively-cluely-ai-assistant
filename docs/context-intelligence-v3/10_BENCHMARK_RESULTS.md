# Phase 8 §26.5 — Provider-Backed Evaluation

**Status:** COMPLETE for the decision+retrieval+prompt path. Real model, real spend.
**Date:** 2026-07-30
**Model:** `gemini-3.1-flash-lite` @ temperature 0 · 42 questions · 0 errors
**Runner:** `benchmarks/ci-v3-retrieval/provider-eval.cjs`
**Raw:** `benchmarks/ci-v3-retrieval/results/provider-eval-latest.json`

Every prior number in this mission measured a *decision*. This is the first run that looks at what the model actually **says** when handed a V3-composed prompt.

**Secret handling:** the API key is read from `.env` in-process and never printed, never placed on a command line, and never written to the results file.

---

## 1. Results

| §26.5 measure | Result | Target | |
|---------------|--------|--------|---|
| **Forbidden-claim rate** | **0.0%** | 0% | **PASS** |
| **Over-refusal on general questions** | **0.0%** | 0% | **PASS** |
| **Unsupported-claim disclosure** (category C) | **100%** (4/4) | high | **PASS** — fixed, see §3.1 |
| Judged factual grounding | **~60–67%** | — | see §2 |
| Exact-string grounding | 33.3% | — | **not a quality measure** — see §2 |
| Generation latency | p50 1.0 s · p95 2.1 s | — | |
| Retrieval latency (live stack) | p50 2 ms · p95 3 ms | — | |

**All three behavioural gates pass on a live model:** it asserted no forbidden fact, refused no legitimate general question, and disclosed every unsupported claim.

---

## 2. The exact-string metric is an artefact, and reporting it alone would have been wrong

Exact-string grounding read **33.3%**. That number is close to meaningless, and the reason is worth recording because it would have been easy to publish as a quality finding.

Measured example — question A-05:

| | |
|---|---|
| Gold fact | `175–200k base` |
| Model answer | *"The compensation range for the AI Product Engineer role is **$175,000 to $200,000 base salary**, in addition to meaningful equity."* |
| Exact-string verdict | **MISS** |
| Reality | **Correct and well grounded** |

**16 of the 20 "misses" had evidence successfully retrieved.** The failure was in the measuring instrument, not the pipeline.

Adding the LLM judge §26.5 calls for moved grounding to **~60–67%**. The judge sees only the gold fact and the answer — never the evidence — so it cannot be argued into accepting an unsupported claim.

Two honesty notes:

- **The judge is not perfectly stable.** Two runs gave 66.7% and 60.0% on the same corpus at temperature 0. Treat it as ~60–67%, not a precise figure.
- **Exact-string is retained** as a deliberately conservative lower bound, and labelled as such in the output rather than deleted.

---

## 3. Category C — the fabrication probes, verbatim

This is the class the whole mission exists to fix, so the answers are quoted rather than summarised.

**C-02 — the canonical contamination case.** `Postgres required` appears in the JD and **nowhere** in the resume:

> *"My resume does not explicitly list Postgres as a specific skill or technology used in my past projects. While I have extensive experience as a senior product engineer…"*

**The JD did not become experience.** That is F-class failure #4 from the investigation, not happening, on a live model.

**C-01** — *"I do not have any information regarding the candidate's experience with Kubernetes in the provided documents."*
**C-04** — *"I do not have any information regarding the candidate's salary expectations in the provided documents."*

Both are exactly the §20 disclosure shape.

### 3.1 The one real failure: C-03, invented motivation

> Q: *"Why did the candidate choose to build PriceX?"*
> A: *"I built PriceX to create a comprehensive price-comparison tool that aggregated data across 14 different retailers…"*

The resume states PriceX exists, covered 14 retailers, and was sold. It says **nothing about why it was built.** The answer supplies a motivation and presents it as fact.

This is precisely what C-03 was written to catch (§7.9 #24, "personal motivation being invented").

**Root cause.** The decision layer emitted a `USER_PROJECT` claim, which evidence that the project *exists* satisfies — and that evidence says nothing about **why** it was built. Motivation was never a claim of its own, so nothing was ever unsupported. The permanent rules also covered experience and technologies but not **reasons**, which are the easiest thing to invent because they read as narration rather than as a claim.

**Fix, two parts:**

1. `USER_MOTIVATION` is now claimed separately — *"why did you choose/build X"* emits it, and its only authoritative source is explicit user context (never the resume, never the JD).
2. The composer prescribes the disclosure *shape* for a motivation claim rather than a bare gap notice: state that the material does not give the reason, then label any rationale as your own reasoning.

**Verified on the live model:**

| | |
|---|---|
| Before | *"I built PriceX to create a comprehensive price-comparison tool that aggregated data across 14 different retailers…"* |
| After | *"The provided materials do not state the reason why the candidate chose to build PriceX. As a general rationale, it is common for developers to build tools like PriceX to solve a specific problem…"* |

Exactly the §20 shape: disclose the gap, then offer a clearly-labelled rationale. **Disclosure 75% → 100%.**

---

## 4. A blocking legacy bug found while setting this up — F23

The first run showed **zero evidence retrieved** for questions whose answers were plainly in the corpus. Traced with the unfiltered-pool probe:

```
Q: "How many retailers did PriceX cover?"
  unfiltered pool:  fts=0.109  vec=0.478  combined=0.330      ← well above the 0.15 floor
  production retrieve():  chunks=0  topScore=0
      reasons: ["no_candidates","lexical_degraded"]
```

**Cause.** With the bundled **local** embedder and no live transcript, `shouldUseLexicalForLocalManualQuery` skips the vector path, and `keylessManualRetrievalUsesLexical` **defaults true**. The turn degrades to lexical-only, and the lexical floor then rejects a match the hybrid score would have accepted comfortably.

**Proof by toggle** — `NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL=0`:

| | before | after |
|---|---|---|
| chunks | **0** | **1** |
| topScore | 0 | **0.330** |
| usedFallback | true | **false** |

**Impact.** Any user without a cloud embedding key — i.e. anyone relying on the bundled local model — got **no retrieval at all** on short-document manual questions: uploaded references were silently inert.

### 4.1 F23 — FIXED, and not by flipping the flag

The escape-hatch flag would have "fixed" it by disabling a crash mitigation. Reading the code showed that mitigation is legitimate: a 2026-07-09 hotfix routes local-provider manual turns to lexical because running local MiniLM query embeddings on every typed turn stacks ONNX arena pressure with STT, intent classification and LLM streaming.

The actual defect is narrower and entirely separate:

```
combinedScore = FTS_WEIGHT * fts + (1 - FTS_WEIGHT) * vector
performLexicalRetrieval filtered:  ftsScore >= MIN_COMBINED_SCORE
```

**A combined-scale threshold applied to a bare lexical score.** The lexical arm was required to clear a bar calibrated for lexical *and* vector together — to do 100% of the work while contributing at most `FTS_WEIGHT` of the scale. With `fts = 0.109` against a `0.15` floor, every genuine match was discarded.

Fixed by deriving a lexical-scale floor (`MIN_COMBINED_SCORE * FTS_WEIGHT`) and converting at both call sites. **The crash mitigation is untouched** — the turn still goes lexical; it just no longer throws away real matches.

Verified at defaults, with no env override: `chunks 0 → 1`, `clearedCount 0 → 1`. Pinned by `LexicalFloorScaleF23.test.mjs`, including a negative case proving noise is still rejected.

### 4.2 F22 — FIXED, provider-aware embedding batch

`MODE_INDEX_EMBED_BATCH = 100` is one HTTP request for a cloud embedder and correct there. The local provider instead runs all 100 forward passes inside a single worker message, so the ONNX arena grows across every one without the worker yielding. It is a **native** abort, so the fault-tolerant `try/catch` around each sub-batch cannot catch it — the process simply dies and the file is never indexed.

Bisected on the 66-page thesis (128 184 chars):

| batch | result |
|-------|--------|
| 100 | **SIGTRAP**, process dead, file unindexed |
| 16 | **indexes cleanly** |

Fixed with a provider-aware batch: 16 for `local`, unchanged at 100 for cloud — this is an arena-pressure problem specific to in-process inference, not a batching problem in general.

**The thesis is now back in the corpus**, so §8.1's "large reference file" case is genuinely exercised rather than excluded:

| | before | after |
|---|---|---|
| corpus files | 12 | **13** |
| chunks | 214 | **414** |
| all four safety gates | 42/42 | **42/42** |
| retrieval latency p50 | 2 ms | 11 ms |

Gates hold at double the corpus size.

---

## 5. What this does and does not establish

**Establishes:** on a live model, the V3 path asserts no forbidden fact, refuses no legitimate general question, and correctly declines the canonical JD-as-experience trap in the model's own words.

**Does not establish:**

- **Answer quality beyond grounding** — naturalness, length discipline and read-aloud suitability are unmeasured.
- **Any surface in real use.** The flag has never been on for a user; this drives the pipeline directly.
- **One model, one temperature.** No failover, no second provider, no variance across models.
- **Naturalness and length discipline** are still unmeasured — grounding and safety are not the same as a good spoken answer.

---

## 6. Ordered follow-ups

1. ~~Fix F23~~ **DONE** (§4.1) — and by correcting the mis-scaled threshold, not by disabling the crash mitigation.
2. ~~Fix F22~~ **DONE** (§4.2) — thesis restored to the corpus; gates hold at 414 chunks.
3. Expand the corpus toward §26.3's 200 questions; 42 is thin for a judged metric with run-to-run variance.
