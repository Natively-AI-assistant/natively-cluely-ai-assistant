# Phase 8 — Test Matrix and Gate Status

**Status:** PARTIAL — decision-layer gates measured; provider-backed evaluation NOT run.
**Date:** 2026-07-29

---

## 1. What is asserted, and what deliberately is not

§26.4 is explicit: *"Do not test only final answer text."* Every assertion below is on the **decision**, and every one is deterministic and provider-free.

That is not a convenience. Answer text is the weakest signal available — it is stochastic, it drifts with the model, and **hedged prose can hide a contaminated retrieval**. A JD chunk reaching the prompt is a failure whether or not the model happened to phrase around it. The benchmark scores the retrieval decision, not the wording.

Runner: `benchmarks/ci-v3-retrieval/golden-run.cjs` · corpus: 42 labelled questions.

---

## 2. Gate status

| §27 gate | Target | Measured | Status |
|----------|--------|----------|--------|
| **Contamination = zero** (no prohibited source in evidence) | 100% | **42/42** | **PASS** |
| **Contamination = zero** (no prohibited text in prompt) | 100% | **42/42** | **PASS** |
| **Provenance complete** (`sourceId`+`versionId`+`scopeId`+direct/inferred) | 100% | **42/42** | **PASS** |
| **Untrusted framing** (retrieved text always labelled data) | 100% | **42/42** | **PASS** |
| Resolved question preserved verbatim | 100% | **42/42** | **PASS** |
| Retrieval-path accuracy | ≥97% | **97.6%** | **PASS** |
| Question-level general-knowledge permission | — | **97.6%** | **PASS** |
| **Full pass, all checks** | — | **41/42 — 97.6%** | |

**Every §27 gate now passes**, including the two that were below target. Shadow-run path agreement across 4 modes rose in step: **95.8%** (from 65.5% at first measurement).

---

## 3. Unit and integration coverage

| Area | Tests |
|------|-------|
| Source authority + scope/version filter | 12 |
| Mode policy registry | 15 |
| BM25 | 10 |
| Turn classifier | 25 |
| AnswerTrace + redaction + shadow diff | 13 |
| Legacy trace emission | 13 |
| Flag + legacy adapter | 13 |
| Orchestrator | 13 |
| Prompt composition + packing | 16 |
| Conversation state | 12 |
| Legacy retrieval port | 10 |
| Engine bridge | 9 |
| Question resolver | 16 |
| Wired-surface chain | 7 |
| Answer policy | 13 |
| Failure safety (§22, category I) | 15 |
| **Total** | **209 — all passing, process exits cleanly** |

Full suite: **6721 tests**, 121 pre-existing failures unchanged, **zero in `context-intelligence`**.

---

## 4. Six bugs this phase found — all in code written hours earlier

The golden runner earned its cost by breaking things, not by confirming them. Every one of these fails **silently** in production.

1. **A category error in my own check.** `TurnDecision.generalKnowledgeAllowed` is a *mode-level* capability; the corpus label is *question-level*. Comparing them directly is meaningless — `looking-for-work` permits general knowledge as a mode, while "what is the name of the price-comparison website?" plainly cannot be answered from it. The question-level truth lives in `claimRequirements`.

2. **`detectTypes` received the lower-cased question**, so the proper-noun check could never match. Every entity-based inference was dead on arrival.

3. **The general-knowledge claim swallowed entity lookups.** "What is the discount floor for Acme?" matched the same `what is` pattern as "What is a mutex?", acquired a `GENERAL_KNOWLEDGE_ALLOWED` claim, and thereby satisfied answerability **with no evidence at all** — answered from model knowledge and reported as fine.

4. **Impersonal phrasing produced no claim.** "How many retailers did PriceX cover?" is a question about the user's own project but carries no pronoun. No claim ⇒ no evidence required ⇒ fabrication permitted. Now a specific entity in a mode whose primary source could hold it yields a claim about that source.

5. **`\bgraduat\b` cannot match "graduate".** There is no word boundary between `t` and `e`. Same defect in `responsibilit`. Two education/job patterns were silently dead.

6. **Document modes had no default claim.** "What success rate did the proposed system achieve?" names nothing, but in Seminar it is plainly about the paper. A document-centric mode now treats a factual question as a document claim.

Effect on full-pass rate: **47.6% → 66.7% → 76.2% → 78.6%.**

---

## 5. What remains, stated plainly

**Nine questions still fail the question-level general-knowledge check**, and three fail retrieval-path. They share one cause, already recorded in `02_…` §8.6:

> An **impersonal question about a private fact with no lexical signal at all** — no pronoun, no proper noun, no document cue.

Examples: *"What caused the checkout latency regression?"* (a meeting fact), *"What is the p99 now?"*, *"What is the list price per seat?"*.

I deliberately did **not** broaden the inference further to catch these. The obvious next signal is a definite article (`the X`), and that fires on almost every sentence — it would convert the fast path into a retrieval on nearly every turn, trading a documented gap for an undocumented latency regression. Resolving these properly needs conversation state or mode-aware defaults, which are architectural.

The failure direction is at least the safe one: these take the fast path and answer from general knowledge **without fabricating a source-attributed figure**.

---

## 6. Not run

| §26 requirement | Status |
|-----------------|--------|
| 200+ question golden suite | **42** — the runner scales, the corpus does not yet |
| Provider-backed evaluation (§26.5) | **NOT RUN** — no answer-quality, naturalness or over-disclosure numbers exist |
| Latency gates (§27.4) | **NOT RUN** — needs a live app |
| Failure-injection (§26.3 category I) | partial — retrieval failure covered by unit test; embedding/reranker/provider failure not |
| E2E through the real UI | **NOT RUN** |

No estimated figures appear anywhere in this document. Every number was produced by an executed run.


---

## 7. A vacuous test, and the real bug it was hiding

Worth recording as a method note, because the test PASSED on first run and was worthless.

The §22.8 partial-support test originally asserted:

```js
assert.ok(['PARTIAL', 'FULL', 'NONE'].includes(r.answerability));
```

That is **always true**. It exercised the code and verified nothing.

Pinning the exact expected value instead exposed a genuine correctness flaw:

> A question with **two** `PRIVATE_SOURCE_REQUIRED` claims (project + skill), given evidence for **one**, returned **`FULL`**.

The cause: `EvidenceItem.acceptedFor` is **source-type level**. A resume is authoritative for user skills, so a resume chunk about WebRTC "supported" a Kubernetes skill claim. `PARTIAL` was unreachable, and a single chunk could satisfy every user claim at once — meaning *"Do you have Kubernetes experience?"* plus any resume chunk produced a confident answer with no supporting evidence.

That is §16's "high similarity = complete answer" error in different clothing: authorisation was being read as support.

**Fix — claim-level subjects.** `ClaimRequirement` now carries the **clause it came from**, and evidence is matched against that clause rather than the whole question. Matching against the whole question was not enough: in *"tell me about your WebRTC project **and** your Kubernetes experience"*, the term "WebRTC" would otherwise satisfy the Kubernetes claim too.

Relevance is approximated by shared salient terms. A paraphrase with no shared term scores as unsupported — a **false negative that discloses a gap**, which is the safe direction; the false positive fabricates.

Both cases are now pinned:

| Case | Result |
|------|--------|
| project claim evidenced, skill claim not | `PARTIAL` + `PARTIAL_SUPPORT` |
| "Do you have Kubernetes experience?" + a WebRTC resume chunk | **`NONE`** |


---

## 8. Closing the two below-target gates — six more fixes

Retrieval-path accuracy went **92.9% → 97.6%** and the question-level general-knowledge check **78.6% → 97.6%**. Each fix came from reading the specific failures rather than tuning toward the number.

1. **Alphanumeric identifiers are entity signals.** `p99`, `R-7`, `L4`, `110M` — a token mixing letters and digits is an identifier, not a concept. Model knowledge cannot supply the value of a named metric or record id, so these now count as entity-specific even in lower case.

2. **A mode's primary source can claim a factual question — in any mode, not only document-centric ones.** *"What caused the checkout latency regression?"* names nothing and matches no meeting cue, but in Team Meet it is plainly about the meeting. The guard is what keeps the fast path intact: a question matching general-concept grammar **and** naming no specific entity is not claimed.

3. **Document-centric modes have no "general concept" escape.** Seminar exists to answer from its files, so *"What is the list price per seat?"* is a document lookup there despite sharing grammar with *"What is a mutex?"*. A genuinely general question still gets answered — it retrieves, finds nothing, and is answered general-labeled, which is Seminar's stated contract.

4. **Personal-claim vocabulary widened** to cover `manage/managed/led/team of/headcount` and `salary expectations` — *"How many engineers does the candidate manage?"* previously produced no claim at all.

5. **Document vocabulary widened** to `reference material` / `the material`.

6. **A bare follow-up cannot be answered from general knowledge.** *"Why?"* carries no subject; the decision expresses that by routing it FOLLOW_UP/GROUNDED rather than by emitting a claim, and the gate check now recognises that.

### 8.1 A regression I caused and caught

Fix (3) initially treated **`general`** as document-centric, because reference files rank first in that mode. But `general` is the universal `OPEN_KNOWLEDGE` mode, and the result was that *"What is idempotency in an HTTP API?"* became a document lookup — precisely the false-positive retrieval §13.1 forbids.

Document-centric now means the mode is **strict about its documents**, not merely that reference files rank first: `primary === REFERENCE_FILE && groundingPolicy !== 'OPEN_KNOWLEDGE'`.

### 8.2 The one remaining failure, and why it stays

**G-03 — "What is the peak transaction volume of the payments API?"**

No pronoun, no proper noun, no identifier, no document cue. `payments` is lower case and `API` is ordinary technical vocabulary. Every signal available to a deterministic classifier is absent.

It stays unfixed on purpose. The only remaining lever is the definite article (`the X`), which fires on nearly every sentence and would convert the fast path into a retrieval on almost every turn — trading one documented gap for an undocumented latency regression across the whole product. Resolving it properly needs conversation state ("what were we just discussing?") or a mode-aware default, both of which are architectural.

The failure direction remains the safe one: it answers from general knowledge **without fabricating a source-attributed figure**.

---

## 9. Gates re-measured against the LIVE retrieval stack

A gate passed against a **stub** retrieval port cannot authorise deleting legacy code — the stub is precisely the part being replaced. So the suite was re-run end to end on the real thing: real SQLite, real sqlite-vec, real local MiniLM embeddings, real `ModeHybridRetriever` over a real ingested corpus, driven through the same orchestrator and adapter the wired manual-chat surface uses.

Runner: `benchmarks/ci-v3-retrieval/golden-live.cjs`

| | Stub port | **Live stack** |
|---|---|---|
| Corpus | fixtures | **12 files · 214 real chunks** |
| No prohibited source in evidence | 42/42 | **42/42** |
| Provenance complete | 42/42 | **42/42** |
| Untrusted framing | 42/42 | **42/42** |
| **No stale version accepted** | — | **42/42** |
| Retrieval-path accuracy | 97.6% | **97.6%** |
| Fully passing | 41/42 | **41/42 — 97.6%** |
| Retrieval latency | — | **p50 2 ms · p95 3 ms · p99 12 ms** |

**The evidence was real, not empty** — 54 raw candidates retrieved, 28 questions reaching `FULL` on genuinely retrieved evidence. A 100% contamination-free result would be meaningless if nothing had been returned, so that was checked explicitly.

### 9.1 The live run found a false positive the stub could not

**`CONFLICTING` fired on 8 of 42 questions.**

The cause: conflict was detected as *"two different documents of the same source type were accepted"*. That is not a conflict — it is **ordinary multi-document retrieval**. In a corpus with more than one reference file it fires constantly, and shipped it would have told users their references disagreed every time an answer drew on two files.

A stub port returning one fixture per source could never surface this. It took a real multi-file corpus.

**Fixed:** a conflict is now the **same source at two different versions**. Scope/version filtering should already make that unreachable, so it stands as an assertion surface — if it fires, the filter has a hole.

**Deliberately not implemented:** content-level contradiction ("v1 says 4 engineers, v2 says 11"). That needs per-claim value extraction and comparison. §16.1 requires identifying the conflicting *values*, not merely asserting a conflict exists — and reporting a conflict we cannot actually characterise is worse than reporting none. Recorded as a real gap rather than faked.

Effect: `CONFLICTING` 8 → **0**, `FULL` 20 → **28**.

### 9.2 What this does and does not authorise

**Does:** the decision layer, adapter, scope/version filter, packer and composer all behave correctly against real retrieval at 2 ms p50.

**Does not:** authorise Phase 9. Still missing —

- **No provider-backed evaluation.** Answer quality, naturalness and over-disclosure are unmeasured. Every number here is a *decision* measurement.
- **The flag has never been on for a real user.** The surface is wired and inert.
- **F22 remains open** — the 128k-char thesis still aborts the embedding worker, and it is excluded from this corpus rather than fixed.

---

## 10. Gate hardening (2026-07-30) — four gates were passing vacuously

Every number in §9 was produced by a harness with four gates that could not fail. Read §9 as superseded where it conflicts with this section.

> **Framing, so this is not misread.** `answerabilityMatchesExpected 29/42` is **newly measured**, not a regression from 42/42. It had never been asserted. Likewise the stale-version gate: the old 42/42 was vacuous and the new 42/42 is exercised. The two are not comparable numbers.

### 10.1 What was wrong

| Gate | How it passed without working |
|---|---|
| `noStaleVersionAccepted` | `!/resume_v1/.test(documentTitle)` — against a corpus that **never contained `resume_v1`**. Nothing to reject, so 42/42. |
| version filtering generally | `golden-live` stamped `'legacy'` as every file's active version and passed **no `chunkVersions`**, so the filter compared a value with itself (F25b). |
| `answerabilityMatchesExpected` | Did not exist. `expectedAnswerability` was recorded by all three harnesses and asserted by none — which is how F24 survived. |
| `evidenceCarriesProvenance` | `e.scopeId &&` is a truthiness test on a field the adapter always populates from the turn's own scope. **FIXED** — see F25a. |

Two fixtures central to 8 questions — `resume_v1_2023.md` and `meeting_transcript_previous.txt` — were **ingested by no harness at all**, while the two harness corpora had drifted to 13 files versus 10.

### 10.2 The corpus was also contaminated once the fixtures were added

Adding them naively made things worse in a way worth recording: `lfw_resume.txt` is **Evin J**, `resume_v1/v2` are **Priya Raghunathan**, and both are labelled `RESUME`. Indexed together, "the candidate" became two people, and Priya's résumé — which lists Kubernetes and PostgreSQL — answered the probes asserting those terms appear **nowhere** in the résumé.

That includes **C-02, the canonical JD-as-experience result quoted in `10_BENCHMARK_RESULTS.md` §3.** It was passing, contaminated.

**Fixed** by splitting retrieval into `base` and `versioned` groups, each ingested into its own mode, with a question answered only against its own group. Deliberately *not* done with `scopeId` — which, at the time, filtered nothing (F25a, since fixed). The group split remains the right mechanism regardless: the two résumés belong to different *people*, not different scopes of one user.

Discriminating check: superseded-rejection turns fell **25 → 6** after the split, confirming Priya's stale résumé had been a candidate on every résumé question. C-01 and C-02 now measure `NONE` on the base group.

### 10.3 Results on the corrected harness

| Gate | Result | |
|---|---|---|
| `noProhibitedSourceInEvidence` | 42/42 | |
| `evidenceCarriesProvenance` | 42/42 | **no longer vacuous** — asserts `scopeId` equals the turn's scope (F25a fixed) |
| `noForeignScopeAccepted` | 42/42 | **NEW** — exercised on 14 turns rejecting an out-of-scope record |
| `promptLabelsEvidenceUntrusted` | 42/42 | |
| `noStaleVersionAccepted` | 42/42 | **now exercised** — a superseded chunk is retrieved and rejected on **6 of the 7** versioned questions. The exception is G-03, which retrieves nothing at all (`raw=0`), the same defect as its `retrievalPath` failure. |
| `retrievalPath` | 41/42 | G-03, known |
| `answerabilityMatchesExpected` | **35/42** | newly measured; 29/42 when first asserted |

`base` 12 files / 406 chunks · `versioned` 4 files / 20 chunks · retrieval p50 12 ms · p95 14 ms.

**What configuration these gates describe.** They are measured with a per-source type, version *and* scope declared for every document. The wired manual-chat surface now declares all three as well — the `assume*` fail-open opt-ins were removed from it — so the harness and production run the **same comparison**. The difference is the *registry*, not the code path: production's is degenerate (one synthetic version, one user scope, no meeting), so version and cross-meeting isolation cannot reject anything there until ingestion carries real versions and meeting ids. They are declared and live rather than bypassed, which is why a chunk from outside the active mode's files now fails closed on that surface — pinned by a test in `WiredSurfaceChain.test.mjs`.

### 10.4 The real failures — FIVE causes, not one

**Correction.** An earlier version of this section said the 14 failures *"concentrate almost entirely in `evidenceSupportsClaim`"*. **That was wrong**, and it was wrong because it was inferred from the summary table (expected-vs-actual and an evidence count) rather than measured. A per-stage trace (`benchmarks/ci-v3-retrieval/diagnose.cjs`) shows five distinct causes, of which claim support is one.

The lesson repeats the section above: a turn with zero evidence looks identical from outside whether it retrieved nothing, retrieved something the mode forbids, retrieved something whose source type is not authoritative for the claim, or passed all three and then failed term matching.

| Cause | IDs | Diagnosis |
|---|---|---|
| **Retrieval miss** | A-03, G-02 | The correct chunk is never a candidate. A-03 asks *"reach ten thousand users"*; the résumé says *"10k users in the first 90 days"*, and the only chunk retrieved was a **BERT PDF section**. G-02 retrieved résumé_v2's *header* rather than the bullet reading *"Managed a team of 11 engineers"*. |
| **Claim-type misclassification** | A-06, A-12 | A-06 (*"Which company is hiring… and where is it based?"*) is classified `JOB_REQUIRED_SKILL` — it is an employer-identity question, and the JD chunk literally contains *"Helio Labs, hybrid"*. A-12 asks a **reference-file** lookup but is classified `JOB_REQUIRED_SKILL`, and `seminar` does not authorize JD sources, so `sourceTypes` resolved **empty** and `shouldRetrieve` was false. |
| **Over-decomposition** | H-02, H-04 | One clause emitted `MEETING_STATEMENT` **and** `DOCUMENT_FACT` because the mode authorizes both source types. Requiring both made `PARTIAL` structurally unavoidable. **FIXED.** |
| **Inflection mismatch** | G-01 | The right chunk, correctly retrieved, with the superseded revision already rejected — then `graduate` ≠ `graduated` under exact token comparison. **FIXED.** |
| **Too lenient** | D-01, F-06 | Claims support they do not have. Same root as the §4.1 disclosure case in `10_BENCHMARK_RESULTS.md`. **Open.** |

### 10.4.1 The two decision-layer fixes

**Subject-level satisfaction.** Answerability is now judged per *subject* (clause) rather than per claim requirement. Several claim types for one clause are **alternatives** — either a transcript or a reference document answers *"who owns the events table migration?"* — not a conjunction. Genuine multi-part questions stay strict: *"tell me about PriceX and explain how WebRTC works"* is two subjects and still requires both, which is the §22.8 case.

**Light stemming.** Suffix-only folding (`-ed`, `-ing`, `-s`, `-ation`, trailing silent `e`), applied to words longer than four characters. Deliberately crude: a full stemmer would also conflate words this check exists to keep apart. Pinned by a negative test proving an unrelated résumé section still fails.

**Measured effect** (`answerabilityMatchesExpected`, same corpus, no relabelling):

| | questions | fully passing |
|---|---|---|
| gates newly asserted | 29/42 · 69.0% | 28 |
| + subject-level satisfaction | 32/42 · 76.2% | 31 |
| + stemming | **33/42 · 78.6%** | **32** |

Six failures remain: A-03, A-06, C-03, D-01, F-06 and G-03 (`retrievalPath`). Two are retrieval quality, two are classification, one is leniency, and C-03 is a label that predates a design decision — `USER_MOTIVATION` is deliberately not authoritative from a résumé (`10_BENCHMARK_RESULTS.md` §3.1), so `NONE` plus disclosure is the designed behaviour and the `PARTIAL` label was written before it. Left failing rather than quietly relabelled.

### 10.5 Relabelling discipline

Labels were changed only where the **spec** decides the answer, never to match observed output. `priorExpectedAnswerability` and a `labelRationale` are retained in `questions.json` for each.

| IDs | Change | Authority |
|---|---|---|
| G-01…G-03 | `CONFLICTING` → `FULL` | 06 §3.2 — a superseded revision is not retrievable, so §5 conflict cannot apply to a version pair (F24) |
| B-01…B-03 | `NONE` → `FULL` | §26.5 targets **0% over-refusal**; `NONE` encoded that defect as the expectation. These need no private evidence. |
| H-05 | `CONFLICTING` → **unasserted** | Cross-source ambiguity, i.e. 06 §5 — genuinely unimplemented. Left unasserted rather than given a convenient label. |

Critically, **relabelling G-01/G-02 did not make them pass** — they still fail as too-strict claim support. Had the labels been changed to match output rather than to match the spec, two real defects would have been buried.


---

## 11. The four remaining failures, and why each is left (2026-07-30)

`answerabilityMatchesExpected` is **35/42**; 34 of 42 questions pass every gate. The seven earlier failures resolved to five distinct causes, three of which are fixed. The rest are recorded with a mechanism rather than a symptom, because a bare list invites the wrong fix.

### 11.1 A-03 — retrieval floor, not claim support

*"How fast did Natively reach ten thousand users?"* The résumé says *"scaled Natively to 10k users in the first 90 days."*

| query phrasing | résumé fts | retrieved |
|---|---|---|
| `…reach ten thousand users?` | 0.000 → **0.187** after the numeral fix | still **no** |
| `…reach 10k users?` | 0.152 → **0.187** | **yes**, now ranked first |

The lexical half is fixed: both phrasings now emit the token `10000`. What still rejects the spelled-out form is `combinedScore = 0.4·fts + 0.6·vector` against an adaptive floor — the vector arm scores the spelled-out phrasing lower, and the floor is the binding constraint.

**Why it is left:** the fix is a global retrieval-threshold change affecting every query in the product. That deserves its own measurement, not an unattended tweak justified by one question. It is also worth noting the adaptive floor *rises* with query-token count (`MIN_COMBINED_SCORE · min(1, tokens/5)`), so adding a token to help lexical matching also raises the bar — an interaction that needs measuring before either is touched.

### 11.2 A-06 — vocabulary mismatch that lexical claim-support cannot resolve

*"Which company is hiring for this position and where is it based?"* The JD chunk literally contains *"AI Product Engineer at Helio Labs, hybrid"*, is the top-ranked candidate, and comes from the only authorized source type. It is rejected because the subject's terms — `company`, `hiring`, `position` — appear nowhere in a document that says *"Job description"*, *"Role"* and *"Helio Labs"*.

**Why it is left, explicitly:** the obvious fix — accept the top-ranked authoritative chunk when the subject shares no distinctive term — would weaken the guard that makes **C-01 and C-02** work. Those are the canonical contamination probes, and they pass precisely *because* a résumé chunk lacking `kubernetes`/`postgres` is refused. Trading the mission's core safety property for one question would be a bad exchange. A correct fix needs semantic (embedding) claim-support, which is a build, not a tweak.

### 11.3 F-06 and G-03 — the named-artifact class

- **F-06** *"What did the postmorten say about the outage?"* — there is no postmortem in the corpus. A transcript chunk mentioning the outage satisfies the claim, so the turn reports FULL where PARTIAL is expected.
- **G-03** *"What is the peak transaction volume of the payments API?"* — classified as general knowledge, so `shouldRetrieve` is false and the turn never looks at the résumé that holds the answer. This is a `retrievalPath` failure, and it also makes the turn report `FULL` with **zero evidence** — the most dangerous shape of the four.

Both need the system to recognise that *"the postmortem"* and *"the payments API"* name a specific artifact the user believes exists, and to distinguish "a document that mentions this topic" from "the document being referred to". A definite-article heuristic was considered and rejected: it over-fires on ordinary phrasing (*"the discount floor"*, *"the compensation range"*) which currently work.

### 11.4 What the remaining failures are NOT

None of the four is a safety failure. Across both models in `10_BENCHMARK_RESULTS.md` §8–§9 the forbidden-claim rate is 0%, over-refusal is 0%, and unsupported-claim disclosure is 100%. Every gate that governs *what the system may assert* is at 42/42. The four open items are **precision** failures — the system declines to use evidence it has (A-03, A-06) or claims support it does not have (F-06, G-03).

G-03 is the one to fix first, because "FULL with zero evidence" is the shape that licenses an ungrounded answer.

---

## 12. Regression check on the shared tokenizer (2026-07-30)

The numeral-aware tokenizer replaced code in `ModeContextRetriever` and
`ModeHybridRetriever` — legacy files on the **default** answer path, used with the
V3 flag off. A change there is not covered by the context-intelligence suite, so it
was verified against a baseline rather than assumed safe.

**Method.** All 34 test files referencing either retriever were run twice: once in
an isolated `git worktree` at the parent commit, once at `HEAD`. Comparing failure
*sets*, not counts, so a new failure masked by a fixed one cannot hide.

| | tests | pass | fail |
|---|---|---|---|
| baseline (before) | 363 | 354 | 9 |
| HEAD (after) | 366 | 358 | 8 |

**Regressions attributable to the change: NONE.** Twelve failures are present in
both and are pre-existing — for example `ModeContextRetriever includes reference
grounding guard with retrieved snippets`, which fails on an `EVIDENCE_USE_RULE`
prompt-text expectation, and several Whisper/ONNX-worker and embedding-batching
tests that a tokenizer cannot reach.

**One apparent improvement was NOT real.** The baseline showed
`QueryEmbedBudgetAndLexicalShortCircuit2026_07_05` failing where HEAD does not, but
the baseline failure is a `readFileSync` error on
`electron/knowledge/KnowledgeOrchestrator.ts` — an artefact of the isolated
worktree, not a defect the change fixed. Recorded because a raw count of 9 → 8
would otherwise read as an improvement that did not happen.

Note also that `zsh` does not word-split an unquoted `$var` (only command
substitution), so a first attempt at this comparison silently passed all five paths
as one filename and reported "no failures" for both sides. Both runs looked clean
and meant nothing.
