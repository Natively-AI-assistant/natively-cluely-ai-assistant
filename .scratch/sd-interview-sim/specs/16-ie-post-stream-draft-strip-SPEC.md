# SPEC 16 — IE post-stream Requirements-draft strip (answerType-independent)

**Status:** implemented  
**Parent:** [PRD.md](../PRD.md)  
**Depends on:** SPEC 15  
**Diagnosing-bugs:** `.scratch/sd-interview-sim/debug/repro-spec15-strip-loop.mjs`

## Root cause

Clarifier turns under `technical-interview` often `planAnswer` → `general_meeting_answer`.  
`prepareSdRequirementsForAnswerPlan` early-returns without stamping `sdPhase` / arming WTA.  
SPEC 15’s WTA stream strip never runs → `**Requirements Draft:**` survives in T2 corpus.

## Fix

`applySimPostRequirementsAnswerStrip(text, { sdProblemKey, artifact })`:
- When `sdProblemKey` pinned and session artifact is `post_requirements`, strip draft blocks
- Independent of `answerType`
- Wired in IntelligenceEngine after WTA stream completes (return value / SessionTracker / T2 corpus)
- Product path (no pin) unchanged

## Tests

- `SimPostRequirementsAnswerStripTier0.test.mjs`
- Repro loop case A stays green; IE helper clears smoke turn 31
