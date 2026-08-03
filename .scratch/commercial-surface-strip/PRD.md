# PRD — Commercial surface strip (fork)

**Status:** `ready-for-agent`  
**Feature slug:** `commercial-surface-strip`  
**Grill:** `_workspace/grill-with-docs/01_question_log.md` (9/9 verified, Mode C)  
**Glossary / ADRs:** `CONTEXT.md` · `docs/adr/0001-strip-commercial-keep-bypass.md` · `docs/adr/0002-trial-backend-hard-disable.md`  
**Audience:** `/to-tickets` then `/implement` (or single-session `/implement` if sliced thin)  
**Prior art (do not re-litigate):** license bypass · `skip-premium` · `feat/pro-features-oss` · fork-only `sondo-appfolio/natively-cluely-ai-assistant`

---

## Problem Statement

On this personal fork, the app still shows Natively trial mode, donation/support asks, Pro/checkout upsells, and review/ads engagement — even though Pro is already unlocked via license bypass and the premium submodule is empty/skipped. Those surfaces are useless noise: they push Buy Me a Coffee, Dodo plans, free-trial start, and Natively review APIs. Worse, trial is not chrome-only — starting a trial can phone home to `api.natively.software` and wipe Pro-ingested profile data on BYOK end. The fork owner wants that commercial chrome and startable trial machinery gone while keeping BYOK and unlocked Pro features.

## Solution

Ship a **commercial surface strip**:

1. Remove **donation**, **trial UI**, **checkout/upsell**, and **engagement** (ads + in-app review) chrome from cold start, launcher, about, settings, and onboarding orchestrator stages.
2. **Hard-disable trial backend** so trial cannot start, route via `TRIAL_SENTINEL_KEY`, or wipe profile (`trial:end-byok`).
3. **Keep license bypass** and OSS Pro capabilities; **keep BYOK** under a non-upsell settings surface.
4. **Keep Natively product identity** (name/tray); full rebrand is out of scope.

Success = cold start + settings walkthrough with no commercial asks; trial IPC cannot start a live trial or wipe; Pro/OSS + BYOK still work; still named Natively.

## User Stories

1. As a fork user, I want no free-trial banner or countdown on launch, so that I am not nudged toward Natively checkout.
2. As a fork user, I want no free-trial modal when a trial would have ended, so that expired-trial upsell never appears.
3. As a fork user, I want no “start free trial” promo toaster during onboarding, so that onboarding is product-only.
4. As a fork user, I want no Support / Buy Me a Coffee toaster, so that I am not asked to donate.
5. As a fork user, I want About and launcher spotlight free of star-repo / support-us / tip links, so that those surfaces describe the product only.
6. As a fork user, I want no quota-upgrade banner linking to Dodo, so that usage chrome does not become an upsell.
7. As a fork user, I want no Unlock Pro / Get Pro / Upgrade CTAs in Profile Intelligence or settings, so that already-unlocked features are not greyscaled behind a paywall story.
8. As a fork user, I want no PremiumUpgradeModal, so that upgrade flows cannot open.
9. As a fork user, I want settings free of Dodo plan cards, INSIDER20 coupons, and billing-portal marketing, so that settings are configuration not storefront.
10. As a fork user, I want to still enter and use my own provider API keys (BYOK), so that the assistant keeps working without Natively subscription.
11. As a fork user, I want Pro/OSS capabilities that the bypass already unlocks to remain available, so that the strip does not delete interview/profile features.
12. As a fork user, I want no in-app review / testimonial prompt, so that the app does not phone home for ratings.
13. As a fork user, I want no ads orchestrator stage, so that promo campaigns never schedule.
14. As a fork user, I want the product to still be named Natively in tray and chrome, so that this change is not a rebrand.
15. As a fork user, I want starting a trial to be impossible, so that no accidental call to Natively trial APIs occurs.
16. As a fork user, I want LLM/STT paths never to authenticate with a trial sentinel key, so that traffic does not depend on Natively trial tokens.
17. As a fork user, I want no trial-end wipe of Pro SQLite/OKF profile data, so that ending “trial” cannot destroy local knowledge.
18. As a fork user, I want donation cadence state to stop driving toasters, so that DonationManager cannot resurrect support UI.
19. As an implementer, I want license bypass left in place, so that we do not reintroduce `pro_required` as a product gate.
20. As an implementer, I want the premium submodule left skipped/empty, so that we do not violate `skip-premium`.
21. As an implementer, I want mode-template `isPremiumKnowledgeInterceptAllowed` left alone, so that monetization strip does not break mode gating.
22. As an implementer, I want unused checkout URL / `PREMIUM_ENABLED` cosmetics removed or stopped shipping if they only served upsells, so that dead kill-switches do not imply a feature flag story.
23. As an implementer, I want E2E fixtures that plant fake trial tokens updated or removed, so that tests do not require trial credential shape.
24. As a QA engineer, I want a cold-start walkthrough with no trial/donation/upsell/review/ads chrome, so that strip completeness is observable.
25. As a QA engineer, I want proof that trial IPC returns inactive / no-op and cannot wipe profile, so that ADR 0002 holds.
26. As a QA engineer, I want proof that BYOK settings still accept and persist a provider key, so that settings gutting did not delete keys.
27. As a QA engineer, I want proof that a previously gated Pro UI surface opens without Unlock Pro, so that client gates align with bypass.
28. As a product owner, I want product rename explicitly out of scope, so that identity work does not block the strip.
29. As a product owner, I want restoring paywall or premium submodule explicitly out of scope, so that agents do not “fix” unlock.
30. As a map owner, I want this PRD status `ready-for-agent`, so that `/to-tickets` or `/implement` can proceed without re-grilling.

## Implementation Decisions

### Primary seam — commercial chrome host
- App + onboarding orchestrator must not mount or schedule: FreeTrialBanner/Modal, TrialPromoToaster, SupportToaster, NativelyQuotaBanner upgrade CTA, PremiumUpgradeModal / Unlock Pro CTAs, ads stage, review_prompt stage / ReviewPromptHost.
- AboutSection and FeatureSpotlight lose support/donation/premium-upsell slides and Buy Me a Coffee / star-marketing CTAs.
- Orchestrator user-state predicates that only exist to gate `trial_promo` / `support` / `ads` / `review_prompt` are removed or permanently skip those stages.
- i18n strings used solely for support-us / star-repo marketing can be deleted with their call sites.

### Secondary seam — trial entitlement IPC
- Electron trial IPC (`trial:start`, convert, end-byok wipe, status that implies an active Natively trial) is deleted or stubbed to safe inactive no-ops (ADR 0002).
- No live HTTP to `api.natively.software` trial endpoints from those handlers.
- `TRIAL_SENTINEL_KEY` must not route LLM/STT/search as an active auth mode; remove or inert the sentinel branch.
- Credentials fields for trial token/expiry/claimed may be cleared/ignored; do not wipe unrelated user keys.
- Donation IPC + DonationManager can be removed with the donation cluster (local store only; no payment network).

### Tertiary seam — settings without upsell
- Gut Natively Pro / API settings monetization: Dodo plan cards, free-trial start card, INSIDER20, customer portal / billing marketing, “try free trial first” copy.
- Keep BYOK / provider API-key configuration on a non-upsell settings surface (rename or fold into existing keys/providers UI as needed).
- Remove Settings nav that exists only as a Pro storefront tab if nothing non-marketing remains; if BYOK lived there, preserve the keys path.
- Client checks that gate access on `isPremium || isTrialActive` solely for upsell must be removed or forced available to match license bypass (ADR 0001).

### Explicit non-changes
- Do not rename `productName` / tray “Natively” (Natively identity kept).
- Do not init or restore `natively-premium` submodule (`skip-premium`).
- Do not flip `isProOrTrialActive` / `isPremiumAvailable` back to real checks.
- Do not change BYOK provider semantics beyond removing upsell adjacent to it.
- Do not treat `ModesManager.isPremiumKnowledgeInterceptAllowed` as monetization.
- License IPC soft-fail without LicenseManager may remain inert; do not build a new storefront on it.

### Removal clusters (work breakdown hint for `/to-tickets`)
1. Donation cluster  
2. Trial UI + App wiring  
3. Trial backend hard-disable (IPC/sentinel/wipe)  
4. Checkout/upsell + client Unlock Pro gates  
5. Engagement (ads + ReviewService/modal)  
6. Leftover kill-switches + E2E trial fixtures  

## Testing Decisions

- Good tests assert **external behavior**: chrome absent; IPC inactive/no wipe; BYOK still works; Pro UI opens without upsell — not private component tree snapshots alone.
- Prefer highest seams: (1) chrome host cold-start/settings walkthrough, (2) trial IPC contract, (3) settings BYOK persist + no checkout CTAs.
- Deterministic **`/tdd`** only — this is not an LLM/eval seam; do not add `/llm-eval` goldens for the strip.
- Prior art: existing trial IPC redaction tests (retarget or delete); electron IPC handler tests; component tests that currently assume trial/donation stages (update to expect skip/absence); any E2E that plants `__e2e__` trial tokens must be rewritten.

## Out of Scope

- Full product rebrand / publisher / `appId` / TCC packaging identity
- Restoring or checking out `natively-premium`
- Re-enabling paywall or Gumroad/Dodo license activation as a product path
- Changing core BYOK providers, STT/LLM non-trial routing, or OSS Pro feature behavior except where trial sentinel / wipe / upsell gates interfere
- Upstream PRs to `Natively-AI-assistant` (fork-only)
- Unrelated onboarding stages that are not trial/support/ads/review

## Further Notes

- Code map from grill research: `_workspace/grill-with-docs/00_code_patterns.md` (~55 product files, ~12 UI surfaces, ~6 IPC families). Treat as discovery aid; paths may drift.
- `FEATURES.PREMIUM_ENABLED` and `CHECKOUT_URLS` were unused kill-switches — delete with upsell rather than wiring a new flag unless a single fork flag is clearly cheaper than delete.
- Premium-submodule promo toasters already no-op when `premium/` is empty; do not reintroduce them.
- After `/to-tickets`, prefer tracer bullets with blocking edges: trial backend hard-disable should not land after UI-only removal without at least no-op stubs in the same release train (ADR 0002).
