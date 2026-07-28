# PRD — SdSessionAuthority

**Status:** ready-for-agent  
**Feature slug:** `sd-session-authority`  
**Parent arcs:** SD Requirements Grilling Gate (SPEC 03) · SD interview sim rewind stack (SPECs 12–17)  
**Grill source:** `_workspace/grill-with-docs/01_question_log.md` (2026-07-28, 10/10 verified)  
**Audience:** `/to-tickets` then `/implement` (do not re-litigate locked grill decisions without a new grill)

---

## Problem Statement

In Technical Interview system-design meetings, the Requirements grilling gate and post-requirements draft strip often fail on interviewer clarifier turns. Those probes routinely plan as `general_meeting_answer`, while gate prepare, `sdPhase` stamping, structural hard-block, and strip arming all still require `answerType === system_design_answer`. The durable Requirements artifact already knows the sticky problem and phase, but per-turn planner typing drops the gate path — so checklist fill, mic advance, overlay, and “don’t paste Requirements Draft mid deep-dive” enforcement go dark until a later true SD-typed turn (or a sim-only pin/strip stack). Candidates and T2 corpus both see late Requirements restatements and stalled gate progress on ordinary clarifiers.

## Solution

Introduce **SdSessionAuthority**: a session-scoped decision that arms gate prepare, phase stamp, structural enforcement, and post-requirements draft strip from **durable artifact + Technical Interview mode**, not from per-turn `answerType`. A session is open only after a sticky `problemKey` was established by a prior `system_design_answer` prepare; clarifiers never open a session. LESSON retrieval and deep-dive context pack/merge stay keyed on `system_design_answer` only. Product path gains strip-under-session-open (SPEC 16/17 semantics without requiring `sdProblemKey` pin); pin remains a sim/test seed. Leaving TI makes authority inert immediately but freezes the working artifact until meeting end or new-SD-problem reset.

## User Stories

1. As a candidate in Technical Interview after an SD problem was prepared, I want clarifier turns to still run Requirements prepare, so that checklist fill continues while the interviewer asks scope questions.
2. As a candidate on a clarifier turn, I want `sdPhase` stamped from the durable artifact onto the answer plan, so that phase-aware prompting and structural checks still apply.
3. As a candidate while the gate is open (`sdPhase=requirements`), I want structural Delivery Framework hard-block on clarifier answers, so that Core Entities → Deep Dives cannot leak just because the planner said `general_meeting_answer`.
4. As a candidate after Requirements are done, I want post-requirements draft strip on clarifier answers in the **product** path, so that late `**Requirements Draft:**` / FR-NFR restatements are cut without needing a sim pin.
5. As a candidate, I want LESSON retrieval to stay inert on `general_meeting_answer` clarifiers, so that authority does not turn every scope question into a full SD LESSON answer.
6. As a candidate, I want deep-dive context pack and post-answer sheet merge to stay inert on clarifier turns, so that extract/merge only runs on true `system_design_answer` turns.
7. As a session, I want session-open to mean “artifact already has sticky `problemKey` from a prior SD prepare,” so that a lone clarifier never creates a ghost SD session.
8. As a session, I want sticky `problemKey` to survive clarifier utterances, so that clarifiers do not look like new SD problems and wipe the sheet.
9. As a session, I want authority to go inert when leaving Technical Interview mode, so that coding/DSA/behavioral modes do not run Requirements gate machinery.
10. As a session, I want the Requirements artifact frozen (not cleared) when leaving TI mid-meeting, so that re-entering TI can resume the same sticky problem.
11. As a session, I want the live artifact cleared on meeting end (existing durable-storage rules), so that meetings do not contaminate each other.
12. As a session, I want new-SD-problem reset to clear/replace sticky identity and re-open the gate, so that problem B does not inherit problem A’s post-gate freedom.
13. As a candidate before any SD prepare, I want non-SD answer types to stay fully gate-inert, so that unrelated meeting chatter does not arm Requirements.
14. As a candidate on a coding or behavioral turn (even mid-meeting), I want Requirements gate arming to stay inert when mode is not TI or session is not open, so that other answer paths are unchanged.
15. As a candidate using mic/UI Advance during a clarifier, I want prepare to evaluate advance and soft-refuse under authority, so that gate close is not blocked on planner typing.
16. As a candidate while checklist is already complete but advance is not accepted, I want full prepare (not a lighter fork) on authority turns, so that fill/advance/soft-refuse stay one path.
17. As an implementer, I want a small per-turn authority decision `{ sessionOpen, shouldArmGate, sdPhase, problemKey }`, so that IE, WTA, and overlay share one derivation.
18. As an implementer, I want `shouldArmGate` true only when TI mode and session open, so that callers do not re-encode answerType early-returns.
19. As an implementer, I want prepare to run whenever `shouldArmGate`, replacing `answerType === system_design_answer` as the prepare entry guard.
20. As an implementer, I want WTA phase contract / structural gate / strip to arm from session authority + stamped `sdPhase`, so that GM plans are not skipped.
21. As an implementer, I want WTA LESSON allowlist and deep-dive post-gate pack injection to keep requiring `system_design_answer`, so that routing/LESSON stay typed.
22. As an implementer, I want overlay gate status to publish from authority (not “hide on non-SD answerType”), so that clarifier turns still show gate UI when session is open.
23. As a T2 sim operator, I want `sdProblemKey` pin to remain a seed/test adapter, so that early sticky identity can still be forced in harness without being the product authority model.
24. As a T2 sim operator, I want soft post-requirements nudge to stay sim-only, so that product prompting is not changed by this work.
25. As a T2 sim operator, I want candidate-led showcase dynamics to remain sim-only, so that this authority work does not reopen live always-reactive deep-dive product behavior.
26. As a QA engineer, I want Tier 0 coverage that TI + open artifact + `general_meeting_answer` stamps `sdPhase` and runs prepare, so that the clarifier miss cannot regress silently.
27. As a QA engineer, I want Tier 0 coverage that the same GM plan does **not** arm LESSON, so that the LESSON carve-out is locked.
28. As a QA engineer, I want Tier 0 coverage that no `problemKey` / non-TI stays inert, so that SPEC 03’s intent for unrelated turns survives the reopen.
29. As a QA engineer, I want Tier 0 coverage that product strip runs under session open without pin when post-requirements or checklist-complete, so that SPECs 16–17 generalize beyond sim.
30. As a QA engineer, I want existing SD-typed prepare/gate Tier 0 suites to keep passing, so that representation D and enforcement C remain intact.
31. As a product owner, I want SPEC 03 “non-SD inert” amended to “inert unless SdSessionAuthority says session open,” so that docs match the shipped seam.
32. As a support/debug reader, I want authority fields inspectable alongside artifact phase, so that “why did this clarifier skip the gate?” is answerable.
33. As a candidate after gate close, I want post-requirements clarifiers to remain under authority for strip and sticky identity, so that rewind drafts die even when planner typing is GM.
34. As an implementer, I want SdOutputPolicy and SdTurnContinuation deferred, so that this PRD stays a single deepening of arming ownership.
35. As an implementer, I want AnswerPlanner fallthrough to `general_meeting_answer` for clarifiers left unchanged, so we do not fake SD typing to satisfy the old guard.

## Implementation Decisions

- **Module:** SdSessionAuthority — pure (or near-pure) per-turn derivation consumed by IntelligenceEngine orchestration; not a new answer type; not ModesManager SoT.
- **Interface (locked shape):** `{ sessionOpen, shouldArmGate, sdPhase, problemKey }` derived from durable Requirements artifact + active mode id + (optionally) plan answerType for LESSON consumers only.
  - `sessionOpen` = artifact has sticky `problemKey` from prior SD prepare.
  - `shouldArmGate` = Technical Interview mode **and** `sessionOpen`.
  - `sdPhase` = `deriveSdPhase(artifact)` when session open; otherwise unset/inert.
  - `problemKey` = sticky artifact key (sim pin may seed normalize on first prepare; not required thereafter).
- **Prepare entry:** Replace answerType early-return with `shouldArmGate`. When armed, full prepare: classify/fill (including existing channels), advance/soft-refuse, stamp `sdPhase` / grill fields on the plan.
- **Session open establishment:** Only a successful prepare path on `system_design_answer` (first SD problem detection) establishes sticky `problemKey`. Clarifier/`general_meeting_answer` alone never opens.
- **WTA:** Arm phase prompt contract, structural hard-block, and post-requirements strip from authority + stamped phase. Keep LESSON allowlist / deep-dive-gated retrieval on `system_design_answer` only.
- **Product strip:** Generalize SPEC 16/17 semantics — strip late Requirements drafts when session open and (`sdPhase === post_requirements` OR checklist complete). Do not require `sdProblemKey` pin on product. Soft nudge remains sim-only.
- **Deep-dive pack/merge:** Unchanged answerType guards; no extract/merge enqueue on GM authority turns (SdTurnContinuation out of scope).
- **Leave TI:** Authority inert immediately; freeze SessionTracker working copy (do not clear). Clear live artifact on meeting end per existing storage rules; new-SD-problem reset still resets identity/gate.
- **Overlay:** Publish gate status when `shouldArmGate` (or session open + TI), not only when answerType is SD.
- **Sim pin:** Remains optional seed/test adapter for T2; product authority is artifact stickiness + TI.
- **SPEC 03 carve-out:** Representation D, reset B, enforcement C, gate-close rule unchanged. “Non-SD inert” narrowed: inert unless session authority open; LESSON/routing remain SD-typed.
- **No planner reclassification** of clarifiers to `system_design_answer` to satisfy old guards.
- **Do not fold** SdOutputPolicy into this module beyond the strip/hard-block behavior already owned by existing gate helpers.

## Testing Decisions

- **Good tests** assert external behavior at the highest agreed seams: given artifact + mode + planned answerType, observe prepare outputs (`sdPhase`, fills, soft-refuse), WTA enforcement effects (truncated / strip / LESSON absent), and strip results — not private call graphs.
- **Primary seam — prepare + controllable artifact (Tier 0):** Extend existing Requirements live-wiring / gate Tier 0 patterns. Cases: TI + open artifact + `general_meeting_answer` → prepare runs and stamps `sdPhase`; advance/soft-refuse evaluable; no `problemKey` → inert; non-TI → inert; `system_design_answer` path still establishes open session and passes prior suites.
- **Secondary seam — WTA stub LLM (Tier 0):** With stamped phase + session-open signal, structural hard-block / strip apply on GM plans; LESSON allowlist path remains off without `system_design_answer`. Prefer existing `SdRequirementsGateTier0` / strip Tier 0 style.
- **Thin authority helper:** If extracted, unit-test derivation table (`sessionOpen` / `shouldArmGate`) only; do not invent a second integration stack.
- **Prior art:** `SdRequirementsGateTier0.test.mjs`, `SdRequirementsGateLiveWiring.test.mjs`, `SimPostRequirementsAnswerStripTier0.test.mjs` (load-bearing clarifier→GM case becomes the success path under authority).
- **T2 FULL_RAW:** Optional smoke after Tier 0 green; not the primary acceptance seam. Expect `candidate_rewind` to stay clear without relying on pin-only strip.
- **Do not** require e2e Electron UI for the first green bar; overlay can be Tier 0 projection assertions if a projector seam already exists.

## Approved test seams

1. Prepare + controllable artifact (Tier 0) — primary  
2. WTA enforcement with stub LLM (Tier 0) — secondary  
3. Thin authority derive helper — only if needed to keep (1)–(2) honest  
4. Explicitly not in-scope seams: deep-dive pack/merge, sim nudge, T2 as gate

## Out of Scope

- SdOutputPolicy as a separate deepened module (beyond using existing strip/hard-block helpers under authority)
- SdTurnContinuation (pack/merge on clarifier turns)
- Reclassifying clarifiers as `system_design_answer` in AnswerPlanner
- Changing LESSON corpus, ingest, or allowlist contents
- Candidate-led interviewer-agent policy / live always-reactive deep-dive product behavior
- Soft post-requirements prompt nudge on product
- New sensors, UI for checklist editing, or ModesManager as artifact home
- Overnight T2 corpus expansion as a requirement for merge

## Further Notes

- Grill locks (do not reopen casually): Q1–Q10 in `_workspace/grill-with-docs/01_question_log.md`.
- Architecture review top pick was SdSessionAuthority; SPECs 12–17 rewind arc stays parked green — this PRD replaces compensatory pin-coupling with session ownership on product.
- SPEC 03 / SPEC 09 wording amendments (non-SD inert carve-out; freeze-on-leave-TI) should be noted in tickets or a follow-up docs ticket; behavior in this PRD is authoritative for implementers.
- Tickets: `.scratch/sd-session-authority/issues/01`–`06` (all `ready-for-agent`). Frontier: start at **01**.
