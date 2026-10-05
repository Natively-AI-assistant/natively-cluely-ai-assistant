# Toaster Policy Phase 2: one scheduler that obeys the card ledger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every onboarding and promotional card — including the four ads — is scheduled by the onboarding orchestrator alone, obeying the card ledger (strikes, retirements), the promo budget, the day-1 rule, 60 s spacing, one onboarding + one promo per launch and the Trial-ended lock-out; each close records what the user actually did.

**Architecture:** The orchestrator class gains ledger-aware gates for stages that name a `card`, plus session state for spacing and per-launch caps; its persisted queue is reconciled with the catalog on start so new stages reach existing users. The stage catalog is rebuilt: new order (permissions → trial promo → Natively API "new" → extension; promos by priority), the `ads` stage removed, eligibility as `customPredicate`s over live user state. A pure `cardInputs` module turns IPC reads into that user state; App refreshes it on the events that change it and feeds the ledger. The host renders every card stage (ads included), records `shown` when a stage becomes active and the first definite outcome of each showing. Cards report *why* they closed (`acted` / `never` / plain close = `later`), which needs a small premium-repo change for the four ads.

**Tech Stack:** React renderer (orchestrator is renderer-side), premium submodule (ad components), `node --test` with `--experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-09-26-toaster-policy-design.md` §3, §4, §6, §7.3, §7.4.

## Global Constraints

- One card at a time; only on the launcher home, focused, no meeting (existing triggers).
- 60 s of home-screen time between one card closing and the next opening.
- Per launch: at most one onboarding card (permissions not counted), at most one promotional card.
- Promo budget and day 1 from the ledger (`promoBudgetOpen`, `dayOneOver`); per-card availability from `isCardAvailable`.
- While the Trial ended card is open nothing else opens.
- No promotional card during an active trial, none for Max/Ultra subscribers.
- Promo priority = catalog order: max_ultra, natively_api_existing, profile_ad, jd_ad, review_prompt, support.
- No OS branches.

## Review Focus

- A user whose persisted queue predates the new stages must get them (queue reconcile). Test in Task 1.
- The ledger arrives asynchronously (IPC): until it loads, no card stage may show (permissions still can). Test in Task 2.
- A card closed by the host's own unmount (orchestrator yanks it, e.g. Trial ended opens) must record nothing (interrupted). Test in Task 4 via the outcome latch.
- Premium submodule missing (open-source build): ad stages must stay silent, not crash. `src/premium/index.tsx` already stubs components; predicates must not depend on them.
- Two definitive outcomes in one showing (CTA fires `acted` then the component's own close fires a plain dismiss): only the first counts. Test in Task 4.

---

### Task 1: Queue reconcile on start

**Files:** `src/lib/onboarding/orchestrator.ts` (in `start()`), test in `src/lib/onboarding/__tests__/orchestratorClass.test.mjs`.

`start(stageConfigs)`: after sorting configs, set `state.queue` to the catalog ids in catalog order, keeping only ids the catalog knows plus any dynamic id already in the queue that has a config (quiet_window). Persist.

- [ ] Test: persisted state whose queue is `['permissions','ads','support']` → after `start(STAGES)` the queue equals the catalog's ids in order and has no `'ads'`. RED → implement → GREEN → commit `fix(onboarding): the persisted queue follows the stage catalog`.

### Task 2: Ledger-aware gates in the orchestrator

**Files:** `src/lib/onboarding/orchestrator.ts`, test `orchestratorClass.test.mjs`.

- `StageConfig.card?: CardId` (from `src/lib/cards/cardPolicy.mjs`); class = `CARDS[card].cls`.
- `UserState.cardLedger: Ledger | null` (default null), `UserState.trialEndedOpen: boolean` (default false).
- Session (not persisted): `lastCardClosedHomeMs: number | null`, `onboardingShownThisLaunch`, `promoShownThisLaunch`.
- `shouldEvaluate()` false while `trialEndedOpen`.
- `shouldShowToaster` for a stage with `card`: ledger loaded; `isCardAvailable`; onboarding → not already shown this launch; promo → `dayOneOver && promoBudgetOpen` and not already shown this launch; spacing → if `lastCardClosedHomeMs != null`, `homepageMountedFor - lastCardClosedHomeMs >= 60_000`. Spacing applies to every stage that renders (permissions too).
- Dispatch of a card stage sets the class flag; `completeToaster` records `lastCardClosedHomeMs = homepageMountedFor` for rendering stages.
- `nextEvaluationDelayMs` considers the spacing remainder for otherwise-ready stages.

- [ ] Tests (fake clock, real class, single-stage catalogs built from the real STAGES entries where possible): promo not shown on day one, shown after 24 h; second promo blocked for 72 h; one onboarding per launch; 60 s spacing between two cards; nothing while `trialEndedOpen`; no card stage before the ledger loads; a ledger strike wait blocks the card. RED → implement → GREEN → commit.

### Task 3: Stage catalog rebuilt

**Files:** `src/lib/onboarding/stageCatalog.ts`; `src/lib/onboarding/stageCatalog.mjs` becomes `export * from './stageCatalog.ts'` (tests run with strip-types; the twin stops drifting); update `src/lib/onboarding/__tests__/stageCatalog.test.mjs`.

UserState additions (defaults in orchestrator): `hasOwnAiKey`, `planTier: 'free'|'pro'|'max'|'ultra'|'other'`, `hasJD`, `nativelyQuotaPct: number`, `trialClaimed`.

| order | id | card | predicate (customPredicate over ctx.userState + ledger) |
|---|---|---|---|
| 1 | permissions | — | unchanged |
| 2 | trial_promo | trial_promo | no Natively key, no own AI key, not premium, not claimed, no active trial |
| 3 | natively_api_new | natively_api_new | no keys, not premium, no active trial, and (claimed or trial_promo retired in the ledger) |
| 4 | browser_extension | browser_extension | extension not connected |
| 5,6 | profile_intelligence, modes_manager | — | unchanged gates |
| 10 | max_ultra | max_ultra | plan 'pro' and quota ≥ 80 % |
| 11 | natively_api_existing | natively_api_existing | own AI key, no Natively key, not premium |
| 12 | profile_ad | profile_ad | not premium, no profile |
| 13 | jd_ad | jd_ad | not premium, has profile, no JD |
| 14 | review_prompt | review_prompt | launches ≥ 3 or usage ≥ 30 min |
| 15 | support | support | turns ≥ 10 or launches ≥ 10, not premium |

All promo predicates also require: no active trial, plan not max/ultra. Onboarding stages 2–4 require `permissions` completed or skipped. `ads` is removed. Launch count = `ledger.launchCount`.

- [ ] Tests: each predicate's true/false table on both twins; RED → implement → GREEN → commit.

### Task 4: Inputs, host and outcome recording

**Files:**
- Create `src/lib/cards/cardInputs.mjs` + `.d.mts` + test: `cardInputsFromSources({ creds, licence, profile, trialLocal, usage, extensionConnected })` → user-state patch (`hasNativelyKey`, `hasOwnAiKey`, `planTier`, `isPremium`, `hasProfile`, `hasJD`, `nativelyQuotaPct`, `trialClaimed`, `hasTrialToken`, `extensionConnected`).
- Create `src/lib/cards/outcomeLatch.mjs` + test: first definite outcome of a showing wins; a plain close after it records nothing; an unmount with nothing recorded records nothing.
- Modify `src/App.tsx`: `refreshCardInputs()` on mount and on credentials-changed, license-status-changed, trial-started/ended, phone-mirror status; `cardsGet` + `onCardsChanged` → `cardLedger`; `trialEndedOpen` from `showTrialExpiredModal`; remove scheduled ads (`useAdCampaigns` call and the four scheduled ad elements); keep `?forceAd` DEV rendering only.
- Modify `src/components/onboarding/OrchestratedToasterHost.tsx`: render the ad stages with the premium components; `cardsRecord(card, 'shown')` when a card stage becomes active; map each component's close reason to an outcome through the latch; `natively_api_new` "I'll set up manually" and trial promo "I'll set up manually" open Settings → `ai-providers`.

- [ ] Tests for both pure modules; typecheck; commit.

### Task 5: Cards report why they closed

**Files:**
- premium repo (worktree `premium/`, new branch `feat/toaster-policy`): `NativelyApiPromoToaster`, `MaxUltraUpgradeToaster`, `ProfileFeatureToaster`, `JDAwarenessToaster` call `onDismiss('acted')` on their primary actions and `onDismiss('never')` on "Keep them separate" / "I'll set up manually" / "I'm happy with Pro"; a plain close stays `onDismiss()`. Commit in premium; bump the gitlink in this repo.
- `BrowserExtensionToaster.tsx`: install → `onDismiss('acted')`.
- `SupportToaster.tsx`: presumed donation → `onDismiss('acted')`.
- `ReviewPromptHost.tsx`: `onOutcome?: (o: 'acted'|'later'|'never') => void` fired from submit / dismiss-later / dismiss-forever in controlled mode.

- [ ] Typecheck + existing component tests (`npm run test:components` if present); commit.

### Task 6: Verify

- [ ] `npm run test:lib`, both typechecks, the electron card/trial tests, a live launch in the isolated scratch instance (first launch shows permissions then nothing promotional; ledger file records `shown`), fresh reviewer.
