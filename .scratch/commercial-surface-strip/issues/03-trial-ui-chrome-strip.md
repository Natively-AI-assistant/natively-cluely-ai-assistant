# 03 — Trial UI chrome strip

**What to build:** Remove visible free-trial chrome — banners, expired-trial modal, trial promo toaster, and settings trial-start cards — so the user never sees trial countdown or “start free trial” CTAs.

**Blocked by:** 01 — Trial backend hard-disable

**Surfaces:** ui (FreeTrial*, App wiring), onboarding (`trial_promo`), settings trial-start cards

**FE can start?:** yes after 01 (trial IPC inert)

**Status:** done

**Parent:** [PRD — Commercial surface strip](../PRD.md)

- [x] FreeTrialBanner never shows on launch
- [x] FreeTrialModal never shows for expired/post-trial
- [x] TrialPromoToaster / `trial_promo` stage never schedules
- [x] Settings has no “start free trial” card / trial status upsell
- [x] App no longer polls/listens for trial-ended upgrade flows
- [x] Assertion: trial UI chrome absent on cold start / settings
