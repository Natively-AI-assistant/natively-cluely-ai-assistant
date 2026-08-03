# 05 — Engagement strip (ads + review)

**What to build:** Remove in-app ads scheduling and review/testimonial prompts so the app never phones home to Natively reviews APIs or shows rating/ad toasters.

**Blocked by:** None — can start immediately.

**Surfaces:** ui (Review modal/host, ads slot), electron (ReviewService), onboarding (`ads`, `review_prompt`)

**FE can start?:** yes

**Status:** done

**Parent:** [PRD — Commercial surface strip](../PRD.md)

- [x] Orchestrator `ads` and `review_prompt` stages removed or permanently skipped
- [x] ReviewPromptHost / ReviewModal never mount for product flows
- [x] ReviewService does not post to Natively reviews API from product paths
- [x] Premium-submodule ad stubs remain no-op; do not reintroduce ads
- [x] Assertion: no review/ads chrome on cold start / onboarding
