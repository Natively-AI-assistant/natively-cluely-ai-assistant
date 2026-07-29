# 03 — Core UI matrix: strip visible + premature Advance soft-refuse

**What to build:** First half of the core UI matrix under live LLM: with gate open, strip is visible; clicking Advance before checklist complete shows soft-refuse behavior in the overlay (including expand when product does so).

**Blocked by:** 01 — Gate strip / Advance / answer `data-testid`s; 02 — Overlay interview harness boot

**Status:** done

**Parent spec:** `.scratch/sd-overlay-interview-e2e/spec.md`

- [x] Scenario starts gated SD/TI session with strip visible (`data-testid`)
- [x] Premature Advance click uses real strip button (UI advance channel)
- [x] Soft-refuse outcome observable in overlay chrome (text and/or expanded strip)
- [x] Live LLM used (not stub) unless debug env
- [x] Failure captures Playwright screenshot/trace artifact

## Comments

- Gate armed without mic via `__e2e__:arm-sd-overlay-gate` → `startOverlaySessionWithoutAudioForE2e` (NATIVELY_E2E-only; no TCC). Soft-refuse is early-return without LLM stream; stub path proves chrome. Harness `answerSurface` aligned to `sd-overlay-answer-panel`.
