# 02 — WTA phase contract + structural hard-block under authority

**What to build:** After authority stamps phase on clarifier turns, What-To-Answer applies the Requirements phase prompt contract and Delivery Framework structural hard-block while gated — even when `answerType` is `general_meeting_answer`. LESSON allowlist / deep-dive retrieval stay off unless the plan is `system_design_answer`.

**Blocked by:** 01 — Authority derive + prepare arming on GM

**Status:** done

**Parent:** [PRD — SdSessionAuthority](../PRD.md)

- [x] While `shouldArmGate` and `sdPhase=requirements`, clarifier (GM) answers get phase contract + structural DF heading hard-block (regenerate or soft-truncate)
- [x] While post-requirements under authority, structural Requirements-only hard-block is not left incorrectly active
- [x] LESSON allowlist / SD deep-dive retrieval path remains gated on `system_design_answer` (no LESSON arming on GM)
- [x] Deep-dive pack/merge enqueue remains answerType-gated (unchanged; SdTurnContinuation still out of scope)
- [x] Tier 0 WTA stub-LLM / gate suite asserts GM + stamped phase hard-block, and LESSON absent on GM

## Comments

Verified on main: `SdSessionAuthorityWtaPhaseStructuralTier0.test.mjs` (5/5).
