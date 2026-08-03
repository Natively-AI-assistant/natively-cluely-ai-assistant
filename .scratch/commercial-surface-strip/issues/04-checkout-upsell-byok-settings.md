# 04 — Checkout/upsell strip + BYOK settings

**What to build:** Remove Dodo/Pro checkout, Unlock Pro / Upgrade CTAs, quota-upgrade banner, and INSIDER20/billing marketing. Keep BYOK API-key provider configuration on a non-upsell settings surface. Client gates align with license bypass (no greyscale “Requires Pro” for already-unlocked features).

**Blocked by:** None — can start immediately.

**Surfaces:** ui (settings, Profile Intelligence, quota banner), client entitlement checks

**FE can start?:** yes

**Status:** done

**Parent:** [PRD — Commercial surface strip](../PRD.md) · ADR 0001

- [x] No Dodo plan cards / Get Pro / customer-portal marketing in settings
- [x] No Unlock Pro / PremiumUpgradeModal / Upgrade CTAs on Profile Intelligence (or equivalent)
- [x] No quota banner that links to checkout upgrade
- [x] BYOK / provider API keys can still be entered and persisted
- [x] Previously greyscaled Pro UI opens without “Requires Pro license” upsell
- [x] Unused checkout URL / `PREMIUM_ENABLED` cosmetics removed if upsell-only
- [x] Assertion: settings has keys, not storefront; Pro UI available without unlock CTA
