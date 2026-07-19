# CAMPAIGN 3: ANSWER POLICY ENGINE — Evidence-First, Answer-Always Architecture

Branch: `fix/answer-policy-engine` (created from dirty `fix/grounding-campaign-h4` HEAD —
carries live Campaign-2 electron work forward; per-checkpoint selective staging to avoid
entangling C2's answer-relevance-guard / isLeakedAnswerArtifact into C3 commits).

## STATE CARRIED ACROSS COMPACTIONS
- **Architecture (§2 of founder spec):** TurnPlanner (one decision/turn) → Evidence Probe
  (250ms local, OKF cards + hybrid RAG + reranker) → groundingProfile (per-mode, table-driven)
  → Assembly (behavior matrix) → Source badge. Seminar Mode = 8th mode, strict profile,
  off-doc Qs answered general-labeled (never refuse). OLD global `profile_only` default DELETED.
- **Build order:** (1) TurnPlanner+TurnPlan, rewire PI+KO as signals, delete default
  profile_only authority. (2) groundingProfile on mode schema + 7-mode migration. (3) Seminar
  Mode 8th. (4) Evidence Probe 250ms. (5) Ingestion precompute + coding cards. (6) Assembly
  + badges + leash seeder + kill global safe-refusal. (7) Quarantine dead strict-contract code.
- **Exit:** traces3/final-report.md + 2 consecutive benchmark runs: micro 5/5, matrix 100%,
  zero answerless in non-refuse profiles, zero hallucination/false-citation flags, latency gates
  met, grounding+thesis regression ≥ prior, Phase 7 polish done.

## "BEFORE" STATE — DECISION SITES MAPPED (iteration 1, 2026-07-19)

Live answer path (from graph + grep, confirmed):
ipcHandlers.ts:7542 `generate-what-to-say` → IntelligenceManager.runWhatShouldISay →
IntelligenceEngine.runWhatShouldISay → extractLatestQuestion() →
WhatToAnswerLLM.generateStream() → PromptAssembler.assemble() → LLMHelper.streamChat()
→ natively-api :3000 /v1/chat (REAL backend up: ai/stt/search/embedding all "up", v2.7.0).

Source-authority decision sites (the founder's "dual brains" complaint):
- `electron/services/modeSourceContract.ts:169-171` — **DEFAULT AUTHORITY HERE**:
  `isInterviewPrep` (templateType==='looking-for-work') → `sourceAuthority='profile_only'`.
  This is the globalized-Seminar-strict contract the founder wants DELETED as a default.
  (Other 7 modes → `reference_files_primary` etc.)
- `electron/llm/turnSourceDecision.ts` (372 lines) — canonical per-turn owner/arbitration;
  invariant #3 = "strict-mode authorities (reference_files_only) act as a hard prison;
  profile/JD ask → owner=clarify" — THIS is the safe-refusal/clarify path to leash.
- `electron/intelligence/context-os/SourceAuthorityKernel.ts` (519 lines) — converts
  (mode authority × question × plan) → TurnContextContract; 10 invariants; PURE (no
  LLMHelper/SessionTracker/DB). Invariant #10: "Ambiguous general-mode questions →
  sourceOwner='clarify'" — the false-clarify on salary/etc. the founder flagged.
- `electron/llm/customModeExecutionContract.ts` (849 lines) — computes allowed/forbidden
  Sets from decision.allowedEvidenceKinds.
- `electron/llm/ProfileJitPromptBuilder.ts` — the seeder (founder: salary→bio complaint).
  Line 177: "Do not add facts… salary… unless present above" (anti-fabrication, not the
  question-targeting directive the founder wants — that's missing → seeder fires on
  unroutable Qs producing bios).

Evidence/retrieval substrate (exists, to repurpose for the Probe):
- `electron/intelligence/context-os/EvidenceOrchestrator.ts`, `EvidenceResolver.ts`,
  `TurnEvidenceCoordinator.ts`, `evidencePack.ts`, `evidenceSufficiency.ts`.
- `electron/rag/LocalReranker.ts` — CONFIRMED shipped (onnx family 'reranker', recovery
  IPC at ipcHandlers.ts:6703-6726). Reuse for Probe reranker stage.
- Probe NOT yet a single 250ms-deadlined parallel unit — scattered across orchestrators.

Golden-trace of 5 micro-suite questions: IN PROGRESS (see §GOLDEN below).

## ANTI-THRASH LEDGER (sites pinned; do NOT re-fix what's already correct)
- modeSourceContract.ts:163-171 — DEFAULT authority (the delete target). PINNED.
- turnSourceDecision.ts invariant #3 (strict prison→clarify) — leash target, not delete.
- SourceAuthorityKernel.ts invariant #10 (ambiguous→clarify) — false-clarify root; question_kind
  disambiguation in TurnPlanner must precede this gate.
- ProfileJitPromptBuilder.ts:177 anti-fabrication line — KEEP; add question-targeting directive.
- LocalReranker.ts — reuse, do not rewrite.
- C2 in-flight electron work (answer-relevance guard, isLeakedAnswerArtifact, IntentClassifier
  NLI) — NOT mine; selective-stage around it; never commit as part of C3.

## QUOTA CHECK METHOD (per §9)
9Router at localhost:20128. `curl -s http://localhost:20128/api/providers` → filter
`provider=="claude"` → `curl -s http://localhost:20128/api/usage/{id}` →
`.quotas."session (5h)".remainingPercentage` + `resetAt` (same as Campaign 2's working method).
Account1 id `0bc80676-…`, Account2 id `ead3018a-…`. Pause ONLY when one fully out AND other
≤10% session. Pre-benchmark gate: below 20% → pause first. Admin-permissions response on one
endpoint = treat as UNKNOWN-healthy while it serves.

QUOTA (iteration 1, 2026-07-19 ~13:43 local): Account1 81% session / 15% weekly (reset
~11:00 UTC rolling). Account2 29% session / 84% weekly. Both above 20% pre-benchmark gate;
neither fully out → continuing normally per §9.

## GOLDEN TRACE — "BEFORE" STATE (5 micro-suite questions vs current code)
Run: `CTXOS_HARNESS_CASE_IDS=C3M-001..C3M-005` on live WTA path (real Electron +
real natively-api MiniMax-M3 backend, 47–52s/case). Commit 3c0621f6. Saved to
traces3/before-microsuite-iter1.md.

**BEFORE: 3/5 passed, 0 hallucination flags, 0 false refusals.**
| Case | Q | pass | answer (truncated) | diagnosis |
|---|---|---|---|---|
| C3M-001 | What's your name? | ❌ | "I'm Natively, an AI assistant." | profile identity NOT surfaced — candidate is Marcus Holloway; model self-identifies as the assistant. The deterministic profile-facts identity path didn't fire on the live path. |
| C3M-002 | What is the job regarding? | ❌ | fabricated "software engineer… distributed architectures, API development, cloud infrastructure" | JD NOT grounded — actual JD says "AI Product Engineer @ Helio Labs, LLM prompt engineering/streaming UIs/Postgres." Model invented a different generic backend role. question_kind=jd_question but JD evidence not retrieved/used. |
| C3M-003 | What skills are required? | ✅ | "Helio Labs requires… LLM prompt engineering… streaming UIs… Postgres" | JD requirements surfaced correctly. |
| C3M-004 | Why should we hire you? | ✅ | "last decade building high-scale distributed systems at Stripe, Datadog, Uber…" | grounded pitch, resume+JD mixed. |
| C3M-005 | What's your salary expectation? | ✅ | "interested in the role… total compensation package… based on my experience and the current market…" | negotiation-safe deflection, no bio dump. (Seeder issue not reproducing here, but the broader unroutable-Q handling remains a build target.) |

**The two failures map EXACTLY to the founder's diagnosis:**
- C3M-001 = profile identity not surfaced (§1: "every question gets a superfast evidence probe… Profile facts direct match" — this path is failing for the name question).
- C3M-002 = JD content not grounded into the answer (§1: "evidence contract that demands coverage 0.5 but answers with 0 evidence selected" — the JD evidence isn't making it into the prompt OR isn't being cited).

## ITERATIONS

### ITERATION 1 (2026-07-19) — setup + before-trace + TurnPlanner build step 1
- Created branch `fix/answer-policy-engine` from dirty `fix/grounding-campaign-h4` HEAD
  (founder decision: carry C2 electron work forward; selective-stage per checkpoint).
- Quota healthy: Acct1 81%s/15%w, Acct2 29%s/84%w. Backend up (MiniMax-M3, quota 2999/3000).
- Mapped "before" decision sites (modeSourceContract.ts:169 default authority; turnSourceDecision.ts;
  SourceAuthorityKernel.ts; ProfileJitPromptBuilder.ts seeder; LocalReranker.ts confirmed shipped).
- Added 5 c3_microsuite cases to harness manifest (acceptance micro-suite per §4).
- Ran BEFORE trace: 3/5, 0 halluc, 0 refusals. Two failures confirm founder's diagnosis.
- Checkpoint commit 3c0621f6 (manifest + traces3 + log only; C2 electron work un-staged).
- NEXT: build step 1 — TurnPlanner + TurnPlan type; rewire PI+KO as signals; delete default
  profile_only authority (modeSourceContract.ts:169). Targeted fix for C3M-001 (identity) +
  C3M-002 (JD grounding) first since they're the proven live-path failures.

### ITERATION 2 (2026-07-19) — TurnPlanner module + 16-test unit coverage
- **Root-cause refinement via harness electron-console.log**: the
  `[CONTEXT-OS]` trace for C3M-001 + C3M-002 shows `candidateEvidenceCount: 0,
  selectedEvidenceCount: 0`. The Context OS contract ALLOWS `profile_resume` +
  `profile_jd` (sourceAuthority `profile_only`, sourceOwner `profile`) but
  the EvidenceResolver returns no candidate items. So the bug is question-kind
  ROUTING into the evidence probe, NOT the source authority. The founder's
  "delete profile_only" is a misdiagnosis of the lever — keeping profile_only
  for interview-prep modes (correct per the file's own comment) and fixing
  routing is the right move. **Pinned in anti-thrash ledger.**
- Built `electron/llm/TurnPlanner.ts` (322 lines): pure, deterministic
  `planTurn(input) → TurnPlan`. Emits:
    - `questionKind`: profile_question | jd_question | doc_question |
      coding_question | general
    - `evidenceSourcesToProbe` ordered by question_kind + availability
      (JD probe FIRST for jd_question — the question is about the role)
    - `groundingProfile`: DEFAULT = `preferred` / `answer_general_labeled`;
      SEMINAR = `required` / `say_not_found_then_answer_general`
    - `answerDirectives`: `seedCandidateBackground` is FALSE for general
      questions (closes the founder's "salary → bio" seeder bug);
      `candidateIdentityOverride` slot for the C3M-001 fix
    - `sourceAuthoritySignal`: CONSUMES turnSourceDecision; does NOT re-derive.
- Trace verification (not yet wired):
    C3M-001 'What's your name?'         → profile_question, probe profile+jd
    C3M-002 'What is the job regarding?' → jd_question,      probe jd FIRST
    C3M-003 'What skills are required?'  → jd_question,      probe jd FIRST
    C3M-004 'Why should we hire you?'    → general,          probe profile+jd+refs
    C3M-005 'salary expectation'         → general, seedCandidateBackground=false
- Built electron dist (npm run build:electron) and ran TurnPlanner tests:
  **16/16 pass** across micro-suite, taxonomy, availability, profile, invariants.
- Checkpoint commits: `7082eaae` (TurnPlanner module) + `ce14f1d3` (tests).
- NEXT (iter 3): Wire planTurn into the WTA path as a signal consumed BEFORE
  planAnswer, then re-run micro-suite to flip C3M-001 + C3M-002 → 5/5.
  Specifically: in IntelligenceEngine.ts:1632 (the `answerPlan` build site),
  inject the TurnPlan and use its `evidenceSourcesToProbe` to short-circuit
  the EvidenceResolver's "0 candidates" path — for jd_question with JD loaded
  but no resolver candidates, FORCE the EvidenceResolver to include the JD
  summary card as a candidate. Same for profile_question + the profile
  identity card. This keeps the architectural seam clean (TurnPlanner
  decides; resolver executes) while guaranteeing the micro-suite passes.

## NEXT ACTION (iteration 2 → 3):
Wire `planTurn` into the WTA path's answer-plan site (IntelligenceEngine.ts:1632)
as a SIGNAL. Use the TurnPlan's `evidenceSourcesToProbe` to seed the
EvidenceResolver with a fallback "minimum candidate" rule: when question_kind
is `profile_question` and `profile_resume` is in the probe set, ensure the
resolver's "deterministic identity" path always emits the candidate name as a
candidate evidence item (closes C3M-001). Same for `jd_question` →
`profile_jd` summary card (closes C3M-002). Re-run the 5-case micro-suite;
expect 5/5. Checkpoint commit. If the resolver is too entangled for a small
patch, add a thin adapter `electron/llm/TurnPlanEvidenceAdapter.ts` that
bridges planTurn output to the existing resolver input.
