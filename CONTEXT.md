# Natively Cluely Fork — Commercial Surface Strip

Glossary for stripping trial, donation, upsell, and engagement chrome from the personal fork while keeping Pro unlock and BYOK.

## Language

### Monetization surfaces

**Commercial surface strip**:
Removal of donation, trial UI, checkout/upsell, and engagement (ads/reviews) chrome from the fork, plus hard-disable of trial backend so a live trial cannot start, phone home, or wipe profile data.
_Avoid_: Paid-feature removal (that meant deleting Pro capabilities), rebrand, gate re-enable

**Donation cluster**:
Tip/support asks: SupportToaster, Buy Me a Coffee links, About/FeatureSpotlight support CTAs, DonationManager cadence.
_Avoid_: Support (ambiguous with customer support), tip jar alone

**Trial UI**:
Visible free-trial chrome: banners, modals, promo toasters, trial status cards in settings.
_Avoid_: Trial (alone — ambiguous with trial backend)

**Trial backend hard-disable**:
Making trial non-startable: no `trial:start` to Natively APIs, no `TRIAL_SENTINEL_KEY` LLM/STT routing, no `trial:end-byok` profile wipe; delete or stub IPC to safe inactive no-ops.
_Avoid_: UI-only trial removal, dead but callable trial IPC

**Checkout/upsell**:
Dodo/Gumroad plan cards, Unlock/Get Pro CTAs, quota upgrade banners, INSIDER20 and billing-portal marketing.
_Avoid_: Natively API settings (that phrase often means BYOK keys + upsell mixed together)

**Engagement cluster**:
Orchestrator ads/`review_prompt` stages, in-app review modal/host, and ReviewService posts to Natively reviews API.
_Avoid_: Harmless prompts, optional polish

### Entitlements (fork policy)

**License bypass**:
Unconditional Pro unlock already in tree (`isProOrTrialActive` / `isPremiumAvailable` → true). The strip keeps this; it does not reintroduce a paywall or require the premium submodule.
_Avoid_: License gate (implies checking), trial unlock path

**BYOK**:
User-supplied provider API keys in settings — kept under a non-upsell settings surface after Pro/trial/Dodo marketing is gutted.
_Avoid_: Natively managed subscription, Codex plan

**Client Pro gate align**:
UI access matches backend bypass: no Unlock Pro / PremiumUpgradeModal; no greyscale “Requires Pro” for features the fork already unlocks.
_Avoid_: Client premium check (as a product requirement)

### Identity / non-goals

**Natively identity kept**:
Product name, tray, and in-app “Natively” branding stay; full rebrand is a separate effort.
_Avoid_: Strip branding (when meaning only commercial asks)

**skip-premium**:
Do not init/checkout the private `natively-premium` submodule; empty premium UI stubs stay no-ops.
_Avoid_: Wire premium for CI green

## Flagged ambiguities

**premium**:
Overloaded across monetization (`isPremium`), empty `premium/` submodule, FeatureSpotlight slide type, and `ModesManager.isPremiumKnowledgeInterceptAllowed` (mode-template compatibility — **not** a license gate). Strip work must not treat mode-template “premium intercept” as commercial chrome.

**Natively API settings**:
Historically mixes BYOK key config with free-trial start and Dodo checkout. After strip: keep key/provider config; remove trial/checkout marketing.

## Example dialogue

Dev: “Should we delete the whole Natively API settings tab?”  
Expert: “No — that’s where **BYOK** lives. Gut the **checkout/upsell** and **trial UI** from it; keep key entry.”  

Dev: “Trial banners are gone — are we done?”  
Expert: “Not until **trial backend hard-disable** — otherwise `trial:start` can still phone home and wipe profile.”  

Dev: “Also rename the app while we’re here?”  
Expert: “Out of scope — **Natively identity kept**. Separate rebrand.”  

Dev: “Do we need the license gate back so OSS Pro isn’t free?”  
Expert: “No — keep **license bypass**. This is a **commercial surface strip**, not a paid-feature removal.”
