# SPEC 13 — Sim-gated candidate fill for Requirements checklist

**Status:** implemented  
**Parent:** [PRD.md](../PRD.md)  
**Depends on:** SPEC 12 (`sdProblemKey` pin)  
**Grill / plan:** Sim candidate gate fill (smoke after #9 still showed `candidate_rewind`)

## Problem

Candidate-led T2 sims state FR/NFR/scale in **assistant** speech. Gate fill only scanned interviewer (+ screen), so checklist never completed, thin agent never `advance`d, WTA stayed on Requirements LESSON bias → late Requirements rewinds.

## Decision

- Add optional `candidateFillTexts` to `prepareSdRequirementsForAnswerPlan`.
- After interviewer/screen fill, fill remaining slots from that blob (same extractors).
- When `options.sdProblemKey` is set, IntelligenceEngine passes the last 3 `assistant` context texts as `candidateFillTexts`.
- Product path (no pin) unchanged — no ME transcript clone in this slice.
- Thin agent `advance` on `checklistComplete && visible` unchanged.

## Tests

- `SdRequirementsGateLiveWiring`: candidateFillTexts fills checklist; without it, candidateTexts alone do not.
- Rebuild electron before running those Tier0 tests.
