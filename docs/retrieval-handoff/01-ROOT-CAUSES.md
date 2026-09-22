# Root causes — why reference files don't ground answers

**Date:** 2026-08-28 · All `file:line` against the working tree at that date. Companion docs: `02-WTA-VS-MANUAL.md` (live-audio pipeline), `03-FIX-PLAN.md`, `04-EXPERIMENTS.md`.

Ordered by the **pipeline stage** where the turn dies, because that is what determines which fix applies. A turn that dies at stage A cannot be rescued by any fix at stage B, C or D — this is the single most important thing to internalise before writing code.

| Stage | What fails | Causes | Fixable by chunking/embeddings? |
|---|---|---|---|
| **A. Planning** | the file is never queried | RC1, RC2, RC3, RC4 | **No** |
| **B. Admission** | it is queried, then discarded | RC5, RC6 | **No** |
| **C. Delivery** | admitted, then crowded out | RC7, RC8 | Partly |
| **D. Ranking** | delivered, but the wrong chunk wins | RC9–RC12 | **Yes** — this is the original chunking work |

Verification legend: **Executed** = ran the real production modules. **Read** = traced in source. **Reported** = from the code-review agent, not independently re-checked.

---

# Stage A — the reference file is never queried

## RC1 — Any second-person question makes the file unreachable, in all 9 modes ⚠️ MASTER CAUSE
**Executed.** `experiments/mode-audit/perfect-retrieval-proof.ts`

`PERSONAL_RE` (`turn-classifier.ts:96`) matches bare `your`, `you have`, `have you`, `did you`, `do you`, `my`, `the candidate`, `candidate'?s?`. Any match makes the turn a `USER_*` claim — and `REFERENCE_FILE` is authoritative for **no** `USER_*` claim (`source-authority-policy.ts:37-45`). The turn therefore plans identity pools (résumé/JD/profile) and the file is never in scope.

Two exit routes, both fatal:
- **`NO_RETRIEVAL`** — in modes with no identity pools (general, sales, team-meet, lecture, seminar, call-center) the claim's sources intersect the allowlist to empty, `shouldRetrieve` is false, nothing is queried (`turn-classifier.ts:1100-1113`).
- **`PLANNED_TYPE_FILTER`** — in modes with identity pools (looking-for-work, recruiting) the plan targets RESUME/JD/PROFILE_FACT and chunks are dropped before scoring (`legacy-retrieval-port.ts:143`).

**In an interview, every question is second person.** Measured: **0/6** realistic interviewer phrasings reach the file in *any* mode; 3/3 neutral document-shaped lookups reach it in all 9.

### Proof with perfect retrieval

An injected retriever always returns a chunk *literally containing the answer* at score 0.99, through the real `createModeRetrievalPort` → `createLegacyRetrievalPort` → `orchestrate()` chain. **9/9 modes discard it** for all three second-person phrasings. Real `[V3]` telemetry, same file, same chunk, only phrasing differs:

```
Q: How did you handle retries on Orbit Bridge?
   intent=[PERSONAL_EXPERIENCE]              planned=[RESUME]
   retrieval=[{candidates:1, admitted:1, rejected:0}] -> evidence=0  answerability=NONE  fallback=DOCUMENT_FACT_NOT_FOUND

Q: What is the retry policy on the Orbit Bridge project?
   intent=[PERSONAL_PROJECT, DOCUMENT_FACT]  planned=[RESUME, PROJECT_FILE, CODING_SAMPLE]
   retrieval=[{candidates:1, admitted:1, rejected:0}] -> evidence=1  answerability=FULL   fallback=NONE
```

`answerability=NONE` + `DOCUMENT_FACT_NOT_FOUND` is exactly what surfaces as *"I don't have enough verified detail."*

### What it explains
- **Symptom 1 and its intermittency** — document-phrased questions work, second-person ones never do. Same file, same mode, same session.
- **The typed-vs-live-audio asymmetry** — typed questions are naturally document-shaped ("what's the idempotency key format"); a spoken interviewer uses second person. This is a better explanation than ASR noise (see RC11).
- **Symptom 3 — why duplicating facts into the 8k Real-time Prompt worked.** That prompt is injected unconditionally and never passes claim authority. The workaround succeeded *because it bypassed this gate.*

### It is a policy decision, not an oversight
Routing "personal experience" to the résumé is deliberate. The defect is that it assumes a user's experience lives in their **résumé**, while the product separately invites them to upload **reference files** — then makes those files unreachable for every question about their own work. Deciding whether a user's own reference file may evidence a `USER_*` claim is a product call. See `03-FIX-PLAN.md` Task 1.

### Reachability by mode (8 realistic interview questions)
| mode | reachable | mode | reachable |
|---|---|---|---|
| general, sales, recruiting, team-meet | **2/8** | lecture, seminar, call-center | **2/8** |
| looking-for-work | **2/8** | **technical-interview** | **4/8** |

**Technical Interview scores highest** — because of the quirk in RC4: with no `REFERENCE_FILE` in its allowlist, `sourceTypeForFile` falls through to `PROJECT_FILE` (`mode-retrieval-port.ts:120-124`), which *is* authoritative for `USER_PROJECT`. The mode that looks uniquely broken on the grounding axis is the only one admitting project evidence on identity questions.

---

## RC2 — Bare generic tokens in classifier regexes misroute whole turns
**Executed.** `experiments/mode-audit/collision-sweep.ts` — 106 terms × 2 templates × 9 modes.

Exactly three tokens collide. The fix is bounded.

**`sync` / `standup`** — `MEETING_EVENT_RE` (`turn-classifier.ts:200`) matches them as bare words with no meeting-context gate. Tested per clause at `:672`; the attribution half beside it *is* gated (`meetingMode &&`), this half is not. Also suppresses the reference-file alternative at `:701`.

| | neutral project name | with "Sync" in the name |
|---|---|---|
| 7 modes | `DOCUMENT_FACT` → plans REFERENCE_FILE | `MEETING_STATEMENT` → plans **MEETING_TRANSCRIPT only** → file dropped |
| looking-for-work, technical-interview | plans the file | mode doesn't authorize transcripts → **`shouldRetrieve=false`, nothing retrieved** |

Every natural phrasing trips it: *"How did the sync handle retries?"*, *"What happens when the sync fails?"*, *"How often does it sync?"* (`"syncing"` fails differently — `sync\b` doesn't match, so it becomes `GENERAL_TECHNICAL` with `shouldRetrieve=false`.)

**`candidate`** — in `PERSONAL_RE` (`:96`) as `the candidate|candidate'?s?`. Kills ordinary ML/search/database vocabulary: *"candidate generation"*, *"candidate set size"*, *"candidate key"* all become identity questions with `retrieve=false`. "Candidate generation" is a classic system-design interview topic.

**Relevance to the report:** the tester's project is a field-service ↔ **CRM sync**. If his file or spoken questions use the word — overwhelmingly likely — every question about it is routed to a transcript pool his file is not in. **Not yet confirmed for his case**; he never wrote "sync". `grep -i '\bsync\b\|\bstandup\b'` over his sanitized pack is the cheapest high-value check to run first.

---

## RC3 — Bare follow-ups lose their own subject's pool
**Executed.** Review finding #5.

The unclaimed-retrieval fallback (`orchestrator.ts:174`) hardcodes document pools, deliberately excluding identity pools ("Reverse a linked list" must not retrieve résumés). But it also catches **every bare follow-up** — the one case where claims are empty *because the subject lives in the previous turn*:

```
looking-for-work  "Why? (referring to: Kubernetes)"  → planned=[REFERENCE_FILE]                    (résumé/profile excluded)
recruiting        "Why? (referring to: Kubernetes)"  → planned=[REFERENCE_FILE,MEETING_TRANSCRIPT] (CANDIDATE_FILE — priority-1 — excluded)
```

A **second, independent cause of symptom 2**: even when the referent resolves correctly, the plan can exclude the pool that owns the subject.

---

## RC4 — Mode contract inversion: Technical Interview never document-grounds
**Read**, mechanism verified by execution.

`defaultSourceContractForNewMode` seeds `technical-interview` and `looking-for-work` as `sourceAuthority: 'profile_only'`; every other template gets `reference_files_primary` (`modeSourceContract.ts:245-260`). `documentGroundedFromContract` returns true only for `reference_files_*` (`:733-738`), so `forceDocumentGrounding` is **false** and everything gated on it is skipped (`WhatToAnswerLLM.ts:433-449`):

- **Half the window** — `DEFAULT_TOP_K=6` / `DEFAULT_TOKEN_BUDGET=1800` instead of 12/3600 (`ModeHybridRetriever.ts:103-104`, `:1070-1077`)
- **No per-file floor** — `guaranteePerFile` requires `forceDocumentGrounding && files.length > 1` (`:1409`)
- **No answerability scoring, section-target restore, positional restore, identity block** — all inside `if (forceDocumentGrounding)` (`:1188-1230`, `:1233-1290`, `:1423-1445`)
- **No query normalization** (`:1092-1094`)

Additional consequences (**Reported**, review #6): `shouldOfferAnswerPolicyControl` (`answer-policy.ts:125`) tests `REFERENCE_FILE` membership, so **the "Only answer from references" control is hidden in Technical Interview**; and `primarySrc` sorting to RESUME makes `documentCentricMode` false on both clauses (`turn-classifier.ts:471-478`), disabling document-lookup routing.

> **Correction (2026-08-28).** An earlier draft claimed this path also collapses to **one chunk per file** via per-FILE dedup. **False.** `dedupeGroupKey` keys by `sourceId#chunkIndex` — exact-duplicate suppression only — for **every caller since 2026-07-31** (`ModeHybridRetriever.ts:1900-1929`); the `forceDocumentGrounding` param on `deduplicateChunks` is vestigial. The comment at `mode-retrieval-port.ts:216-226` still describes the old behaviour and is **stale** — it is what caused the error. The conclusion survives on the four gated behaviours above; the "1 chunk vs 12" magnitude does not.

---

# Stage B — queried, then discarded

## RC5 — `combineRetrievalPorts` destroys the per-port slot guarantees
**Read.** Review finding #3. `meeting-retrieval-port.ts:189`

It merges each port's already-capped output, then `evidence.sort((a,b) => b.finalScore - a.finalScore)` and `.slice(0, max)`. That discards everything the per-port ACCEPTED-SLICE FILL just guaranteed (`legacy-retrieval-port.ts:305-393`): the status partition (retired below current), the per-type round-robin reserving a slot per planned type, and the per-document interleave.

It also compares **incomparable score scales** — the profile port emits squashed BM25 plus fixed `0.6` policy admits (`profile-retrieval-port.ts:497, :607-613`); the mode port passes the raw hybrid score through (`mode-retrieval-port.ts:236`). With a résumé and a reference file both in play, one pool takes all six `maximumAcceptedEvidence` slots on magnitude alone — the exact outcome the round-robin exists to prevent.

## RC6 — Referent resolution ignores scope
**Read** (amplifier **Executed**). Review finding #4.

`resolveReference` (`conversation-state.ts:465`) never compares `state.scopeId` against the turn's scope, though `continuitySourceIds` (`:596`) does exactly that for source ids. `advance()` resets on scope change (`:241`) but `orchestrate()` resolves the referent **before** advancing (`orchestrator.ts:694` vs `:907`) — so the first turn after any meeting or mode change resolves against a stale `activeTopic`.

**Amplifier, verified:** `IntelligenceEngine.ts:5842` passes `scope: { meetingId }` with **no `sessionId`**, falling back to the literal `'engine'` key. The sibling sites `:3028` and `:5376` both set it explicitly *with a comment explaining why*; this one was missed.

---

# Stage C — admitted, then crowded out or replaced

## RC7 — Three independent refusal mechanisms
All three produce refusal-shaped output; they are **not** the same bug and fixing one does not fix the others.

**(a) Claim-authority denial** — RC1. The turn gets no evidence and the composer emits a no-evidence disclosure.

**(b) Post-stream validator overwrite** *(Read; review #2 sharpens it)* — `IntelligenceEngine.ts:3899`→`:3983`. A validator re-retrieves **independently** via the legacy `buildRetrievedActiveModeContextBlock*` path and overwrites the already-streamed answer with the literal `'I could not find that in the retrieved sections of the document.'` Under V3 the answer was grounded in `_v3p.user` (`WhatToAnswerLLM.ts:1047`) — a *different* evidence set from the one being validated. The gate exempts coding and attached images (`:3909`) but **not** `requestSnapshot.v3Prompt`. Its single repair re-retrieves with the **same query text** (`:3986-3987`); if that fails, the refusal ships (`:4084`).

**(c) WTA governed-pack hard refusal** — see `02-WTA-VS-MANUAL.md`. Fires *before any generation*.

**Manual chat's V3 branch runs no post-stream validators at all** (verified — `ipcHandlers.ts:1476-1560`), so (b) is WTA-only on the default path. That is a second reason manual "just works", and it means the two surfaces have opposite risk profiles: WTA can destroy a correct answer; manual can ship an unvalidated one.

## RC8 — Evidence-budget crowding (NOT truncation)
**Read + Executed.**

`enforceTokenBudget` admits **whole chunks only** and rejects any that would exceed the budget — it never truncates mid-fact (`ModeHybridRetriever.ts:1965-1973`). At production's ~225-token chunks the doc-grounded 3600-token budget is **not binding**; top-K binds first. Caveat: the V3 port passes the *mode policy* budget instead (technical-interview 1600, general 1500 — `mode-policy-registry.ts:292,191`) with `maximumCandidates=20`, where it can bind at ~7–8 chunks — still by whole-chunk exclusion.

Measured (`04-EXPERIMENTS.md`): budget-survival is perfect through 1250-token chunks and degrades from 2000. **Chunk size is not the current problem.**

---

# Stage D — delivered, but the wrong chunk ranks first

*This is the original chunking investigation. Real, measured, and lowest priority — everything here is downstream of Stages A–C.*

## RC9 — Chunks carry only the LEAF heading, so project identity is absent
**Read + measured.** Chunker: `ModeHybridRetriever.chunkText` (`:662-729`), lexical twin `ModeContextRetriever.chunkText` (`:221-403`). 140 words / 30 overlap (`:105-106`) ≈ **~225 tokens**; a 63k file → ~85–95 chunks. It *is* heading-aware, but prefixes only the leaf: `[Section N.N | pX] <heading>` (`DocumentMap.ts:571-583`). With 5 projects × identical section names, the five "Idempotency" chunks are near-neighbours in embedding space with nothing to distinguish them.

**Measured impact** (`04-EXPERIMENTS.md`): with heading-path prefixes, entity anchoring takes top-1-correct-project from 1/5 to **5/5**. Without them the same anchoring recovers almost nothing (0.08 project precision). **The two fixes only work as a pair; production has neither.**

### Why splitting the file into per-project files helped (symptom 3)

Three mechanisms, descending impact — all of them workarounds for the identity that RC9 drops:

1. **The filename becomes a first-class ranking signal.** The V3 port boosts chunks whose *file name* shares ≥2 distinctive tokens with the question, above everything except exact identifiers (`legacy-retrieval-port.ts:244-264, :298-303`), and file names appear in the identity block (`ModeHybridRetriever.ts:2049-2073`). `fieldserve-crm-sync.md` re-injects exactly the project identity the chunk text lacks. **This is why fixing RC9 generalises the benefit to a single combined file** — heading paths put the identity back in the text, where it belongs.
2. **The per-file floor only exists for multiple files** — `guaranteePerFile = forceDocumentGrounding && files.length > 1` (`:1409`), round-robin floor of 2 chunks per file (`:1984-2004`). One combined file gets no floor; per-project files each get guaranteed representation, so no project is crowded out by a neighbour that ranks better on generic prose.
3. **Smaller files ≈ crude project scoping** — more of the retrieved set belongs to the right project by construction, partially substituting for the missing anchoring (RC11).

**It didn't fully fix things** because the leaf-heading collision persists *within* each file, the query-side causes (RC10/RC11/RC12) are file-layout-independent, and RC1 makes second-person questions fail regardless of file layout — which is why he ended up duplicating facts into the 8k Real-time Prompt.

> **Correction (2026-08-28).** An earlier draft named per-FILE dedup as the dominant reason splitting helped. It is not — see the RC4 correction; that behaviour was removed for all callers on 2026-07-31.

## RC10 — No query rewriting anywhere
**Read.** The retrieval query is the resolved question verbatim (`orchestrator.ts:180` → `legacy-retrieval-port.ts:187`). No HyDE, no distillation. Only transformations: a conversational-wrapper strip (`documentGroundedPrompt.ts:398-402`), the RC11 referent parenthetical, and doc-grounded stopword filtering on the **lexical arm only** (`ModeContextRetriever.ts:916-921`). The **vector** arm embeds raw phrasing (`ModeHybridRetriever.ts:1661`).

## RC11 — Continuity mechanisms are capitalisation-gated
**Read.** Two exist, both fragile on ASR:
1. **V3 referent resolution** (`conversation-state.ts:465-587`) — `activeTopic` extraction is capitalised-entity-gated (`:76`, `:250-252`). If ASR lowercases the project name, no topic is set and the follow-up anchors to a **stale** one.
2. **WTA referent enrichment** (`ModeContextRetriever.ts:1738-1748`, mirrored `:878-896`) — appends ≤3 entities from the previous *answer*, gated on `looksAnaphoric && ownEntities.length === 0`. One incidentally capitalised ASR token ("CRM", "Meet") silently disables it.

> Note: `questionSource`/`questionConfidence` are plumbed end-to-end and **never consumed** (**Executed**, review #10) — `decide()` uses only `q.resolved`, and the trace recomputes `resolutionConfidence` from `req.manualQuestion` (`orchestrator.ts:795`). So the manual-vs-transcript split is **not** itself a source of refusals today, contrary to the comment at `IntelligenceEngine.ts:3034-3040`.

## RC12 — Embedding provider flips degrade a session to lexical-only
**Read.** Cross-space cosine *is* properly guarded (composite space key, `:1670-1677`; mid-query flips discard ephemeral vectors `:1709-1722`; dims mismatch → 0 `:749-750`). The damage is in the **flip window**: a Gemini 429/timeout makes `getEmbeddingForQuery` fall back to MiniLM and **promote** it (`EmbeddingPipeline.ts:693-706`, `:635-664`). Active space becomes `local:…:384`, so every persisted Gemini vector is unusable; ~90 chunks must be re-embedded ephemerally under one 30s timeout, and on partial failure chunks degrade to **FTS-only** (`:1723-1727`).

`text-embedding-004` returning 404 during this investigation is a live demonstration of the same churn risk.

---

# Rejected / cleared

- **"Chunks are truncated to fit the budget"** — REJECTED, see RC8. Whole-chunk exclusion only.
- **"Chunk size is wrong"** — REJECTED. Production's ~225 tokens sits inside the measured 300–512 sweet spot.
- **"Cross-space cosine silently corrupts similarity"** — REJECTED. Explicitly guarded; the real damage is the flip window (RC12).
- Cleared by the review, do not re-litigate: `filterByScopeAndVersion` ignoring its `scope` arg; unread `optionalSourceTypes`; the per-document interleave loop bound; unguarded `CLAIM_AUTHORITY[ct]`; the `profileSourceCount` manual-vs-engine mismatch (always equal); the apparent scope bypass in the profile repair (`LLMHelper.ts:552/567` sniffs `<candidate_`).

# Lower-severity items still open
**Reported, not re-verified.** `engine-bridge.ts:181` — the silent `'general'` fallback `resolveModeIdOrWarn` exists to replace, still live on five surfaces. `legacy-retrieval-port.ts:398` — SCORE_CAP rejections attributed to the wrong attempt, feeding `PriorTurnDecision.ignoredSources` and the `[V3]` funnel. `engine-bridge.ts:455` — `unsupportedInMode` re-derived by two consumers with different rules.

**Diagnostics gap (verified):** the `[V3]` line can read `candidates:1, admitted:1, rejected:0` while `evidence=0` — `PLANNED_TYPE_FILTER` drops go to `attempts[].rejections`, not the summary counter. Do not triage from that line alone.

# Reproduction

Each cause, minimally:
- **RC1** — `experiments/mode-audit/perfect-retrieval-proof.ts`, or ask "how did you handle X?" vs "what is the X on the Y project?" with the same file attached.
- **RC2** — `experiments/mode-audit/collision-sweep.ts`, or rename a project to contain "Sync".
- **RC3** — `experiments/mode-audit/` + a resolved bare follow-up in looking-for-work.
- **RC4** — attach a .md to built-in Technical Interview; `[WhatToAnswerLLM] Active mode grounding` shows `forceDocumentGrounding=false`. Same file in General → doc-grounded.
- **RC7(b)** — ask an `exact_numeric_answer` question whose number misses top-12; watch `repair_used: doc_grounded_refusal` at `IntelligenceEngine.ts:3983`.
- **RC9/RC11** — `experiments/chunk-sweep/ablation.py` (`sweet-*` vs `npfx-*`).
- **RC12** — invalidate `GEMINI_API_KEY` mid-session; watch `promoteFallbackProvider`.
