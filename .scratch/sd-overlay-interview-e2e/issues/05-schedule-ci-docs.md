# 05 — Schedule CI job + operator docs (never PR)

**What to build:** Wire `e2e:sd-overlay-interview` to schedule / workflow_dispatch only (same posture as T1 / gate Electron e2e), with API key secret, skip-if-no-key, and short operator docs. Never on `pull_request`. Never dual-agent oracle.

**Blocked by:** 04 — Core UI matrix: fill → Advance hide + post-gate answer chrome

**Status:** done

**Parent spec:** `.scratch/sd-overlay-interview-e2e/spec.md`

- [x] CI job on schedule and/or workflow_dispatch only
- [x] Not triggered on pull_request
- [x] Secret key configured; missing key → skip/exit 0
- [x] Docs: how to run locally + required env (`RUN_*`, key name)
- [x] Explicit comment: not a T2/dual-agent CI oracle

## Comments

- CI: `.github/workflows/build-smoke.yml` job `sd-overlay-interview-e2e` (`workflow_dispatch` / `schedule` only — never `pull_request`; job-level `if` + comment that this is **not** a T2/dual-agent oracle)
- Builds: `npm run build` + `npm run build:electron` before e2e (renderer testids + Electron entry)
- Secrets/env: `GEMINI_API_KEY` (live; skip exit 0 if missing), `RUN_SD_OVERLAY_INTERVIEW=1`, caps `SD_OVERLAY_INTERVIEW_MAX_TURNS`/`_MAX_MS`, optional `NATIVELY_API_KEY` / `SD_OVERLAY_INTERVIEW_MAX_USD`
- Artifacts: upload `debug-artifacts/sd-overlay-interview/` (`if: always()`)
- Docs: `.scratch/sd-overlay-interview-e2e/README.md` (local run + CI triggers + env table)
