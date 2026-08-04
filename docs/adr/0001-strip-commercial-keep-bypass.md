# Strip commercial surfaces; keep license bypass

Fork already unconditionally unlocks Pro (`isProOrTrialActive` / `isPremiumAvailable` → true) and skips the private premium submodule. This work strips donation, trial UI, checkout/upsell, and engagement chrome, and hard-disables trial backend — without reintroducing a paywall or depending on `natively-premium`.

**Status:** accepted

## Considered options

1. **Strip marketing only; leave license bypass** (chosen) — matches personal-fork intent; Pro OSS features stay usable via BYOK.
2. **Reintroduce paywall while removing marketing** — contradicts prior bypass / `feat/pro-features-oss` and would brick Pro UI without premium submodule.
3. **Delete Pro capabilities along with marketing** — “paid-feature removal”; out of scope and destructive to interview/profile features already reimplemented in OSS.

## Consequences

- Settings keep BYOK key/provider config; Pro/Dodo/trial marketing is gutted, not the whole API settings surface.
- Client Unlock Pro / “Requires Pro” greyscale must align with bypass (remove upsell gates), or UI lies about entitlement.
- Product rename (“Natively” identity) remains a separate effort.
