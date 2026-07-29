# 04 — Overlay publishes from authority

**What to build:** The Requirements gate overlay stays visible/accurate on Technical Interview clarifier turns when a session is open, instead of hiding solely because the planner emitted `general_meeting_answer`.

**Blocked by:** 01 — Authority derive + prepare arming on GM

**Status:** done

**Parent:** [PRD — SdSessionAuthority](../PRD.md)

- [x] Overlay publish/hide follows `shouldArmGate` (or TI + session open), not “non-SD answerType ⇒ hide”
- [x] Non-TI or session-closed turns still hide/inert the overlay
- [x] Tier 0 or existing overlay projection assertions cover GM + open session → shown; non-TI → hidden

## Comments

Verified on main: overlay suite inside `SdSessionAuthorityPrepareArmingTier0.test.mjs` (4/4).
