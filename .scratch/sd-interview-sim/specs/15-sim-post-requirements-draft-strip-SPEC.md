# SPEC 15 — Sim-gated post_requirements Requirements-draft strip

**Status:** implemented  
**Parent:** [PRD.md](../PRD.md)  
**Depends on:** SPEC 12 (`sdProblemKey` / `sdSimPinned`), SPEC 14 (soft nudge insufficient)  
**Trigger:** Post-#11 FULL_RAW smoke (`t2-a61952e8…`) still tagged `candidate_rewind` (2 late `**Requirements Draft:**` blocks)

## Problem

Soft prompt nudges do not stop the model from answering a scope clarifier *and* pasting a fresh FR/NFR Requirements Draft mid deep-dive. Digest soft-tag `candidate_rewind` keeps firing.

## Decision

Sim-only structural inverse of the Requirements-phase soft-truncate:

1. Pure `stripPostRequirementsRewind` / `enforcePostRequirementsRewindStrip` — cut from rewind markers (`Requirements Draft:`, `Here is the current draft…`, `**Functional Requirements:**`, etc.) through the next later-framework heading or EOF; keep clarifier prose and later DF sections.
2. Stamp `answerPlan.sdSimPinned` when IntelligenceEngine applies the gate with `sdProblemKey` pinned.
3. WhatToAnswerLLM: when `sdSimPinned && sdPhase=post_requirements`, buffer the stream (like requirements gate), run deep-dive soft checks, then strip, then yield once.

Product path (`sdSimPinned` unset) unchanged — post-gate turns still stream live.

## Out of scope

- Interviewer role-bleed
- Digest → fixture promotion
- Changing live (non-pinned) streaming TTFT behavior
- Another overnight FULL_RAW unless asked after merge

## Tests

- `stripPostRequirementsRewind`: keeps clarifier; drops draft; preserves Core Entities after draft
- `enforcePostRequirementsRewindStrip`: identity without pin / while requirements; strips when pinned + post_requirements
