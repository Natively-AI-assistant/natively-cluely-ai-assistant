# 02 — Donation cluster strip

**What to build:** Remove all donation / tip / support-us asks. Cold start and About/launcher never show Buy Me a Coffee, SupportToaster, or star-repo donation marketing; donation cadence can no longer schedule those prompts.

**Blocked by:** None — can start immediately.

**Surfaces:** electron (DonationManager/IPC), ui (SupportToaster, About, FeatureSpotlight), onboarding (`support` stage)

**FE can start?:** yes (local-only; no upstream contract)

**Status:** done

**Parent:** [PRD — Commercial surface strip](../PRD.md)

- [x] SupportToaster (or equivalent) never mounts / never schedules
- [x] About and launcher spotlight have no Buy Me a Coffee / support-us / star-donation CTAs
- [x] Donation IPC / DonationManager no longer drive product UI (removed or inert)
- [x] Orchestrator `support` stage removed or permanently skipped
- [x] Support-us / star-repo i18n used only for those CTAs is removed with call sites
- [x] Test or walkthrough assertion: donation chrome absent
