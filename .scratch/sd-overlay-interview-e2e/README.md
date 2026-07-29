# SD Overlay Interview UI E2E

Additive Playwright `_electron` family (`e2e:sd-overlay-interview`) that asserts
Requirements gate chrome in the real overlay. Spec: [`spec.md`](./spec.md).

**Not a T2 / dual-agent CI oracle.** This family proves overlay UI contracts
(strip / soft-refuse / Advance hide / post-gate answer chrome). It does **not**
replace Requirements-gate e2e, sim T1, Profile `interview-simulator`, or T2
headless corpus.

## Operator: run locally

```bash
# Live LLM (default) — requires a product key
npm run build && npm run build:electron
RUN_SD_OVERLAY_INTERVIEW=1 GEMINI_API_KEY=<key> npm run e2e:sd-overlay-interview

# Stub LLM — local debug only (never CI default)
SD_OVERLAY_INTERVIEW_STUB_LLM=1 npm run e2e:sd-overlay-interview
```

Builds are required so `__e2e__:arm-sd-overlay-gate` and `data-testid` hooks are
present in `dist/` + `dist-electron/`.

### Required / common env

| Env | Purpose |
|---|---|
| `RUN_SD_OVERLAY_INTERVIEW=1` | Operator / CI opt-in (set explicitly on schedule jobs) |
| `GEMINI_API_KEY` | Preferred live key (also accepts `GOOGLE_API_KEY` / `NATIVELY_API_KEY`) |
| `SD_OVERLAY_INTERVIEW_STUB_LLM=1` | Stub path — **local debug only**, not CI |
| `SD_OVERLAY_INTERVIEW_MAX_TURNS` | Turn cap (default `12`) |
| `SD_OVERLAY_INTERVIEW_MAX_MS` | Wall-clock cap (default `180000`) |
| `SD_OVERLAY_INTERVIEW_MAX_USD` | Optional estimated USD cap |

Missing live key (and stub off) → harness **skips with exit 0** (no fail-noise).

Artifacts (screenshots / traces on failure): `debug-artifacts/sd-overlay-interview/`.

## CI (schedule / workflow_dispatch only)

Job: `sd-overlay-interview-e2e` in [`.github/workflows/build-smoke.yml`](../../.github/workflows/build-smoke.yml).

| Trigger | Runs? |
|---|---|
| `schedule` (Monday 09:00 UTC) | Yes |
| `workflow_dispatch` | Yes |
| `pull_request` | **Never** (job-level `if` guard) |

Secrets (repo): `GEMINI_API_KEY` (required for a live run; missing → skip exit 0).
Optional fallback: `NATIVELY_API_KEY`.
CI always sets `RUN_SD_OVERLAY_INTERVIEW=1` on the job; stub LLM is **not** enabled.
Optional spend cap: set `SD_OVERLAY_INTERVIEW_MAX_USD` on the job env if desired.

## Stable `data-testid` hooks (ticket 01)

Presentation-only — no product behavior change. Used by the core UI matrix
(strip visible → premature Advance soft-refuse → fill + Advance hide → post-gate
answer chrome).

| `data-testid` | Element | Source |
|---|---|---|
| `sd-requirements-gate-strip` | Gate strip root (mounted while `sdPhase=requirements`) | `src/components/SdRequirementsGateStrip.tsx` |
| `sd-requirements-gate-advance` | Advance button (`sdRequirementsUiAdvance`) | `src/components/SdRequirementsGateStrip.tsx` |
| `sd-overlay-answer-panel` | Primary overlay chat / answer message surface | `src/components/NativelyInterface.tsx` (`showAnswerPanel` scroll region) |

Contract test: `node --test src/components/__tests__/sdOverlayInterviewTestids.test.mjs`
