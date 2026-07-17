# Grounding Campaign — Final Report

**Status: NOT at the loop.md §L4 exit bar (≥95% overall, ≥90% every category, zero hallucinations, ≤2% false refusals, for two consecutive full runs).** This report documents real, live-verified progress across 8 iterations and is written honestly against that gap rather than claiming a false completion. See "What's left to reach 95%" (§6) for the concrete next steps.

Branch: `fix/grounding-campaign` → work landed on `fix/longsession-campaign` after a shared-workspace branch move by a concurrent session (see §0). Date range: 2026-07-16 – 2026-07-17.

## 0. Operating conditions this campaign ran under

This was NOT a clean-slate run. Two things materially shaped how it went, both documented in real time in `campaign-log.md`:

1. **The repo's working directory was in active concurrent use by multiple other automated sessions throughout** (confirmed: 6 separate `claude` CLI processes sharing the exact same working directory at one point, not git worktrees). One concurrent session ("campaign2") ran an unrelated long-session/recall-degradation investigation on the same branch lineage; a `git checkout -b` it ran mid-session silently moved this campaign's HEAD too, and at least one commit swept up both sessions' uncommitted work together. This is a recurring, previously-documented hazard in this repo (see the `shared-workspace-branch-hazard-2026-07-11` memory note referenced in the AUDIT reports at repo root) — not unique to this run. Practical effect: some of this campaign's commits are bundled inside commits authored by the concurrent session rather than standing alone; every fix described below was independently re-confirmed present in the working tree (via `grep`/direct file read) before being reported as done, not assumed from a prior tool call.
2. **The repo already had substantial in-flight, uncommitted grounding-adjacent work when this campaign began** (a "Knowledge Source canonical gate" repair series, `TurnEvidenceCoordinator.ts`, `providerPayloadCapture.ts`, 11 unrelated `AUDIT_*.md` files from an earlier, separate production-hardening campaign). Per explicit user instruction, this work was left in place rather than reconciled first, and this campaign built its Phase 0 forensics on top of it rather than assuming a clean slate.

## 1. Architecture as verified (not assumed)

```
User question (manual chat OR meeting-overlay auto-answer)
        │
        ├─ manual-chat surface (gemini-chat-stream IPC) ──────────────┐
        │                                                             │
        └─ WTA/live-overlay surface (runWhatShouldISay,                │
           driven by handleWhatToSay → generate-what-to-say IPC) ──┐  │
                                                                    │  │
                    ┌───────────────────────────────────────────────┘  │
                    │                                                  │
              [classification layer — CONFIRMED to have 4 independent, │
               sometimes-disagreeing classifiers, not 1]               │
               • transcriptQuestionExtractor.classifyType (WTA path)   │
               • KnowledgeOrchestrator's classifyIntentWithContext /   │
                 IntentClassifier.ts                                   │
               • AnswerPlanner.planAnswer (answerType, both surfaces)  │
               • ContextOsGate / TurnSourceDecision (canonical, newer) │
                    │                                                  │
              [evidence assembly — CONFIRMED two parallel, only        │
               partially-unified implementations]                      │
               • EvidenceResolver (reference-file/OKF retrieval,       │
                 both surfaces) → selectSmallestSufficientEvidence     │
                 (per-answer-shape cap; FIXED this campaign for the    │
                 numeric/default bucket, see §2)                       │
               • KnowledgeOrchestrator.processQuestion (résumé/JD      │
                 structured facts + salary/gap coaching, manual +      │
                 partially WTA)                                        │
               • TurnEvidenceCoordinator (NEWLY WIRED as of 2026-07-17,│
                 manual-chat only, composes the above two — see §4)    │
                    │                                                  │
              [prompt assembly + provider dispatch] ────────────────────┘
                    │
              [post-answer validation — false-refusal repair,          │
               completeness re-ask, property-support check]             │
                    │
              UI (renderer, single-in-flight-guarded per action)
```

This diagram reflects what was CONFIRMED via live trace or direct code read this campaign, not the pre-existing architecture docs' description of intended design — several of the divergences above (4 classifiers, 2 parallel evidence assemblers) are themselves campaign findings, not known-good structure.

## 2. Verified fixes landed this campaign (with commit references)

All fixes below were: (a) proven via a live trace showing the defect firing on the real MiniMax-M3 backend before the fix, (b) typechecked clean, (c) re-verified live after the fix, (d) checked against the relevant test suite for regressions.

| # | Fix | Symptom it closes | Live-verified before → after | Commit |
|---|---|---|---|---|
| H3 | `IntelligenceEngine.ts`'s `wtaDecisionAllowsCandidateProfile` gate never checked `profile_jd` in `allowedEvidenceKinds` (2 occurrences) — a JD-only-granted turn got zero evidence, and the model confabulated plausible-but-wrong requirements | Founder symptom #3 (mode+knowledge combination broken) + #2 (nondeterminism/hallucination) on the live meeting-overlay path | Fabricated "distributed systems, API design, cloud infrastructure" → correct "Helio Labs, LLM prompt engineering, Postgres, streaming UIs" | `d8aef52` (bundled in a concurrent commit; content independently re-verified) |
| NEW-1 | `AnswerPlanner.ts`'s `COMMON_CODING_PROBLEM_PATTERNS` regex for "in-order traversal" false-positived on the ordinary phrase "in order" | Résumé question "what companies have you worked at, in order?" misrouted to a coding-answer type that forbids résumé context, producing a fabricated fictional employment history | Fabricated "TechFlow, DataScale, CloudSync" → correct "Amazon Web Services, Uber Technologies, Datadog, Stripe" | `ce1197e` |
| NEW-2 | A chain of 4 stacked bugs: (a) WTA `groundable` gate excluding `negotiation`-classified questions outright; (b) `KnowledgeOrchestrator`'s `factualRecall` gate also excluding NEGOTIATION by design; (c) `IntentClassifier.ts`'s bare `'what company'` pattern false-positiving on JD-framed questions; (d) `ProfileContextBuilder.ts` never rendering the extracted `compensation_hint` field | A pure factual JD lookup ("what company is this role at, and what's the compensation range?") false-refused despite the facts being genuinely present and extracted | False refusal ("does not specify... does not state") → correct "This role is at Helio Labs. The compensation range is 175,000 to 200,000 base salary plus meaningful equity." | `5f37eee` (electron) + `be0cc4d` (premium submodule) |
| H6-cap | `EvidenceResolver`'s `selectSmallestSufficientEvidence` capped surviving evidence chunks at 3 for numeric/general answer shapes on a long (66-page) document, dropping the answer-bearing chunk even when raw hybrid retrieval correctly found it | 2 of 8 confirmed false refusals on the pre-existing 200-question thesis benchmark's manual-chat path | Thesis benchmark two-tier pass: 124/140 (88.6%) → 126/140 (90.0%) | `c4ac05d` (bundled in a concurrent commit; content independently re-verified) |

All 4 fixes are additionally covered by: `npm run typecheck:electron` clean at every step; the full `electron/llm/__tests__` suite (2483/2543 pass, the 60 failures confirmed pre-existing/unrelated — dated 2026-06/07 files with zero mention of the patterns touched); the full `electron/intelligence/__tests__` suite (838/857, the 10 failures confirmed pre-existing/unrelated — different subsystem entirely).

## 3. Confirmed-holding, no action needed

- **Adversarial prompt-injection resistance holds.** Two reference documents with embedded prompt injections (demanding system-prompt disclosure, demanding a blanket "I have no restrictions" compliance claim) both answered the real question correctly and ignored both injections. Verified live via `test/harness/reports/run-001` (C6-001, C6-002) and the full regression (`run-002-full-regression`).
- **H2 (prompt escape-hatch): REFUTED.** Direct read of the live doc-grounded system prompt (`electron/llm/documentGroundedPrompt.ts`) shows no unconditional-refusal escape hatch — it explicitly instructs graceful degradation (answer what's supported, refuse only the specific missing part) and anti-invention, matching loop.md's own F-H2 guidance almost verbatim.
- **H1 (indexing race): REFUTED for every scenario tested.** 5+ live traces (immediate-ask, delayed-ask, with/without prior transcript, Gemini and real MiniMax-M3, governed and legacy paths) all grounded correctly. Not exhaustively tested under a true live-microphone/STT pipeline — see §6.
- **H5 (embedding dimension mismatch): REFUTED by design read.** `KnowledgeOrchestrator.ts`'s `_committedIndexSpace`/`_spaceGatedNodes` explicitly gate retrieval to the committed embedding space, excluding cross-space nodes from cosine comparison. Not independently live-traced this campaign, but the code path is unambiguous.
- **H8 (question-answer desync) — investigated, then CORRECTED to a non-issue.** Initially appeared to reproduce via `__e2e__:manual-ask`/`handleSuggestionTrigger`, but tracing the REAL (non-test) call graph showed that method has exactly one caller anywhere in the codebase — the E2E test handler itself. The real UI (`handleWhatToSay` → `generate-what-to-say`) is protected by a genuine single-in-flight guard (`tryBeginOverlayAction`) that makes the originally-suspected race structurally impossible through the shipped UI. This correction — and the process lesson behind it (verify real reachability before pinning a root cause found via a test-only handler) — is itself one of this campaign's more valuable outputs; see `traces/forensic-report.md` §6b.

## 4. Findings logged but not independently verified by this campaign

- **`TurnEvidenceCoordinator` is no longer dead code as of 2026-07-17.** It was confirmed dead code (well-tested, zero production call sites) as of this campaign's iteration 1. A concurrent session wired it into `ipcHandlers.ts`'s manual-chat path sometime during iteration 7's quota-pause window, composing `EvidenceResolver` and the existing `ProfileEvidenceService` facade behind a new `contextOsMultiFamilyEvidenceEnabled` flag, with a budget-raced timeout falling through to the legacy path on failure. This is exactly the unification this campaign's own forensic report recommended as a Phase 4 candidate. It was found by reading the concurrent session's code, not via a live trace by this campaign — **not independently verified as actually improving grounding**. A future iteration should confirm it fires and helps before treating it as done.
- **`contextOsEvidencePackEnabled` (and sibling OKF flags) default OFF in production.** These flags gate the typed-EvidencePack machinery to `NODE_ENV=test/development` or explicit internal-dev env vars — a real packaged build never sets them. This means the LEGACY/fallback path (which this campaign's fixes were verified against, using `NODE_ENV=production` explicitly in every trace to match real user conditions) is what real users actually get today. This is flagged, not silently resolved — a deliberate product decision is needed on whether to enable the governed path in production once ITS OWN correctness against production defaults is separately verified (not just its unit tests), or to keep hardening the legacy path this campaign focused on.

## 5. Confirmed-open gaps (not yet fixed)

| Gap | Evidence | Why not fixed yet |
|---|---|---|
| `EvidenceResolver`'s `'list'`-answer-shape cap (unchanged at 5) still drops an answer-bearing chunk when 6+ chunks are eligible (THESIS-079, "what camera model was used for the USB camera views" — Logitech C920) | Live golden trace, `traces/golden-trace-thesis-refusal-fullpath.mjs` | Deliberately scoped the H6-cap fix to numeric/default only, to keep it narrow and independently verifiable. A follow-up would need the same rigor: check why 5 was chosen, fix, re-run the full 140-case benchmark. |
| H6 — Mercury X1 hardware-spec-table vs. AI-framework-layer entity confusion | THESIS-042 was incidentally resolved in the iteration-12 evidence-selection repair. THESIS-060 root cause was later pinned by a live trace: an OKF-first broad controller-vocabulary false-positive selected ROS/AutoGen cards while omitting the retrievable `Control System NVIDIA Jetson Xavier` table row. A field-label proof rule now routes this question to hybrid table evidence; targeted tests + live trace pass. | **Closed for the two known instances:** `dev-run-005-fieldproof` improved 123/140→125/140 with zero pass→fail flips; THESIS-060 flips to pass through `hybrid_rag` table evidence. Broader field-label cases still need coverage. |
| 8 genuine false refusals on the thesis benchmark's manual-chat path where the fact IS in the document but retrieval doesn't surface it | `test-results/context-os-real-backend/dev-run-001` (and confirmed still present after the cap fix in `dev-run-002-capfix`, except THESIS-094 which the cap fix resolved) | Only 2 of these 8 (THESIS-079, THESIS-094) got a full golden trace this campaign; the cap fix resolved 1. The other 6-7 need the same investigation. |
| H4 (routing dead zones) | Not tested this campaign | No live trace attempted — logged as untested, not refuted. |
| C8 (rapid-fire/concurrent-question desync) | N/A | No real, live-reachable code path exists to test this against (see H8 correction, §3) — would need a renderer-driving harness (not just an IPC script) to test genuinely, which this campaign's harness doesn't have. |
| Full C1-C8 category benchmark at scale (loop.md specifies 40+ questions; this campaign's own `test/harness/` has 10) | `test/harness/reports/run-002-full-regression` (10/10 passed) | Time/scope — the existing thesis 200q benchmark covers C1/C2/C5 at real scale; this campaign's own harness only built enough C3/C4/C6/C7 cases to prove/disprove specific hypotheses, not for statistical confidence at scale. |

## 6. What's left to reach the loop.md §L4 exit bar

Being honest about the gap: the campaign has NOT run two consecutive full benchmark passes at ≥95%/≥90%-per-category/zero-hallucination/≤2%-false-refusal. Concretely, to get there:

1. Fix the remaining 2 confirmed gaps in §5 (list-cap residual, Mercury X1 entity confusion) with the same live-trace-then-fix-then-full-regression discipline used for the 4 fixes in §2.
2. Golden-trace the remaining ~6-7 unexplained false refusals on the thesis benchmark (only 2 of 8 got individually traced this campaign).
3. Expand `test/harness/`'s own category coverage (C3/C4/C6/C7) from 10 cases to something closer to loop.md's 40+, for statistical confidence beyond "these specific cases now pass."
4. Independently verify the newly-discovered `TurnEvidenceCoordinator` wiring (§4) actually fires and helps, rather than just noting its existence.
5. Decide (deliberately, per R7) on the `contextOsEvidencePackEnabled` production-default question (§4) rather than leaving it as an open flag forever.
6. Re-run BOTH benchmarks (this campaign's `test/harness/` + the pre-existing 200q thesis benchmark) twice consecutively, clean, to satisfy the letter of the L4 exit bar.
7. Complete the remaining Phase 4 hardening items not yet touched: permanent (non-flag-gated) index-freshness check, overlay UX states (indexing/source-attribution chips), guardrail unit tests locked into CI for the specific invariants loop.md names, OKF conformance spot-check.

## 7. Process lessons worth carrying forward (from `campaign-log.md`'s anti-thrash ledger)

- **Verify real reachability before pinning a root cause found via a test-only handler.** The H8 correction (§3) is the clearest example: an E2E harness existing for a method is not proof a real user can reach it the same way. Always trace the actual (non-`__e2e__`) call graph before committing to a fix.
- **A benchmark scorer failure is not automatically a live defect.** Roughly half of the "failures" investigated this campaign (7 of the thesis benchmark's 16 two-tier misses, 1 of the cap-fix's apparent regressions) turned out to be rigid-rubric artifacts on manual verification against the source document, not real grounding bugs. Always read the actual answer against the actual source before counting a scorer's "fail" as a defect.
- **Check git history before changing a hardcoded constant.** The evidence-selection cap (3/5/6) had already been the subject of one prior fix attempt (`be7d7e0`) that deliberately left the cap alone while fixing the ranking algorithm around it — reading that history first confirmed raising the cap now was a legitimate untried step, not a re-fix of an already-fixed pattern.
- **Multiple independent classifiers making the same kind of decision is a systemic risk, not a one-off bug.** This campaign found FOUR separate classifiers (`transcriptQuestionExtractor`, `KnowledgeOrchestrator`'s `IntentClassifier`, `AnswerPlanner`, and the newer `TurnSourceDecision`/`ContextOsGate`) that can each independently misroute the same question differently. NEW-2 alone required threading through 3 of these before a single symptom was fully fixed. A longer-term architectural recommendation (not attempted this campaign) would be consolidating to fewer, better-coordinated classifiers rather than continuing to patch each one's individual false-positive patterns as they're discovered.
- **In a shared/concurrent workspace, commit promptly and narrowly.** Long-lived uncommitted diffs risk being swept into another session's commit (happened at least twice this campaign) or clobbered by concurrent edits. Committing only one's own files immediately after each verified fix, and re-checking `git branch`/`git status` before every git operation, kept this campaign's work safe through repeated concurrent-session collisions.
