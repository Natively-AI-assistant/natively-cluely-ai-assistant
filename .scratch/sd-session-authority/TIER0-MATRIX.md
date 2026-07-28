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

**Ran:** 2026-07-28 (post-merge verify)

```bash
RUN_SD_INTERVIEW_SIM_T2=1 \
SD_INTERVIEW_SIM_T2_FULL_RAW=1 \
SD_INTERVIEW_SIM_T2_INGEST_LESSONS=0 \
SD_INTERVIEW_SIM_T2_MAX_INTERVIEWS=1 \
SD_INTERVIEW_SIM_T2_MAX_USD=4 \
SD_INTERVIEW_SIM_T2_MAX_TURNS=32 \
SD_INTERVIEW_SIM_T2_PROMPT='Design a URL shortener like Bitly.' \
npm run sd-interview-sim:t2
```

| Field | Value |
|-------|--------|
| run_id | `04a5ef62-b276-41ff-8dc8-f34a1b7e6b88` |
| digest | `traces/sd-interview-sim/t2-04a5ef62-….digest.md` |
| end_reason | `max_turns` (32) / ≈$0.034 |
| tags | `candidate_rewind`, `full_raw` |
| Verdict | **FAIL** — late turns still contain Requirements Draft / FR lists |

Notes: LESSON ingest opted out (72-file ingest hung first attempt). Offline, strip clears drafts once artifact is requirements-done; this run never reached checklist-complete/gate-close. Also pushed `fix(sd): no-op draft strip when pin has no artifact yet`. Re-run with ingest on + `MAX_TURNS=0` toward `coverage_complete` for a fairer comparison to `t2-b7612f0a…`.
