# 02 — Overlay interview harness boot (`_electron` + `__e2e__` + live key)

**What to build:** New additive entrypoint that launches Electron via Playwright `_electron`, uses throwaway userData + `NATIVELY_E2E=1`, opens the meeting overlay in Technical Interview mode, and can inject transcript turns. Default path requires a real LLM API key; skip exit 0 if missing. Stub only behind explicit local debug env.

**Blocked by:** None — can start immediately (asserts land in 03/04 after testids).

**Status:** done

**Parent spec:** `.scratch/sd-overlay-interview-e2e/spec.md`

- [x] `scripts/e2e/sd-overlay-interview.mjs` (or equivalent) exists
- [x] `npm run e2e:sd-overlay-interview` wired in package.json
- [x] Boot: `_electron` + throwaway userData + `NATIVELY_E2E=1`
- [x] Overlay/meeting visible; Technical Interview mode selectable
- [x] `__e2e__` inject (and ask if needed) works against the live window
- [x] Live LLM default; skip cleanly without key; stub only via debug env
- [x] Does not replace gate e2e / sim T1 / Profile simulator / T2

## Comments

Shipped with tickets 01–05. Stub matrix + skip path verified locally.
