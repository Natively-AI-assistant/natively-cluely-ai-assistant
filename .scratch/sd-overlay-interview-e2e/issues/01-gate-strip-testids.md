# 01 — Gate strip / Advance / answer `data-testid`s

**What to build:** Stable `data-testid` hooks on the Requirements gate strip root, Advance button, and primary overlay answer/message chrome so Playwright can assert the core UI matrix without brittle CSS.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Parent spec:** `.scratch/sd-overlay-interview-e2e/spec.md`

- [x] Gate strip root has a documented `data-testid` (e.g. `sd-requirements-gate-strip`)
- [x] Advance control has a documented `data-testid` (e.g. `sd-requirements-gate-advance`)
- [x] Primary answer / message surface used post-gate has a documented `data-testid`
- [x] Hooks do not change product behavior (presentation-only)
- [x] Brief note in strip component or harness README listing the ids

## Comments

- Implemented: `sd-requirements-gate-strip`, `sd-requirements-gate-advance`, `sd-overlay-answer-panel`. Documented in strip header + `README.md`. Source contract: `src/components/__tests__/sdOverlayInterviewTestids.test.mjs`.
