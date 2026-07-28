# 06 — Tier 0 matrix green + optional T2 smoke

**What to build:** The full SdSessionAuthority acceptance matrix from the PRD is green at Tier 0 (prepare, WTA enforcement, product strip, overlay). Optionally run one T2 FULL_RAW smoke afterward to confirm no late `candidate_rewind` without relying on pin-only strip.

**Blocked by:** 01 — Authority derive + prepare arming on GM; 02 — WTA phase contract + structural hard-block under authority; 03 — Product post-requirements draft strip under sessionOpen; 04 — Overlay publishes from authority  
(05 may complete in parallel and is not a hard blocker for Tier 0 matrix.)

**Status:** done

**Parent:** [PRD — SdSessionAuthority](../PRD.md)

**Evidence:** [TIER0-MATRIX.md](../TIER0-MATRIX.md)

- [x] Tier 0: TI + open artifact + GM → prepare stamps `sdPhase` and evaluates advance/soft-refuse
- [x] Tier 0: same GM plan does not arm LESSON
- [x] Tier 0: no `problemKey` / non-TI → inert
- [x] Tier 0: product strip under session open without pin when post-requirements or checklist-complete
- [x] Tier 0: overlay shown under authority on GM; hidden when inert
- [x] Prior SD-typed prepare/gate Tier 0 suites still pass
- [x] Optional: one T2 FULL_RAW smoke with digest free of `candidate_rewind` (pin may seed, strip must not depend on pin alone) — **deferred** (optional; see matrix note)
- [x] Brief note in issue comments or scratch where smoke artifact paths live if run — see `TIER0-MATRIX.md`
