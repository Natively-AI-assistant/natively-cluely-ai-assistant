# 04 — Core UI matrix: fill → Advance hide + post-gate answer chrome

**What to build:** Second half of the core UI matrix under live LLM: inject checklist-filling interviewer/candidate turns, click Advance to close gate (strip hides), then one post-gate probe produces visible answer chrome.

**Blocked by:** 03 — Core UI matrix: strip visible + premature Advance soft-refuse

**Status:** done

**Parent spec:** `.scratch/sd-overlay-interview-e2e/spec.md`

- [x] Injected turns fill required checklist slots (reuse gate/sim fixture language where possible)
- [x] UI Advance succeeds; strip no longer visible
- [x] One post-gate probe → answer chrome present (`data-testid`)
- [x] Turn count bounded to matrix (not ~32-turn DF)
- [x] Live LLM; spend/time caps respected; artifacts on failure

## Comments

- Fill language from `happy-gated-advance.json` via `__e2e__:inject-transcript` (no `__e2e__:ask` mid-gate — ask resets IM). Successful Advance uses real strip button; prepare closes gate before LLM so stub can assert strip hide. Post-gate: inject probe + DOM "What to answer?" (product path). Stub may skip post-gate chrome sub-assert with clear log if no provider feedback appears. Caps: `SD_OVERLAY_INTERVIEW_MAX_TURNS` (default 12), `_MAX_MS`, optional `_MAX_USD`.
