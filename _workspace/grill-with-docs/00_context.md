# Context harvest — Mobile companion app for Natively stealth mode via USB (InterviewMan-like)

**Topic:** Mobile companion app for Natively stealth mode via USB (InterviewMan-like)  
**Subproject:** `natively-cluely-ai-assistant` (repo root)  
**Harvest date:** 2026-08-03  

**Sources checked:**
- `CONTEXT-MAP.md` — **absent** at workspace root
- `CONTEXT.md` (root only) — commercial surface strip glossary
- `docs/**/CONTEXT.md` — **none**
- `docs/adr/` — 2 ADRs (commercial strip)
- `.scratch/` — InterviewMan SD-prompt notes only; no mobile/USB/Phone Mirror companion PRDs
- Adjacent product docs/code (not glossary): `PRIVACY.md`, `termsandcondition.md`, `README.md`, `.wayfinder/map.md`, `natively-browser/CONTRACT.md`, `electron/services/PhoneMirrorService.ts`, prior grill archives under `_workspace/grill-with-docs/archive/`

---

## Known Terms

### From root `CONTEXT.md` (Commercial Surface Strip)

All terms below are defined for the **commercial surface strip** effort. Relevance to this grill topic is tagged.

| Term | Definition (verbatim sense) | Relevance to mobile/USB stealth companion |
|------|-----------------------------|-------------------------------------------|
| **Commercial surface strip** | Removal of donation, trial UI, checkout/upsell, and engagement (ads/reviews) chrome from the fork, plus hard-disable of trial backend so a live trial cannot start, phone home, or wipe profile data. Avoid: paid-feature removal, rebrand, gate re-enable. | **Irrelevant** |
| **Donation cluster** | Tip/support asks: SupportToaster, Buy Me a Coffee links, About/FeatureSpotlight support CTAs, DonationManager cadence. Avoid: “Support” (ambiguous), tip jar alone. | **Irrelevant** |
| **Trial UI** | Visible free-trial chrome: banners, modals, promo toasters, trial status cards in settings. Avoid: “Trial” alone (ambiguous with trial backend). | **Irrelevant** |
| **Trial backend hard-disable** | Making trial non-startable: no `trial:start` to Natively APIs, no `TRIAL_SENTINEL_KEY` LLM/STT routing, no `trial:end-byok` profile wipe; delete or stub IPC to safe inactive no-ops. Avoid: UI-only trial removal, dead but callable trial IPC. | **Irrelevant** (note: “phone home” here = trial API telemetry, not Phone Mirror) |
| **Checkout/upsell** | Dodo/Gumroad plan cards, Unlock/Get Pro CTAs, quota upgrade banners, INSIDER20 and billing-portal marketing. Avoid: “Natively API settings” as a synonym. | **Irrelevant** |
| **Engagement cluster** | Orchestrator ads/`review_prompt` stages, in-app review modal/host, and ReviewService posts to Natively reviews API. Avoid: harmless prompts, optional polish. | **Irrelevant** |
| **License bypass** | Unconditional Pro unlock already in tree (`isProOrTrialActive` / `isPremiumAvailable` → true). Strip keeps this; does not reintroduce a paywall or require the premium submodule. Avoid: license gate, trial unlock path. | **Adjacent** — Pro marketing lists “Phone Link Companion App” as Pro; fork already bypasses Pro gates, so entitlement is not the blocker for building companion |
| **BYOK** | User-supplied provider API keys in settings — kept under a non-upsell settings surface after Pro/trial/Dodo marketing is gutted. Avoid: Natively managed subscription, Codex plan. | **Irrelevant** |
| **Client Pro gate align** | UI access matches backend bypass: no Unlock Pro / PremiumUpgradeModal; no greyscale “Requires Pro” for features the fork already unlocks. Avoid: client premium check as a product requirement. | **Adjacent** — if companion UI exists, strip policy says don’t greyscale it behind fake Pro |
| **Natively identity kept** | Product name, tray, and in-app “Natively” branding stay; full rebrand is a separate effort. Avoid: “strip branding” when meaning only commercial asks. | **Adjacent** — companion branding / naming stays Natively unless a separate rebrand |
| **skip-premium** | Do not init/checkout the private `natively-premium` submodule; empty premium UI stubs stay no-ops. Avoid: wire premium for CI green. | **Irrelevant** |
| **premium** *(flagged in CONTEXT.md)* | Overloaded across monetization (`isPremium`), empty `premium/` submodule, FeatureSpotlight slide type, and `ModesManager.isPremiumKnowledgeInterceptAllowed` (mode-template compatibility — **not** a license gate). | **Adjacent** — do not confuse mode-template “premium intercept” with companion entitlement |
| **Natively API settings** *(flagged in CONTEXT.md)* | Historically mixes BYOK key config with free-trial start and Dodo checkout. After strip: keep key/provider config; remove trial/checkout marketing. | **Irrelevant** |

No other `CONTEXT.md` files found under `docs/**`.

### Adjacent product / prior-grill terms (not in CONTEXT.md; useful for this topic)

These are **not** glossary-locked in root CONTEXT; they appear in product docs, code, or prior grill archives.

| Term | Working definition from repo | Notes |
|------|------------------------------|-------|
| **Phone Mirror** | Beta desktop feature: local HTTP/WS server (`PhoneMirrorService`, default port `4123`) that pairs a **phone** (QR / LAN or loopback URL + short-lived phone token) and/or a **companion browser extension** (separate persisted extension token). Session content not stored on Natively servers (`PRIVACY.md` §3.5; `termsandcondition.md` §1.5). | Existing surface closest to “companion”; **network/LAN or loopback**, not USB |
| **Phone Link Companion App** | README Pro-feature row / competitive table; README also: “Use your iOS/Android device as a wireless remote microphone or companion screen.” `.wayfinder/map.md` lists it **out of scope** — “requires external mobile app infrastructure.” | Name overlaps Phone Mirror; unclear if same product or aspirational Pro mobile app |
| **Companion browser extension** | `natively-browser/` MV3 extension; talks to PhoneMirrorService `/dom` + `/ws` on **loopback only**; DOM capture for “What to say.” Distinct from a phone/mobile app. | “Companion” overloaded |
| **Stealth / Undetectable mode** | Desktop: hide from dock/taskbar, disguise process, screen-share resistant overlay (`setUndetectable`, `reassertUndetectableStealth`). Separate: **stealth keyboard tap** (CGEventTap), stealth global shortcuts, UI “stealth collapse.” | Overloaded; not defined as a mobile/USB channel |
| **InterviewMan** | External interviewer product; Natively maintains paste-only SD custom prompt (`.scratch/sd-interview-sim/InterviewMan-SD-custom-prompt.md`). Prior grill: prompt accuracy / soft DF parity — **not** a mobile companion. | Topic says “InterviewMan-like” — likely means competitor UX pattern (phone as remote view while desktop stays stealth), **not** the SD prompt artifact |
| **InterviewMan-style short wall-clock context cap** | Prior grill anti-goal for context retention (~10 min rolling transcript); unrelated to USB/companion hardware. | Do not conflate with this topic |

---

## Locked Decisions (ADRs)

Only ADRs under `docs/adr/`. Both are about commercial strip — **none** lock mobile companion, USB, Phone Mirror, or stealth-via-phone.

| ADR | Title | One-sentence summary |
|-----|-------|----------------------|
| **0001** | Strip commercial surfaces; keep license bypass | Fork strips donation/trial/checkout/engagement chrome while keeping unconditional Pro unlock and BYOK; no paywall reintroduction; rename stays separate. **Status: accepted.** |
| **0002** | Hard-disable trial backend (not UI-only) | Trial paths (`trial:start`, sentinel key routing, `trial:end-byok` wipe) must be deleted or stubbed to safe no-ops so latent phone-home/wipe cannot remain after UI strip. **Status: accepted.** |

No `adr/` at repo root. No ADRs about Phone Mirror, LAN bind, companion apps, or USB.

---

## Flagged Ambiguities

Especially for this topic:

1. **“Stealth”** — At least four senses in-tree: (a) Undetectable mode (dock/process/screen-share hide), (b) stealth keyboard CGEventTap, (c) stealth global shortcuts / no-focus IPC, (d) overlay UI collapse. “Stealth mode via USB” is undefined: does USB carry the **display** of answers while desktop stays undetectable, or replace LAN for Phone Mirror, or something else?

2. **“Phone Mirror” vs “Phone Link Companion App” vs “companion”** — Phone Mirror = existing desktop pairing server + phone web client + browser extension. “Phone Link Companion App” is marketed as Pro / called out-of-scope for needing a **mobile app**. “Companion” also means the **browser extension**. Unclear whether the grill target is (i) a new native iOS/Android app, (ii) hardening/extending Phone Mirror’s phone HTML client, or (iii) USB transport under the existing Phone Mirror protocol.

3. **USB vs WiFi/LAN** — Phone Mirror today: default **loopback** `127.0.0.1:4123`; optional **`exposeOnLan` → `0.0.0.0:4123`** with confirmation dialog (plaintext HTTP on Wi‑Fi). No USB/adb/reverse-tether path found in `.scratch`, ADRs, or PhoneMirrorService. USB in codebase mostly means **USB microphones** / hot-plug audio — not phone companion.

4. **“InterviewMan-like”** — Prior repo meaning of InterviewMan is an **external SD interviewer + paste prompt**, not a mobile stealth companion. Competitor product may use a phone screen while laptop stays clean — that UX analogy is **not** glossary-locked here. Risk of grilling the wrong InterviewMan (prompt accuracy archive vs mobile companion pattern).

5. **Entitlement** — Marketing: Phone Link = Pro. Fork: **license bypass**. Building companion does not need ADR-0001 reversed, but whether companion ships as OSS-unlocked vs gated is unset.

6. **CONTEXT.md “phone home”** — Means trial API telemetry, **not** Phone Mirror. Do not reuse that phrase for companion networking.

---

## Gaps

- **No CONTEXT-MAP.md** and **no topic-specific CONTEXT.md** for mobile companion / USB stealth / Phone Mirror.
- **No ADRs** deciding transport (USB vs LAN), app form factor (native vs web-in-Phone-Mirror), or threat model for stealth+phone.
- **`.scratch/` has no prior notes** on mobile companion, USB stealth, or Phone Mirror product design. Hits are only: InterviewMan **SD custom prompt**, “companion test” wording in lesson-grounding, “stealth collapse” in overlay UI SPEC.
- **No formal definition** of the desired USB topology (USB tethering / adb reverse / accessory mode / wired Ethernet gadget) or how it relates to existing `exposeOnLan` security model (LAN confirm dialog, dual tokens).
- **Product gap already called out:** `.wayfinder/map.md` — Phone Link Companion App needs **external mobile app infrastructure** (not specified).
- **InterviewMan-like mobile UX** is not documented in this repo; only InterviewMan **prompt** artifacts exist under `.scratch/sd-interview-sim/` and grill archives `20260728-173621` / `win-first-context-retention-20260803`.
- Root glossary is **commercial-strip-only**; grilling this topic must not invent USB/stealth companion terms as if they were locked in CONTEXT.md.
