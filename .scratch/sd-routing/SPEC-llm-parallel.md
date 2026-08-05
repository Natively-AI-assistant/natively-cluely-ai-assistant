# SPEC — SD routing LLM parallel (interviewer intention)

## Problem Statement

Interviewers ask system-design questions in many shapes (whiteboard, HLD walkthrough, section switches, fuzzy ASR). Regex-only `planAnswer` misses those and sticky sessions wrongly promote negotiation/identity/meeting turns to `system_design_answer`. Speakable Delivery Framework then never runs — or runs on the wrong turns.

## Solution

Keep the deterministic SD front door. On every route turn, resolve **SD intention** in parallel (sync heuristic now; injectable classifier result for evals/live SLM later). **Promote** regex misses to `system_design_answer` at confidence ≥ 0.75; never demote clear regex hits; hard vetoes for coding/DSA/write-implement. Tighten sticky exclusions. Gate ≥99.99% on a versioned `evals/sd-routing` corpus (mocked intention + trials).

## Seams (test at these)

1. **`planAnswer` / `classifySdIntention`** — primary seam (deterministic + injected `sdIntention`). Prefer this over new engine seams.
2. **`evals/sd-routing` runner** — contract goldens + mocked `sdIntention`; classifier-dependent trials.
3. **IntelligenceEngine** — pass `sdIntention: classifySdIntention(question)` into `planAnswer` on WTA/manual (thin wiring only).

## User Stories

1. As a candidate in TI, I want “sketch the architecture on the whiteboard” to route as system design, so I get Delivery Framework speech.
2. As a candidate, I want “walk me through the high level design” to route as system design, so HLD talk starts.
3. As a candidate, I want “what would you change in this architecture?” to route as system design when intended as design critique.
4. As a candidate, I want “OK let’s move to system design — design a URL shortener” to arm SD routing.
5. As a candidate, I want “let’s design a rate limiter” to route as system design.
6. As a candidate mid-SD session, I want CAP clarifiers to stay system design (sticky), so speakable strip keeps applying.
7. As a candidate mid-SD session, I want “solve two sum” to leave SD for DSA, so coding contract applies.
8. As a candidate mid-SD session, I want salary/intro/action-item turns **not** sticky-promoted to system design.
9. As a candidate, I want “Design Bit.ly” / title-form / scale-ask still to hit via regex without waiting on the classifier.
10. As a candidate, I want experience / implement / explain false friends to stay non-SD when the session is unarmed.
11. As an engineer, I want eval goldens for promote / below-threshold / veto / timeout-no-promote / regex-not-demoted, so regressions fail CI.
12. As an engineer, I want fuzzy ASR cases in the gated corpus with trials once the classifier path exists.
13. As an engineer, I want WTA and manual_input both covered for a Tier A.2 opener.
14. As an engineer, I want classifier timeout to fail closed (no promote), so precision beats recall when uncertain.
15. As an engineer, I want ADR 0005 + glossary terms so future changes don’t reopen leftover-only hybrid by accident.

## Implementation Decisions

- Module: Answer planner SD routing + thin `classifySdIntention` helper; IntelligenceEngine passes intention into `planAnswer`.
- `PlanAnswerInput.sdIntention?: { sdIntention: boolean; confidence: number } | null` — when absent, call sync `classifySdIntention(question)`.
- Promote threshold constant `0.75`; document in code.
- Sticky exclusions: do not promote when current type is `negotiation_answer`, `identity_answer`, or `general_meeting_answer` (meeting-admin).
- Sync heuristic patterns cover Tier A.2 openers (whiteboard, HLD walkthrough, architecture review, let’s design / move to system design).
- Eval cases may inject `sdIntention` to assert merge without ONNX.
- Amend ADR 0004 → superseded by 0005; update speakable-sd CONTEXT.
- No soft-clarify answerType.

## Testing Decisions

- Good tests assert `answerType` (and not-SD) through `planAnswer` / eval runner — not internal regex lists alone.
- Unit: sticky exclusions + promote merge + no-demote + below-threshold.
- Eval: extend `evals/sd-routing/cases.jsonl` ≤20 new Tier A/B cases; update meta tags; runner passes `sdIntention` from case input; trials≥3 for classifier-dependent cases when configured.
- Prior art: `AnswerPlannerValidator.test.mjs`, `scripts/run-evals-sd-routing.mjs`.

## Out of Scope

- Full IntentClassifier ConversationIntent taxonomy rewrite / ONNX SD label training.
- Non-English corpus; classic-noun product grid expansion; live Gemini answer quality (speakable-sd).
- Soft-clarify answerType; LLM demote of regex SD hits.
- Wiring `eval:sd-routing` into CI tier (follow-up when suite stable).

## Further Notes

Glossary locks from grill 2026-08-05: `sd-route-llm-parallel`, `sd-eval-corpus-v1`, `sd-route-sticky-exclusions`, `sd-route-classifier-contract`, `sd-eval-harvest`, `sd-route-uncertain-precision`, `sd-eval-source-matrix`, `sd-route-implement-path`.
