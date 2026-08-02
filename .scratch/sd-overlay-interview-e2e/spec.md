# Spec — SD Overlay Interview UI E2E

**Status:** ready-for-agent  
**Feature slug:** `sd-overlay-interview-e2e`  
**Grill source:** `_workspace/grill-with-docs/01_question_log.md` (2026-07-28, 8/8 verified; Q4 amended → live LLM)  
**Audience:** `/to-tickets` then `/implement` (do not re-litigate locked grill decisions without a new grill)

---

## Problem Statement

Operators cannot prove that a Technical Interview / system-design Requirements gate works **as candidates see it**: gate strip visible, premature **Advance** soft-refuse in the overlay, successful Advance hiding the strip, and post-gate answers appearing in chat chrome. Existing harnesses cover state machines and dual-agent corpus (T0/T1/T2) without asserting the real Electron overlay DOM. Playwright smoke tests do not run an SD interview loop. Stubbed LLM matrices miss live soft-refuse / answer fidelity.

## Solution

Add an **additive** eval family `e2e:sd-overlay-interview`: Playwright `_electron` boots a real app window, drives a **core UI matrix** via `__e2e__` transcript inject + real strip **Advance** clicks, and uses the **live product LLM** (real API key). Assert strip / soft-refuse expand / strip hide / post-gate answer chrome. Run on **schedule / workflow_dispatch only** (never PR; never a dual-agent CI oracle). Does not replace Requirements-gate e2e, sim T1, Profile interview-simulator, or T2 headless corpus.

## User Stories

1. As a workflow owner, I want an overlay UI e2e that opens a real Electron meeting overlay in Technical Interview mode, so that chrome contracts are exercised.
2. As a workflow owner, I want interviewer turns injected via `__e2e__` (not live STT), so that the loop is scriptable without mic flakiness.
3. As a workflow owner, I want the harness to use a **live LLM** with a real API key by default, so that soft-refuse and answer chrome match production fidelity.
4. As a workflow owner, I want the run to skip cleanly when no API key is present, so that schedule jobs do not fail-noise on missing secrets.
5. As a workflow owner, I want stub LLM only as an explicit local debug opt-in, so that CI/default path stays live.
6. As a workflow owner, I want the gate status strip visible while `sdPhase=requirements`, so that SPEC 17 chrome is proven mounted.
7. As a workflow owner, I want premature UI Advance to show soft-refuse behavior in the overlay (including expand when applicable), so that the backup Advance path is not headless-only.
8. As a workflow owner, I want filling checklist slots via injected speech then clicking Advance to close the gate and hide the strip, so that the happy path is UI-proven.
9. As a workflow owner, I want one post-gate interviewer probe to produce visible answer chrome in the overlay, so that we know the loop continues past Requirements.
10. As a workflow owner, I want stable `data-testid` hooks on strip, Advance, and answer surfaces, so that Playwright asserts are not brittle CSS guesses.
11. As a workflow owner, I want this harness never on `pull_request`, so that live spend and flake do not block PRs.
12. As a workflow owner, I want schedule / workflow_dispatch CI (same posture as T1 / gate Electron e2e), so that regressions are caught intentionally.
13. As a workflow owner, I want hard spend/time caps (max turns ≈ core matrix length, optional USD), so that a stuck live run cannot burn the key.
14. As a workflow owner, I want dual-agent free-form to remain **not** the pass/fail oracle, so that this UI matrix does not reopen the T2-as-CI debate.
15. As a workflow owner, I want T2 headless corpus runs unchanged, so that overnight training fuel stays separate.
16. As a workflow owner, I want Profile `interview-simulator` left as Profile Intelligence only, so that families stay unmerged.
17. As a workflow owner, I want Requirements-gate Electron matrix and sim T1 left as owners of their state assertions, so that overlay UI e2e is additive.
18. As an implementer, I want a new npm script `e2e:sd-overlay-interview`, so that the entrypoint is obvious.
19. As an implementer, I want reuse of throwaway `userData` + `NATIVELY_E2E=1` patterns from gate/profile sims, so that we do not invent a third boot dialect.
20. As an implementer, I want Technical Interview mode selected before injects, so that SdSessionAuthority / gate arming can engage.
21. As an implementer, I want Advance clicks to go through the real strip button (`sdRequirementsUiAdvance`), so that the UI advance channel is covered.
22. As an implementer, I want fixtures aligned with existing SD gate / sim scenarios where possible, so that checklist fill language stays consistent.
23. As a QA engineer, I want clear pass/fail on the four core UI assertions, so that failures point at chrome vs LLM vs inject.
24. As a QA engineer, I want logs/screenshots on failure (Playwright artifacts), so that schedule flakes are debuggable.
25. As a product owner, I want clarifier/authority strip publish on `general_meeting_answer` as stretch/follow-on, so that v1 stays the core matrix.
26. As a product owner, I want no ~32-turn UI DF marathon in this family, so that cost and flake stay bounded.
27. As a product owner, I want no STT/mic path in v1, so that audio permissions do not block the harness.
28. As a product owner, I want no shortcuts cheat-sheet coverage in this family, so that scope stays SD gate chrome.
29. As a product owner, I want no in-product corpus browser, so that sim PRD non-goals hold.
30. As a support/debug reader, I want env docs for `GEMINI_API_KEY` (or product key env) + `RUN_SD_OVERLAY_INTERVIEW=1`, so that operators know how to fire the job.
31. As an implementer, I want the harness not to extend `benchmark-sd-grounding` as the runner, so that prior art locks hold.
32. As an implementer, I want LESSON ingest optional/opt-in for this short matrix (default off or minimal), so that v1 does not depend on LESSON corpus presence.
33. As a workflow owner, I want candidate-led T2 behavior **not** required in this live-product UI path, so that product always-reactive semantics stay.
34. As a CI owner, I want secrets only on schedule runners, so that keys never leak into PR contexts.
35. As a future maintainer, I want the family name `sd-overlay-interview` distinct from `sd-interview-sim` and `interview-simulator`, so that naming collisions stop.

## Implementation Decisions

- **Family:** New additive `scripts/e2e/sd-overlay-interview.mjs` (or equivalent) + `npm run e2e:sd-overlay-interview`. Do not replace gate e2e, sim T1/T2, or Profile simulator.
- **Driver:** Playwright `_electron` launch (profile-sim prior art) + `__e2e__` inject/ask hooks + real DOM click on Advance.
- **LLM:** **Live by default** — real API key and product model path. Skip (exit 0) if key missing. Stub only behind explicit local debug env.
- **Scenario (core UI matrix):**
  1. Strip visible while gated
  2. Premature Advance → soft-refuse visible (expand if product does so)
  3. Inject fill turns → Advance → strip hidden
  4. One post-gate probe → answer chrome present
- **Testids:** Add stable `data-testid`s on gate strip root, Advance button, and primary answer/message surface.
- **CI:** Schedule / workflow_dispatch only; never `pull_request`. Not a dual-agent oracle.
- **Caps:** Bound turns to matrix length; optional USD/time budget; always capture Playwright artifacts on failure.
- **Mode:** Technical Interview; meeting/overlay path required.
- **Stretch (out of v1 acceptance):** authority clarifier strip publish; LESSON-heavy deep dive; STT.
- **Seams (approved via grill + “go”):**
  1. Primary — Playwright `_electron` scenario asserting overlay DOM contracts
  2. Supporting — `data-testid` hooks on strip/Advance/answer chrome
  3. Driver — `__e2e__` inject + live WTA/IE path (no stub stream)

## Testing Decisions

- **Good tests** assert visible overlay behavior (strip presence/absence, Advance outcomes, answer chrome), not private React internals or headless prepare-only outcomes (those stay gate Tier0 / Electron matrix).
- **Primary seam:** Playwright `_electron` core matrix with live LLM.
- **Prefactor:** testids before brittle selectors.
- **Prior art:** `scripts/e2e/interview-simulator.mjs` (`_electron` + `__e2e__`); `e2e-sd-requirements-gate.js` (throwaway userData, fixtures); SPEC 17 strip mount in `NativelyInterface`.
- **Non-goals for tests:** pixel-perfect visuals; 32-turn DF; mic STT; T2 corpus export from this job.

## Out of Scope

- Replacing T0/T1/T2 families or making dual-agent a CI oracle
- Live STT / mic / system audio path
- ~32-turn UI Delivery Framework marathon
- Merging with Profile `interview-simulator`
- Keyboard shortcuts cheat-sheet e2e
- In-product sim corpus browser
- Extending `benchmark-sd-grounding` as this runner
- Candidate-led sim-only interviewer behavior on the product UI path
- PR CI for this live harness

## Further Notes

- Grill locks (incl. live-LLM amendment) live in `_workspace/grill-with-docs/00_memory.md` and `01_question_log.md`.
- Keep vocabulary: Technical Interview, Requirements gate, gate status strip, UI Advance, SUT, T0/T1/T2 hard split.
- After tickets: implement blockers-first with fresh context per ticket.
