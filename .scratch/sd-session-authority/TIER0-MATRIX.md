# SdSessionAuthority — Tier 0 acceptance matrix (ticket 06)

**Date:** 2026-07-28  
**Base:** merged tickets 01–05 on `feat/pro-features-oss`  
**Command:**

```bash
npm run build:electron && node --test \
  electron/llm/__tests__/SdSessionAuthorityPrepareArmingTier0.test.mjs \
  electron/llm/__tests__/SdSessionAuthorityWtaPhaseStructuralTier0.test.mjs \
  electron/llm/__tests__/SdSessionAuthorityLeaveTiFreezeTier0.test.mjs \
  electron/llm/__tests__/SimPostRequirementsAnswerStripTier0.test.mjs \
  electron/llm/__tests__/SdRequirementsGateTier0.test.mjs \
  electron/llm/__tests__/SdRequirementsGateLiveWiring.test.mjs
```

**Result (2026-07-28):** 96+ pass / 0 fail / 3 skipped (better-sqlite3 host ABI — pre-existing).

Post-merge fix: product strip now requires `shouldArmGate` (TI + sticky key) or sim pin — leave-TI no longer strips on a frozen artifact.

| Matrix row | Seam | Status |
|------------|------|--------|
| TI + open + GM → prepare stamps `sdPhase`, advance/soft-refuse | PrepareArmingTier0 | ✅ |
| Same GM plan does not arm LESSON | WtaPhaseStructuralTier0 | ✅ |
| No `problemKey` / non-TI → inert | PrepareArmingTier0 | ✅ |
| Product strip under session open without pin (post_requirements OR checklist complete) | SimPostRequirementsAnswerStripTier0 | ✅ |
| Leave TI → strip inert (frozen artifact retained) | SimPostRequirementsAnswerStripTier0 | ✅ |
| Overlay shown under authority on GM; hidden when inert | PrepareArmingTier0 (overlay) | ✅ |
| Prior SD-typed prepare/gate Tier 0 suites | GateTier0 + LiveWiring | ✅ |
| Leave-TI freeze (ticket 05, parallel) | LeaveTiFreezeTier0 | ✅ |

## Optional T2 FULL_RAW smoke

**Not run** in this ticket (optional per PRD; overnight FULL_RAW deferred unless explicitly requested). Strip no longer depends on pin alone — product path is covered at Tier 0 above.

When a smoke is run later, record digest / artifact paths here or under `.scratch/sd-interview-sim/debug/`.
