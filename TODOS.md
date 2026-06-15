# TODOs

## OpenOffer Follow-ups

- [ ] Internal namespace cleanup after OpenOffer v0.1 hard-delete lands.
  - What: rename remaining internal Natively-era filenames, comments, localStorage keys, logs, DB names, and non-user-visible symbols to OpenOffer equivalents where it is safe.
  - Why: the v0.1 fork should first remove public Natively API/Pro/paywall behavior; after that is stable, mixed internal naming will mislead future contributors and make it easier to reintroduce old product assumptions.
  - Pros: cleaner contributor mental model, fewer stale brand references, easier future documentation and onboarding.
  - Cons: high merge-conflict risk if bundled with the hard-delete branch; some internal naming debt remains temporarily.
  - Context: approved in `/plan-eng-review` as a follow-up, not part of the first hard-delete implementation. Start with `rg "Natively|natively|Natively API|Natively Pro|Premium|trial|license"` and separate user-visible leftovers from purely internal compatibility keys.
  - Depends on / blocked by: OpenOffer v0.1 public rebrand and commercial hard-delete passing build, tests, and local app smoke.
