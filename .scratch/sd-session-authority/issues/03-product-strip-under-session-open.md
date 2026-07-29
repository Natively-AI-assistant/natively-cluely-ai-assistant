# 03 — Product post-requirements draft strip under sessionOpen

**What to build:** On the product path (no sim pin required), once an SD session is open, late Requirements Draft / FR-NFR restatements are stripped when phase is post-requirements **or** the checklist is complete — including on `general_meeting_answer` clarifier turns. Soft post-requirements nudge stays sim-only.

**Blocked by:** 01 — Authority derive + prepare arming on GM

**Status:** done

**Parent:** [PRD — SdSessionAuthority](../PRD.md)

- [x] Draft strip arms when session open and (`sdPhase=post_requirements` OR checklist complete), without requiring `sdProblemKey` pin
- [x] Strip applies on GM clarifier turns under authority (product path)
- [x] Soft nudge remains sim-only / pin-seeded behavior unchanged for product
- [x] Sim pin may still seed sticky identity early but is not required for strip once session open
- [x] Tier 0 strip tests cover product (no-pin) success path; prior pin-based cases still pass or are reframed as seed adapters

## Comments

Verified on main: `SimPostRequirementsAnswerStripTier0.test.mjs` (14/14), including product no-pin paths.
