# 01 — Trial backend hard-disable

**What to build:** Make Natively free trial non-startable on the fork. Calling trial start/convert/end-byok must not hit Natively trial APIs, must not authenticate LLM/STT with a trial sentinel, and must not wipe Pro profile/SQLite/OKF data. Status reads as inactive / unavailable.

**Blocked by:** None — can start immediately.

**Surfaces:** electron (IPC, credentials, LLM/STT routing)

**FE can start?:** yes — after this ticket stubs/removes callable trial IPC (UI tickets may assume start is inert).

**Status:** done

**Parent:** [PRD — Commercial surface strip](../PRD.md) · ADR 0002

- [x] `trial:start` (and convert) cannot start a live Natively trial or set an active trial credential for LLM/STT
- [x] `trial:end-byok` (or equivalent) cannot wipe Pro-ingested profile / SQLite / OKF data
- [x] Trial status surface reports inactive / not available (no “active trial” entitlement)
- [x] `TRIAL_SENTINEL_KEY` is not a live auth path for LLM/STT/search
- [x] Automated test pins inactive/no-wipe / no-sentinel behavior at the IPC or routing seam
- [x] License bypass (`isProOrTrialActive` / `isPremiumAvailable`) remains unconditional true
