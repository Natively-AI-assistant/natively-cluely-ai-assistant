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
[populated below as traces land]

## ITERATIONS
