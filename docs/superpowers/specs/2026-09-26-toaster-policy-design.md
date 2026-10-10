# Toaster policy: when each card shows, how often, and what closing it means

**Status:** approved in conversation 2026-09-26, pending written-spec review
**Scope:** 18 card surfaces in the launcher window, macOS and Windows
**Supersedes:** the ad scheduling in `premium/src/useAdCampaigns.ts` and the `ads` stage in `src/lib/onboarding/stageCatalog.ts`

## 1. Why

The cards were added one at a time, each with its own timing and storage. A code audit on 2026-09-26 found they disagree with each other and, in places, with themselves:

- A user who bought Pro after an expired trial is locked behind the "Trial ended" card on every launch; its only exit deactivates the licence (see §9, Phase 0).
- Ads run on a second scheduler that ignores the one-card-at-a-time rule, so an ad and an onboarding card can be on screen together.
- The `ads` stage never completes, so when it fires it blocks every later card and all ads for the rest of the session.
- The review prompt ignores "Never ask" and a submitted review in production; it returns every 90 days.
- Profile, JD and Max/Ultra ads save no dismissal and can return daily. Max/Ultra can never show at all.
- The trial promo is re-offered to users who already used their trial, and treats "trial already used" as success.

This spec defines one policy for all of them and one scheduler that enforces it.

## 2. Decisions (made by Evin, 2026-09-26)

| Question | Decision |
|---|---|
| How pushy overall | **Balanced:** at most 1 promotional card per 3 days, none in the first 24 h after first launch, never during a meeting |
| What "no" means | **3 strikes, growing gap:** after each "not now" wait 7, then 21, then 60 days; the 3rd strike retires the card. An explicit "never" retires it immediately |
| Day-1 cards | Browser extension, Free-trial promo (no keys) and Natively API "Skip the setup" (no keys) are **onboarding**: allowed on day 1, not counted in the promo budget |
| "Trial ended" card | **Must choose** (no close), as today, but it must never reach a paying user or anyone with a key |
| Enforcement | **One scheduler:** the onboarding orchestrator becomes the only card scheduler; each ad becomes its own stage |

## 3. Card classes and global rules

### 3.1 Classes

| Class | Cards | Promo budget |
|---|---|---|
| **Essential**: shown whenever the situation requires it | Trial countdown (+ under 2 min), Trial ended (+ Cleaning up, All set), Trial options (opened by the user), Permissions | Not counted; always wins over other classes |
| **Onboarding**: allowed from day 1 | Browser extension, Free-trial promo, Natively API "Skip the setup" | Not counted |
| **Promotional** | Natively API "Three services", Profile ad, JD ad, Max/Ultra upgrade, Support Natively, Review prompt | 1 per rolling 72 h, first allowed 24 h after first launch |

### 3.2 Rules for every onboarding and promotional card

1. **One card at a time**, across all classes. Ads are stages in the same queue.
2. **Only on the launcher home screen**, only while the app is focused, **never while a meeting is active**. A meeting starting does not close a card that is already open.
3. **Spacing:** at least **60 s of home-screen time** between one card closing and the next opening.
4. **Per launch:** at most **one onboarding card** (Permissions not counted) and at most **one promotional card**.
5. **"Trial ended" is exclusive:** while it is on screen, nothing else may open.
6. **No promotional cards during an active free trial** (the countdown banner is enough), and none for **Max or Ultra** subscribers.

### 3.3 Onboarding order

For a new user with no keys:

1. Permissions (existing rule, unchanged)
2. Browser extension, after the 60 s spacing or on a later launch

**Changed 2026-10-09: the free trial is no longer a card.** It starts by itself when a meeting starts with no AI set up (`src/lib/trial/autoTrial.mjs`), the welcome screen says so beforehand, and the meeting overlay says so when it happens (`src/components/overlay/TrialNotice.tsx`). The card reached about 8% of new installs, while about half of them started their first meeting with nothing configured. Where the rest of this document says "Free-trial promo" or "trial promo" as a card (§6 rows 7 and 8, §8, §11), read it as history: the card id `trial_promo` is kept in the ledger and the funnel catalogue for installs that already hold an entry, and nothing shows it.

Natively API "Skip the setup" appears only when the trial is unavailable (claimed or used, or the old trial promo was retired). It takes the onboarding slot ahead of the browser extension, and the two wait the same 6 s on Home so that order, not a head start, decides between them.

### 3.4 Promotional priority

When several promotional cards are eligible, show the highest:

1. Max/Ultra upgrade (near the quota limit, so time-sensitive)
2. Natively API "Three services"
3. Profile ad
4. JD ad
5. Review prompt
6. Support Natively

Strike gaps rotate them naturally: a card waiting out a gap is not eligible, so the next one shows.

## 4. Outcomes: what each close means

Every onboarding and promotional card has one ledger record (§7.1).

| User action | Outcome | Ledger effect |
|---|---|---|
| Primary action (Start trial, Add to Chrome, Get a key, Upgrade, Support, Send rating) | **acted** | Retired, unless §5/§6 define a follow-up |
| "Not now", "Maybe later", ✕, Escape, click outside | **later** | strikes += 1; next eligible = now + 7 d / 21 d / 60 d for strike 1 / 2 / 3; strike 3 retires |
| Explicit never: "Never ask", "I'm happy with Pro", "Keep them separate" | **never** | Retired immediately |
| The card's reason goes away (extension connected, key added, bought Pro, reviewed, trial used) | condition | Not eligible while true; not a strike |
| App quits or crashes while the card is open | **interrupted** | No strike; may show again on a later launch |
| Meeting starts while the card is open | none | Card stays open |

**Budget accounting:** a promotional card consumes the 72 h budget **when it is shown** (so a crash loop cannot fire cards every launch). A card's strike gap stacks on top of the budget.

**Counting:**

- **Launch** = one main-process start. Renderer reloads and extra windows do not count (today they do).
- **First launch** is recorded once and anchors the 24 h day-1 rule.
- **AI turns** and **usage minutes** keep today's definitions (launcher search-pill/Start Natively turns; focused-launcher time).

## 5. Essential cards: the trial family

| # | Card | When it shows | Closing | Errors and retry |
|---|---|---|---|---|
| 1 | Trial countdown banner | Launcher only, whenever a trial is active | Not dismissible | Offline: keeps counting down from the stored expiry. Only the launcher polls `trial:status` (today every window does). |
| 2 | Under 2 minutes | Same banner, last 2 minutes, automatically | — | At 0:00 hands straight to #3 without waiting for the server |
| 3 | Trial ended | Trial token expired **and** no paid plan, no Natively key, no own provider key. At expiry, then on every launch until resolved | **No close.** Plan button opens checkout; the card stays and **closes itself** when a licence or key arrives. "Use my own API keys" goes to #5 | Never shown to paying users (see Phase 0). The profile-data wipe runs **once**, at expiry. Only one instance: Settings → Plans shows the options inline instead of opening a second card |
| 4 | Trial options (mid-trial) | Only from "See your options" in Settings | ✕ / Escape / outside: no strike, no budget | — |
| 5 | Cleaning up | While the switch to own keys runs | Cannot be closed | Wipe **fails**: show the error with **Try again** (today a failure falsely reports success) |
| 6 | All set | After a **successful** wipe | "Add my keys" opens Settings → AI Providers | Must stay mounted until the user leaves it (today `trial-ended` unmounts the card during #5) |

## 6. Onboarding and promotional cards

| # | Card | Class / priority | Eligible when | Acted | Later | Never | Errors and retry |
|---|---|---|---|---|---|---|---|
| 7 | Free-trial promo | Onboarding | No keys of any kind, trial never claimed on this device, not paying | Trial started → retired. "I'll set up manually" → retired, opens Settings → AI Providers (today it opens a non-existent tab `'api'`) | Strike | — | See #8 |
| 8 | Could not start | Error state of #7 | — | — | Closing after **our** error (network, server) is not a strike | — | Network/timeout/5xx: one automatic retry after 3 s, then a friendly message + Try again. Rate-limited: "Too many attempts, try again later", button disabled. Trial already used / IP limit: say so, **retire #7**, offer "Get a Natively key" and "Use my own keys". The server's `ok:true, expired:true` reply is "trial unavailable", not success. Raw error codes are never shown |
| 9 | Browser extension | Onboarding | Extension not connected, checked **live** | "Add to Chrome" opens the store. Follow-up: still not connected 7 days later → show **once more**, then retire. Connecting retires it | Strike | — | Store link fails to open: "Couldn't open the Chrome Web Store" with the link to copy |
| 10 | Support Natively | Promo 6 | 10+ launches or 10+ AI turns, not paying, not already supported | "Support the Builder" → retired (today a donation is presumed after 20 s away) | Strike | — | — |
| 11 | Review step 1: rating | Promo 5 | 3+ launches or 30+ min usage; not reviewed; not "never" | "Send rating" → retired, go to step 2 | Strike | "Never ask" → retired | Network: one automatic retry, then message + Try again. Rate-limited: "Try again in a minute" |
| 12 | Review step 2: testimonial | — | After step 1 | "Save with name" / "Send anonymously" / "Don't share" | Closing keeps the rating; no strike | — | Save fails: message + Try again; the rating stays saved |
| 13 | Review step 3: thanks | — | After step 2 | Closes itself after 5 s | — | — | — |
| 14 | Natively API "Skip the setup" | Onboarding | No keys **and** trial unavailable | "Get a Natively key" (opens Plans) → retired. "I'll set up manually" → retired, opens AI Providers | Strike | — | — |
| 15 | Natively API "Three services" | Promo 2 | Own provider keys, no Natively key, not paying | "Replace all three" → retired | Strike | "Keep them separate" → retired | — |
| 16 | Profile ad | Promo 3 | Free plan, no profile | "Upgrade to Pro" → retired | Strike | — | — |
| 17 | JD ad | Promo 4 | Free plan, has a profile, no job description | "Upgrade to Pro" → retired | Strike | — | — |
| 18 | Max / Ultra upgrade | Promo 1 | Pro plan and any Natively quota at 80%+ this billing cycle (the cycle ends at the quota reset date `getNativelyUsage` reports) | "Compare plans" / a plan → retired **for this billing cycle**; re-armed next cycle if usage is 80%+ again | Strike | "I'm happy with Pro" → retired for good | — |

## 7. Architecture

### 7.1 Card ledger (main process)

- File `card-ledger.json` in `app.getPath('userData')`, written atomically (write temp file, then rename). Same path API on macOS and Windows.
- Contents:
  - `firstLaunchAt`, `launchCount` (main-process starts)
  - `lastPromoShownAt`
  - per card: `shows`, `strikes`, `nextEligibleAt`, `retired`, `retiredReason` (`acted` \| `never` \| `strikes` \| `migrated`), `retiredUntil` (billing-cycle retirements), `lastShownAt`
- IPC:
  - `cards:get`: the whole ledger
  - `cards:record(cardId, outcome)`, where outcome is `shown` \| `acted` \| `later` \| `never` \| `interrupted`. Main applies it through the policy module (§7.2) and broadcasts `cards:changed`.
- The source of truth for card outcomes. The orchestrator's `localStorage` state keeps only session and home-screen timing.

### 7.2 Policy module (pure)

- `src/lib/cards/cardPolicy.mjs` + `.d.mts`. No platform branches, no I/O.
- Exports:
  - `applyOutcome(entry, outcome, now)`
  - `strikeGapMs(n)`
  - `promoBudgetOpen(ledger, now)`
  - `dayOneOver(ledger, now)`
  - `pickPromotional(eligible, ledger, now)`
  - the class and priority tables
- Imported by the main-process ledger and the renderer scheduler (the pattern `permissionAttentionPolicy.mjs` already uses).

### 7.3 Scheduler (the orchestrator)

- Stages gain `class: 'essential' | 'onboarding' | 'promo'` and `priority`.
- The `ads` stage is removed. Each ad becomes a stage: `natively_api_new`, `natively_api_existing`, `profile_ad`, `jd_ad`, `max_ultra`.
- New gates:
  - per-card ledger eligibility
  - promo budget and day-1 rule
  - 60 s home-screen spacing after the previous close
  - per-launch caps
  - essential exclusivity (a `trialEndedOpen` user-state blocks evaluation)
- Eligibility inputs are **live**, refreshed on `credentials-changed`, `license-status-changed`, phone-mirror status, profile/JD changes and `trial-*` events. Today `hasNativelyKey`, `hasProfile`, `donationShouldShow` and `extensionConnected` are read once at mount.
- The host renders the matching premium component for each ad stage. Close paths call `cards:record` then `markDismissed`.

### 7.4 Premium submodule

- The ad components keep their look and buttons.
- The explicit-never buttons ("I'm happy with Pro", "Keep them separate") report `never` instead of a plain dismiss.
- `useAdCampaigns` scheduling is removed. Remote campaigns stay off (their renderer is already commented out).

### 7.5 Trial flow

- Trial polling, the expiry wipe and the "Trial ended" card run in the launcher only.
- The expiry wipe is recorded in the ledger and runs once.
- `trial-ended` does not unmount the card during Cleaning up.

## 8. Migration (first run of the ledger)

Import what users already did, so nobody is re-asked:

| Existing record | Becomes |
|---|---|
| Review ledger `has_reviewed` or `dont_show_again` | Review retired |
| DonationManager `hasDonated` | Support retired |
| DonationManager `lifetimeShows` | Support strikes = min(shows, 2) |
| `natively_dismissed_campaigns` entries | Those ads retired |
| Orchestrator `completed` / `lastShownTimes` for extension, trial promo, support, review | strikes = min(times shown, 2); `nextEligibleAt` from the last show + the matching gap |
| `natively_trial_claimed` or a stored trial token | Trial promo retired |
| Orchestrator `startupCount` | `launchCount` seed; `firstLaunchAt` = earliest known timestamp |

The strike cap of 2 means every existing user gets at most one more showing of each card.

## 9. Delivery phases

- **Phase 0, ships alone and first: paying-user trial lock-in.**
  - Activating a licence or saving a real key clears the trial token.
  - The "Trial ended" card and the expiry wipe check for a licence or key first.
  - The wipe runs once.
  - Regression tests: a licensed user with an expired token never sees the card and never loses data or the licence.
- **Phase 1:** card ledger + policy module + migration, with tests. No visible change yet.
- **Phase 2:** the scheduler enforces the ledger. Ads become stages; the `ads` stage and `useAdCampaigns` scheduling are removed.
- **Phase 3:** per-card fixes:
  - trial promo errors and retirement
  - review "Never ask" and submitted reviews
  - support presumed donation
  - extension live check and follow-up
  - Max/Ultra reachability
  - single "Trial ended" host
  - All set reachable
- **Phase 4:** remove dead code and dead keys:
  - `natively_ext_connect_dismissed_v1`, the ad `*_dismissed` timestamps, `natively_show_profile_toaster`
  - `queue:set`, `review:record-session` with no caller, `DonationManager.SHOW_DELAY_MS`, the banner's `PLAN_PRO_URL`
  - make the `?noorch` and host isolate flags DEV-only

## 10. Dev overrides

`?forceAd=`, `?review=force|off`, `?forceTrialEnded=1`, `?extToaster=force`, `?noorch=1` and the isolate flags become **DEV-build only** and route through the scheduler (a forced card is still a stage, so it cannot overlap another). A forced card records no ledger outcome.

## 11. Testing

- **Policy module:** table-driven tests with hand-written expected values for:
  - strike gaps and retirement
  - budget windows
  - day-1 boundary
  - spacing
  - per-launch caps
  - priority
  - every outcome for every card class
- **Scheduler scenarios** on the real `OnboardingOrchestrator` with a fake clock and persisted state across simulated launches:
  1. New user with no keys: day 1 shows Permissions → Free-trial promo; the extension appears on a later launch; no promotional card before 24 h.
  2. User with own keys on day 4: "Three services" shows; the next promo waits 72 h.
  3. Three "not now"s: the card returns after 7 and 21 days, then never.
  4. Crash while a card is open: no strike; the card can return.
  5. Meeting starts: nothing new opens; the open card stays.
  6. "Trial ended" open: nothing else opens.
  7. Pro user at 80% quota: Max/Ultra shows; "I'm happy with Pro" retires it for good.
- **Main process:**
  - ledger save/load and atomic write
  - migration from every existing key in §8
  - Phase 0 token clearing on licence activation and key save
- **Physical:** the isolated scratch-instance rig (`live/launch.mjs`) for the main flows on macOS.

## 12. Platform notes

- **Shared code:** nothing in this policy branches on the operating system. The ledger path comes from `app.getPath('userData')` on both platforms, and the policy module is pure.
- **Windows:** runs the same code but still needs physical verification of the main flows, especially that the Chrome Web Store link opens and that the launcher focus/foreground gating behaves the same.

## 13. Out of scope

- Server-driven caps or remote campaigns.
- Light-theme styling of the cards.
- The corner notices (quota, long-term memory, search index), update notices and meeting-overlay banners: they are status notices, not promotional cards, and keep their current rules.
- Permissions card rules (settled 2026-09-25, `permissionAttentionPolicy.mjs`).
