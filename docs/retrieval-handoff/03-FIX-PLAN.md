# Fix plan

**Supersedes the original 8-task plan**, which was written before the decision-layer causes were found and sequenced chunking work first. That ordering is now known to be wrong: a turn that is never retrieved cannot be rescued by better ranking. Cause IDs refer to `01-ROOT-CAUSES.md`; pipeline items to `02-WTA-VS-MANUAL.md`.

## Cross-platform statement (CLAUDE.md contract)

Every task below is pure TypeScript in `electron/` main-process modules: no `process.platform` branches, no native modules, no filesystem paths, no shell, no Electron window/permission/IPC surface, no packaging inputs. macOS and Windows behaviour is identical **by construction**, not by testing. The contract still requires this be stated per change and demonstrated by tests running in the existing CI matrix — add every new test to suites that run on both, and use CLAUDE.md's exact categories in the completion report. **Never write "cross-platform verified".**

## Flagging

Tasks 1, 2, 3, 4, 5 and 7 change live answer behaviour. Each lands behind a flag whose default is **identical in dev, test and production** — read the header of `electron/context-intelligence/contracts/flag.ts` for why that invariant is non-negotiable here.

## Sequence

```
T1 policy decision ─┬─► T2 token collisions      (independent, ship first — smallest + safest)
                    ├─► T3 WTA packet/V3 split   (independent; fixes 7 symptoms incl. the reported one)
                    └─► T4 refusal exemptions
T5 follow-up pools ─── T6 port combination ─── T7 referent scope     (independent of each other)
T8 mode contract + pinnable weights   (needs T1's decision)
T9 heading paths ──► T10 anchoring    (pair; T10 is near-useless without T9)
T11 rewritten re-retrieval  ·  T12 project index  ·  T13 embedding hysteresis
T14 auto-split  ·  T15 RRF   (only if measurement still demands them)
```

---

## T1 — DECIDE: may a user's own reference file evidence a `USER_*` claim? ⚠️ BLOCKS T8

**Cause:** RC1 (master). **Type:** product decision, not a patch. **Do not skip to code.**

`REFERENCE_FILE` is authoritative for no `USER_*` claim (`source-authority-policy.ts:37-45`), so every second-person question — i.e. every interview question — plans identity pools and the file is unreachable in all 9 modes.

This is deliberate design: "personal experience" routes to the résumé. The defect is that it assumes experience lives in the résumé while the product invites users to upload reference files, then makes them unreachable for questions about their own work.

**Run `superpowers:brainstorming` with the user.** Options:
- **(a)** Add `REFERENCE_FILE` (and `PROJECT_FILE`/`CODING_SAMPLE`) to `USER_SKILL`/`USER_EMPLOYMENT`/`USER_EDUCATION` authoritative lists — mirrors what was already done for `USER_PROJECT` on 2026-08-01 (`:43`) for exactly this reason. Widest fix; must not weaken the JD-as-experience protection, which lives on the `prohibited` lists.
- **(b)** A new claim type (`USER_PROJECT_DOCUMENT`) so reference files evidence project/skill claims without becoming identity sources.
- **(c)** User-pinnable per-source weights (the tester's explicit ask) — makes it explicit rather than implicit.

**Recommendation:** (a) for `USER_PROJECT`-adjacent claims plus (c) for control. Keep `USER_MOTIVATION` and JD prohibitions untouched.

**Acceptance:** a `USER_SKILL` question in each mode retains reference evidence; no mode gains a source its policy doesn't authorize; `filterByScopeAndVersion` rejections unchanged.
**Test:** `experiments/mode-audit/interview-reachability.ts` must go from 2/8 to ≥6/8 without regressing the neutral-question rows. **Then run `source-contamination-eval`** — this widens retrieval and that suite guards the JD-as-experience and résumé-mislabelling holes.
**Risk:** HIGH. Four documented incidents came from getting these lists wrong in either direction (`source-authority-policy.ts:23-36, 62-68`).

---

## T2 — De-generalize the classifier token collisions

**Cause:** RC2. **Smallest, safest, highest confidence — ship first.**

- `MEETING_EVENT_RE` (`turn-classifier.ts:200`): `sync` and `standup` match as bare nouns. Tested at `:672` with **no `meetingMode` gate**, while the attribution half beside it *is* gated — add the same gate, or require meeting context ("the sync **meeting**", "in our sync"). Also review `last (call|meeting)`, generic for sales/call-center.
- `PERSONAL_RE` (`:96`): `the candidate|candidate'?s?` kills "candidate generation/set/key". Restrict to possessive/definite person contexts, or gate on recruiting-family modes.

**Acceptance:** `experiments/mode-audit/collision-sweep.ts` reports **0** colliding terms; genuine meeting questions ("what did we decide in the standup?") still classify as `MEETING_STATEMENT`; genuine candidate questions in Recruiting still classify as identity.
**Test:** pure classifier tests, no Electron. Add both the false-positive and true-positive cases — the risk is over-correcting and breaking real meeting/recruiting routing.
**Risk:** LOW-MEDIUM, well bounded (3 tokens, swept 106).

---

## T3 — Fix the `packet` vs `_v3p.user` split (one fault, seven symptoms)

**Cause:** `02-WTA-VS-MANUAL.md` review findings 1, 2, 3, 5, 7, 8, 9.

When V3 composes, `_v3p.user` replaces `packet.userMessage` — so **everything whose only carrier is `packet` silently disappears**, while WTA-only post-stream layers keep validating against legacy blocks that were never sent. Symptoms: DOM/OCR screen text dropped entirely; `promptInstruction` dropped; AnswerPlan contract and repeat-press directive dropped; the `what_to_say` contract replaced by the manual-chat one; the profile repair validating against a block never sent.

**Do this as one architectural fix, not seven patches.** Either give V3's composer carriers for these inputs, or stop discarding `packet` content that V3 does not supply.

**Minimal interim fix for the reported symptom** (can ship first, independently): add the missing `!v3OwnedTurn` guard to `WhatToAnswerLLM.ts:495`, mirroring `LLMHelper.ts:6656`. Verify it does not disable governance for legacy (non-V3) WTA turns, which still need it.

**Acceptance:** with the extension paired, DOM text reaches the model and `hasScreenContext` is true; a custom action's `promptInstruction` reaches the model; the live overlay ships the `what_to_say` contract (restoring the Team Meet "only when directly addressed" rule); no post-stream layer validates against a block that was not sent.
**Test:** assert the dispatched user message contains each input. TDD suits this — assertions are writable before implementation.
**Risk:** HIGH — touches the live answer path for every WTA turn. Flag it.

---

## T4 — Stop the validator overwriting answers it did not ground

**Cause:** RC7(b).

`IntelligenceEngine.ts:3899`→`:3983` re-retrieves via the **legacy** path and overwrites the streamed answer, but under V3 the answer was grounded in `_v3p.user` — a different evidence set. The gate exempts coding and attached images (`:3909`) but not `requestSnapshot.v3Prompt`.

**Change:** add the V3 exemption; and before any refusal overwrite, run one **rewritten-query** re-retrieval (generalize the identifier/positional retry at `legacy-retrieval-port.ts:190-223`) rather than the current same-text retry (`:3986-3987`).

**Acceptance:** a V3-grounded answer is never replaced by a validator that never saw its evidence; a genuinely absent fact still refuses; at most one extra retrieval.
**Test:** drive `validateDocumentGroundedAnswer` (`documentGroundedPrompt.ts:835-866`) directly — it is pure.
**Risk:** MEDIUM-HIGH. This path is also the fabrication guard — do **not** weaken `computeEvidenceCoverage`'s refusal conditions (`:701-711`) to make tests pass; add the exemption and retry in front of them.

---

## T5 — Give bare follow-ups their subject's pool back
**Cause:** RC3. `orchestrator.ts:174`. When claims are empty *because the referent came from state*, include the pools the referent's own turn used (`usePreviousSourceContinuity` already exists on the plan and is unused for this). **Acceptance:** a resolved follow-up in looking-for-work plans RESUME/PROFILE_FACT; in recruiting, CANDIDATE_FILE. "Reverse a linked list" still plans no identity pools. **Risk:** MEDIUM — the exclusion exists for a measured reason (deep-run 2, issue 5).

## T6 — Make port combination preserve the per-port guarantees
**Cause:** RC5. `meeting-retrieval-port.ts:189`. Replace global sort+slice with a merge that preserves the status partition, per-type round-robin and per-document interleave; and **normalize scores across ports** before any cross-port comparison (or interleave by rank, never by raw score). **Acceptance:** with a résumé + reference file both present, neither pool takes all `maximumAcceptedEvidence` slots. **Risk:** MEDIUM.

## T7 — Scope-check referent resolution
**Cause:** RC6. Compare `state.scopeId` in `resolveReference` (`conversation-state.ts:465`) as `continuitySourceIds` already does (`:596`), or resolve after `advance()`. Fix the missing `sessionId` at `IntelligenceEngine.ts:5842` to match `:3028`/`:5376`. **Acceptance:** the first turn after a meeting/mode change never resolves against the previous scope's topic. **Risk:** LOW — the amplifier is a one-line omission.

## T8 — Mode contract + user-pinnable source weights
**Cause:** RC4. **Needs T1's decision.** Seed `reference_files` into `allowedExplicitSwitches` for interview-prep modes so the existing "Primary knowledge source" UI can enable it (`modeSourceContract.ts:245-260`); add `REFERENCE_FILE` to `technical-interview.allowedSourceTypes` (`mode-policy-registry.ts:283`) — which also **un-hides the "Only answer from references" control** (`answer-policy.ts:125`) and restores `documentCentricMode` routing. Existing modes self-heal via `getOrMigrateSourceContract` (`ModesManager.ts:841`); bump `CURRENT_MIGRATION_REVISION` if semantics change. **Risk:** MEDIUM-HIGH — source isolation. Re-run `source-contamination-eval`.

## T9 — Heading-path prefixes on reference chunks ⚠️ prerequisite for T10
**Cause:** RC9. Emit the ancestor path `[context: <H2> > <H3>]` instead of the leaf. Reference implementation: `experiments/chunk-sweep/chunker.py` (`parse_sections` + `_context_prefix`). Edit `DocumentMap.ts:552-587`, `ModeHybridRetriever.ts:680-728`, **and** the lexical twin `ModeContextRetriever.ts:221-403` — the two must not drift. Fix the stale docblock at `mode-retrieval-port.ts:216-226` while there.

**Watch out:** five consumers parse the existing prefix — `ModeHybridRetriever.ts:1118, :1216, :1802, :2020` and `documentGroundedPrompt.ts:653,699`. **Keep the `[Section N.N | pX]` token and add the path**, don't replace the format. Changing chunk text triggers a re-index (`:2119-2126`) — automatic, one embed pass per file.
**Test:** fixture with 5 projects × identical section names; assert each chunk names its project and all five regexes still match. **Risk:** MEDIUM (regex coupling, enumerable).

## T10 — Entity-anchored query rewriting
**Cause:** RC11. **Measured payoff: top-1 correct project 1/5 → 5/5 — but only with T9 landed** (0.08 vs 0.60 project precision). Prepend the active entity to the **retrieval query only**, never the prompt (`ModeContextRetriever.ts:874-877` anti-contamination must hold). Source the anchor from conversation state, not the previous answer's capitalised tokens, and drop the capitalisation gate for transcript-sourced questions. **Risk:** MEDIUM — over-anchoring corrupts good questions; keep every self-contained/quoted-subject guard (`conversation-state.ts:496-527`).

## T11 — Rewritten-query re-retrieval before any refusal
Folded into T4; listed separately because it also applies to the WTA governed path (`02-WTA-VS-MANUAL.md` §1).

## T12 — Always-included compact project index
The tester's explicit ask. `prependIdentityBlock` (`ModeHybridRetriever.ts:2049-2073`) already builds something similar but is gated on `broadQuery` (`:1439`). Emit a compact name + one-line index unconditionally for multi-project sets. **Acceptance:** ≤~200 tokens; excluded from claim-supporting evidence (navigation, not evidence). **Risk:** LOW — watch the budget interaction.

## T13 — Embedding-space hysteresis on the query path
**Cause:** RC12. Apply the startup probe hysteresis (`EmbeddingProviderResolver.ts:30-46` — read its docblock, it describes this exact thrash) to the query path: retry the primary, require N consecutive failures before promoting, and prefer degrading one turn's semantic arm over flipping the session's space. **Test:** extend `EmbeddingFallbackSinglePath.test.mjs` / `ProviderProbeHysteresis.test.mjs`. **Risk:** MEDIUM — bound retries with `EMBED_TIMEOUT_MS`.

## T14 / T15 — Auto-split oversized files · multi-scale RRF
**Do not start speculatively.** T14 (semantic-boundary auto-split so one upload behaves like the tester's split files) is largely subsumed by T9 — re-measure first. T15 (index at two sizes, fuse with `RrfFusion.ts`) has **no measured gap to close**: single-size recall was saturated at every size ≤1250. Gate both on the tester's real corpus showing residual variance after T1–T10.

---

## Validation gates

Before claiming any task complete:
1. `experiments/mode-audit/interview-reachability.ts` — reachability must improve, neutral rows must not regress.
2. `experiments/mode-audit/collision-sweep.ts` — must stay at 0 collisions once T2 lands.
3. `experiments/chunk-sweep/ablation.py` — for T9/T10, compare `sweet-*` vs `npfx-*`.
4. `source-contamination-eval` — mandatory after T1 and T8.
5. The CLAUDE.md completion report, using its exact categories.

**Do not tune against recall@k.** It was perfect (25/25) at every chunk size ≤1250 *and* in the worst configuration measured. Budget-survival and reachability are the metrics that move.
