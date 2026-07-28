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

### FAIL (pre-fix) — 2026-07-28

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

### Root cause (diagnosing-bugs)

Tight loop: `npm run build:electron && node .scratch/sd-session-authority/debug/repro-candidate-rewind-loop.mjs`
(default corpus: latest FAIL run; override with `CORPUS=…`)

1. Sim pin never seeded sticky `problemKey` → prepare/strip stayed inert on GM turns.
2. Markdown FR extractor required `**URL Shortening:**` — FULL_RAW often uses `**Shorten:**` / block-after-heading → FR never filled.
3. Latency/scale extractors missed `ideally under 100ms` / `millions of requests per day`.
4. Kafka mid-flight escalated `problemClass` → `isChecklistComplete` waited on `data_flow_stages` → strip never armed despite FR/NFR filled.

**Fix:** pin seed on prepare; broader FR/latency/scale extractors; strip arms on `isCoreRequirementsComplete` (FR/scale/latency/CAP).

Offline corpus replay (04a5ef62 + 1506ae32): **PASS** (no `candidate_rewind`).

### Re-verify smoke — PASS (2026-07-28)

Same knobs as FAIL run (INGEST_LESSONS=0, MAX_TURNS=32).

| Field | Value |
|-------|--------|
| run_id | `7b83f0be-6eae-421c-8b2e-e584d8eb6fa2` |
| digest | `traces/sd-interview-sim/t2-7b83f0be-….digest.md` |
| end_reason | `max_turns` (32) / ≈$0.033 |
| tags | `ascii_hld_present`, `full_raw` |
| Verdict | **PASS** — no `candidate_rewind` |

Interim FAIL while iterating extractors: `1506ae32-…` (still `candidate_rewind`; used as tighter default corpus for the offline loop).
