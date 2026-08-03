# Hard-disable trial backend (not UI-only)

Trial is not chrome-only: `trial:start` hits `api.natively.software`, sets `TRIAL_SENTINEL_KEY` for LLM/STT routing, and `trial:end-byok` can wipe Pro-ingested SQLite/OKF profile data. v1 must hard-disable those paths (delete or stub IPC to safe inactive no-ops), not merely hide banners/modals.

**Status:** accepted

## Considered options

1. **UI-only removal; leave trial IPC callable** — rejected; latent phone-home and profile wipe remain.
2. **Hard-disable / remove trial backend with UI strip** (chosen) — no startable trial; no sentinel routing; no wipe path.
3. **Defer backend teardown to a follow-up PR** — rejected for v1 on this fork; wipe risk is unacceptable once trial UI is gone and users may still trigger IPC via leftover wiring or tests.

## Consequences

- E2E fixtures that plant fake trial tokens must be updated or removed so tests do not require trial credential shape.
- STT/LLM paths must not treat `__trial__` as a live auth mode after the strip.
- Donation, checkout/upsell, and engagement (ads/reviews) removal can ship in the same effort; they do not change this trial-backend rule.
