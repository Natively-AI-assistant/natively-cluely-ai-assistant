# SPEC 14 — Sim soft prompt nudge after Requirements

**Status:** implemented  
**Parent:** [PRD.md](../PRD.md)  
**Depends on:** SPEC 12 (`sdProblemKey` pin), SPEC 13 (candidate gate fill)  
**Trigger:** Post-#10 FULL_RAW smoke (`t2-53345afc…`) still tagged `candidate_rewind` (1 late Requirements Draft)

## Problem

Even after checklist fill + thin-agent advance, candidate-led T2 can restate a full Requirements Draft mid deep-dive. Showcase `promptInstruction` + LESSON bias still pull FR/NFR language after `sdPhase=post_requirements`.

## Decision

Sim-only (product path unchanged when `sdProblemKey` unset):

1. **Always-on soft line** in T2 `CASUAL_SD_TONE_INSTRUCTION` / `FULL_RAW_SD_TONE_INSTRUCTION`: once Requirements are covered, do not restart / paste a fresh Requirements Draft.
2. **Stronger post-gate nudge** via `appendSimPostRequirementsNudge`: when `options.sdProblemKey` is pinned and `answerPlan.sdPhase === 'post_requirements'`, IntelligenceEngine appends it to `promptInstruction` before WTA generateStream.

## Out of scope

- Interviewer role-bleed
- Digest → fixture promotion
- Changing live (non-pinned) WTA prompts
- Another overnight FULL_RAW unless asked after merge

## Tests

- `appendSimPostRequirementsNudge`: pin+post appends; no pin / still-requirements = identity; idempotent
- liveSut tone strings include soft anti-rewind line
