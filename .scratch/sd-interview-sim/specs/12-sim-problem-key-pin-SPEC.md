# SPEC 12 — Sim-only SD problemKey pin (context-drift fix)

**Status:** implemented  
**Parent:** [PRD.md](../PRD.md) (T2 corpus quality; product WTA unchanged by default)  
**Grill:** A → A → A → A (pin only via `options.sdProblemKey`)

## Problem

T2 live SUT called `runWhatShouldISay(undefined, …)`, so each clarifier became `problemQuestion` → new `problemKey` → `mergeDeepDiveExtensionBeforeCheckpoint` wiped `designSheet` / `recentSdAnswers`. Corpus showed Requirements rewinds and topic loops.

## Decision

- Add optional `options.sdProblemKey` on `runWhatShouldISay` / IntelligenceManager.
- When set, gate prepare uses that string for `normalizeSdProblemKey` / artifact identity.
- Answer focus still uses `question || extractedQuestion || lastInterviewer` (`question` stays `undefined` on sim path).
- T2 live SUT passes scenario prompt (`SD_INTERVIEW_SIM_T2_PROMPT` / factory `sdProblemKey`).
- Product / renderer paths never set `sdProblemKey`.
- Out of scope: ME inject, prompt nudge (follow-ups if rewind remains).

## Tests

- `scripts/__tests__/sd-interview-sim-live-sut.test.mjs` — SUT passes pin; factory overrides scenario.
- Gate merge already preserves sheet on same key (`mergeDeepDiveExtensionBeforeCheckpoint`).
