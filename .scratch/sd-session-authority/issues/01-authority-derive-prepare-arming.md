# 01 — Authority derive + prepare arming on GM

**What to build:** In Technical Interview, once a sticky `problemKey` exists from a prior SD prepare, clarifier turns that plan as `general_meeting_answer` still run full Requirements prepare — fill, advance/soft-refuse, and stamp `sdPhase` from the durable artifact. Turns with no sticky key, or outside TI, stay gate-inert. Session open is never created by a clarifier alone.

**Blocked by:** None — can start immediately.

**Status:** done

**Parent:** [PRD — SdSessionAuthority](../PRD.md)

- [x] Per-turn authority decision exposes `{ sessionOpen, shouldArmGate, sdPhase, problemKey }` (or equivalent) from artifact + TI mode
- [x] `shouldArmGate` replaces answerType as the prepare entry guard
- [x] TI + open artifact + `general_meeting_answer` → prepare runs, stamps `sdPhase`, evaluates fill/advance/soft-refuse
- [x] No `problemKey` → prepare stays inert for non-SD plans
- [x] Non-TI mode → prepare stays inert even if artifact still has a key
- [x] Clarifier alone never establishes sticky `problemKey` / session open
- [x] Existing `system_design_answer` prepare path still establishes sticky key and passes prior Tier 0 prepare suites
- [x] Tier 0 tests at the prepare + controllable-artifact seam cover the above
