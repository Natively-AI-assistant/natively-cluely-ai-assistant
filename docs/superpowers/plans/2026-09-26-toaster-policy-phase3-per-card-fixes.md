# Toaster Policy Phase 3: Per-Card Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each card behave the way the spec's per-card tables (§5, §6) say, now that one scheduler and the card ledger (Phases 1-2) decide when cards show.

**Architecture:** Pure decision helpers in `src/lib/**` (`.mjs` + `.d.mts`, shared by main and renderer, tested with `node --experimental-strip-types --test`); main-process changes in `electron/ipcHandlers.ts` / `electron/main.ts`, tested by executing the compiled handlers from `dist-electron` behind a fake `electron` module; renderer wiring in `src/App.tsx` and the card components, pinned by source assertions where the component is not renderable in Node. Nothing branches on the operating system.

**Tech Stack:** Electron (main + preload), React 18 renderer, TypeScript, node:test.

**Spec:** `docs/superpowers/specs/2026-09-26-toaster-policy-design.md` (§5 rows 1-6, §6 rows 7-18, §7.5, §9 Phase 3, §11).

## Global Constraints

- Shared code: nothing in this policy branches on the operating system (spec §12). Paths via `app.getPath('userData')` only.
- Raw error codes are never shown to a user (spec §6 row 8).
- A close after **our** error (network, server) on the trial promo is not a strike (§6 row 8).
- The profile-data wipe runs **once**, at expiry (§5 row 3); a failure is never reported as success (§5 row 5).
- Only one "Trial ended" card instance exists (§5 row 3).
- Trial polling, the expiry wipe and the "Trial ended" card run in the launcher only (§7.5).
- Every onboarding and promotional card keeps exactly one ledger record per showing (§4); the host's outcome latch stays the single writer of card outcomes, except main-side retirements that have no showing (a donation, a review from another install).
- Tests: new electron tests go in `electron/services/__tests__/*2026_09_26*.test.mjs` and run with `ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test <file>` after `npm run build:electron`; renderer tests under `src/**/__tests__` (run by `npm run test:lib` / `npm run test:components`).

## Review Focus

- The trial server answers `ok:true, expired:true` (trial already used on this device): the card must say so, retire, and offer the two ways forward — never record "acted" or claim a trial started. (Task 1 table test.)
- The BYOK wipe fails half-way: the card must show the error with Try again, the trial token must still be there so Try again can run, and nothing may broadcast `trial-ended`. (Task 2 electron test.)
- The trial expires while the app is offline: the card must still appear at 0:00, from the local clock. (Task 3 source test on the banner hand-off; the settle path is local.)
- A review submitted from another install arrives only through the async backend sync, after the one-time import: the review card must still retire. (Task 4 electron test.)
- A user whose only AI route is a ChatGPT/Codex or Antigravity sign-in, or a keyless 9Router: never treated as key-less (no Trial ended wall, no key-less cards). (Task 7 table test.)

---

### Task 1: Trial promo — start errors, retirement, no strike after our error (spec §6 rows 7-8)

**Files:**
- Create: `src/lib/trial/trialStart.mjs`, `src/lib/trial/trialStart.d.mts`
- Test: `src/lib/trial/__tests__/trialStart.test.mjs`
- Modify: `src/components/onboarding/OrchestratedToasterHost.tsx` (trial_promo case), `src/components/trial/TrialPromoToaster.tsx`
- Test: `src/components/__tests__/TrialPromoToaster.test.mjs` (extend)

**Interfaces:**
- Produces: `classifyTrialStart(res) → 'started' | 'unavailable' | 'rate_limited' | 'failed'`; `startTrialWithRetry(start: () => Promise<res>, wait?: (ms) => Promise<void>) → Promise<kind>` (one automatic retry after 3 s on `'failed'` only); `TRIAL_START_COPY: Record<kind, string>`.
- `TrialPromoToaster` props: `onStartTrial: () => Promise<TrialStartKind>` (no longer throws), `onDismiss(reason?: 'after_error')`, `onGetKey: () => void`, `onManualSetup` unchanged.

Classification (main's `trial:start` replies, `electron/ipcHandlers.ts` handler and `NativelyApiSettings.tsx:1032-1057`):

| Reply | Kind |
|---|---|
| `ok:true`, `hasToken:true`, `persisted !== false` | `started` |
| `ok:true`, `expired:true` or `already_used:true` | `unavailable` |
| `ok:false`, error `trial_ip_limit` / `already_used` / `trial_already_used` / `trial_expired` | `unavailable` |
| `ok:false`, error `trial_start_rate_limited`, or `status === 429` | `rate_limited` |
| anything else (network, timeout, 5xx, `request_failed`, `hardware_id_unavailable`, `ok:true` without a token, `persisted:false`) | `failed` |

- [ ] **Step 1: Write the failing table test** — every row above with a hand-written reply object, plus: `startTrialWithRetry` retries exactly once on `failed` (fake `wait` records `[3000]`), never retries `unavailable` / `rate_limited` / `started`, and returns the second attempt's kind; `TRIAL_START_COPY` has no `_` code-like tokens and one entry per kind except `started`.
- [ ] **Step 2: Run it** — `node --experimental-strip-types --test src/lib/trial/__tests__/trialStart.test.mjs` → FAIL (module missing).
- [ ] **Step 3: Implement** `trialStart.mjs` + `.d.mts`. Copy: failed "Couldn't reach Natively. Check your connection and try again."; rate_limited "Too many attempts. Try again later."; unavailable "The free trial has already been used on this device."
- [ ] **Step 4: Run it** → PASS.
- [ ] **Step 5: Failing source tests for the wiring** (extend `TrialPromoToaster.test.mjs`): the toaster renders `TRIAL_START_COPY[kind]` (never `e.message`); in `rate_limited` the start button is `disabled`; in `unavailable` it shows two buttons "Get a Natively key" (`onGetKey`) and "Use my own keys" (`onManualSetup`); a close while the last attempt ended in `failed`/`rate_limited` calls `onDismiss('after_error')`. Host: `startTrialWithRetry(` wraps `startTrial`; `unavailable` records `recorder.outcome('never')` and `setUserState({ trialClaimed: true })`; `closeWith` maps `'after_error'` to `recorder.end()` (no outcome); `onGetKey` opens `'plans'`.
- [ ] **Step 6: Run** `npm run -s test:components` → the new assertions FAIL.
- [ ] **Step 7: Implement** host + toaster.
- [ ] **Step 8: Run** `npm run -s typecheck:ts7 && npm run -s test:lib && npm run -s test:components` → PASS.
- [ ] **Step 9: Commit** `fix(trial): the trial promo says what went wrong and never strikes for our errors`.

### Task 2: Trial ended — one host, an honest wipe, "All set" reachable (spec §5 rows 3, 5, 6; §7.5)

**Files:**
- Modify: `electron/ipcHandlers.ts` (`wipeTrialProfileData`, `settleExpiredTrial`, `trial:end-byok`)
- Modify: `src/App.tsx` (trial-ended listener, `onByok`, `onDone`, `onStandard`), `src/components/trial/FreeTrialModal.tsx` (error + Try again, done button), `src/components/settings/NativelyApiSettings.tsx` (no ended-state card)
- Test: `electron/services/__tests__/TrialEndByokHonest2026_09_26.test.mjs` (new), `src/components/__tests__/FreeTrialModal.test.mjs` (extend), `src/components/__tests__/TrialEndedClaimsSlot2026_09_26.test.mjs` (extend)

**Interfaces:**
- `wipeTrialProfileData(): { success: boolean; failed: string[] }` — each step that throws is named in `failed`; `success = failed.length === 0`.
- `trial:end-byok` → `{ success: true }` after a clean wipe (token cleared, marker set, `trial-ended {choice:'byok'}` broadcast, as today) or `{ success: false, error: 'wipe_failed' }` with the token still stored and **nothing** broadcast.
- `settleExpiredTrial`: a wipe runs at most once per trial per process (in-memory `Set` of trial ids), also when the settings store cannot persist the marker (Phase 0 deferred minor) or a step failed.

- [ ] **Step 1: Failing electron test** — harness as `TrialSupersededByPurchase2026_09_26.test.mjs`; `appState.getKnowledgeOrchestrator` throws on demand. Cases: (a) end-byok with a failing step → `{success:false, error:'wipe_failed'}`, `getTrialToken()` still set, zero `trial-ended` sends; (b) clean → `{success:true}`, token cleared, one `trial-ended {choice:'byok'}`; (c) an expired token settled twice with `sm.set` stubbed to return false → the wipe step ran once.
- [ ] **Step 2: Run** after `npm run build:electron` → FAIL.
- [ ] **Step 3: Implement** — `wipeTrialProfileData` collects failed step names; `trial:end-byok` runs the shared wipe FIRST and returns `wipe_failed` before touching the token, key, licence or broadcasting; `settleExpiredTrial` keeps a `wipeAttemptedFor` Set.
- [ ] **Step 4: Run** → PASS; `npm run -s typecheck:ts7:electron` clean.
- [ ] **Step 5: Failing renderer source tests** — App: the `onTrialEnded` listener ignores `choice === 'byok'` for closing the card (the card closes itself); `onByok` throws when `!res?.success`; `onDone('byok')` opens Settings → `'ai-providers'`; `onStandard` no longer calls `wipeTrialProfileData`. FreeTrialModal: on error the BYOK button reads "Try again" and the message is the friendly copy, not `e.message`; the done button reads "Add my keys". NativelyApiSettings: never sets its trial modal open from `showEndedCard` (only "See your options" mid-trial opens it).
- [ ] **Step 6: Run** `npm run -s test:components` → FAIL.
- [ ] **Step 7: Implement.**
- [ ] **Step 8: Run** typecheck + `test:lib` + `test:components` + the electron file → PASS.
- [ ] **Step 9: Commit** `fix(trial): one Trial ended card, a wipe that tells the truth, and a reachable All set`.

### Task 3: Trial clock — launcher-only polling, 0:00 hand-off, the black label (spec §5 rows 1-2; §7.5)

**Files:**
- Modify: `src/App.tsx` (trial block of the mount effect; banner `onExpired`), `src/components/trial/FreeTrialBanner.tsx`
- Test: `src/components/__tests__/TrialClockLauncherOnly2026_09_26.test.mjs` (new)

- [ ] **Step 1: Failing source tests** — the mount effect's trial block (`getLocalTrial` + `checkTrial` + interval) runs only when `isLauncherWindow || isDefault`; `FreeTrialBanner` takes `onExpired` and calls it once when `remaining` reaches 0; App passes `onExpired` that re-reads `getLocalTrial()` and opens the card when `showEndedCard` (no server wait, works offline); the banner has no `text-text-tertiary/NN` classes (a Tailwind opacity modifier on a bare `var()` token emits no CSS, so the label rendered browser-default black).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (`text-text-tertiary opacity-70` / `opacity-60`).
- [ ] **Step 4: Run** typecheck + `test:components` → PASS.
- [ ] **Step 5: Commit** `fix(trial): only the launcher keeps the trial clock, and 0:00 hands straight to Trial ended`.

### Task 4: Support and review (spec §6 rows 10-13)

**Files:**
- Modify: `src/components/SupportToaster.tsx`, `electron/services/ReviewService.ts`, `electron/main.ts`, `electron/services/cards/mainLegacy.ts`
- Test: `src/components/__tests__/SupportToaster.test.mjs` (update), `electron/services/__tests__/ReviewCardSync2026_09_26.test.mjs` (new)

**Interfaces:**
- `reviewCardOutcome(state: { has_reviewed?: boolean; dont_show_again?: boolean }) → 'acted' | 'never' | null` in `mainLegacy.ts`.
- `ReviewService.submitReview` / `updateTestimonial`: a thrown fetch (network, timeout) is retried once after 1.5 s, then returns `error: 'network_error'` (never the raw message).

- [ ] **Step 1: Failing tests** — Support source: "Support the Builder" opens the page and calls `dismiss('acted')` in the same handler (retired at once); the refocus presumption is gone from the card. Electron: `reviewCardOutcome` table; after `syncWithBackend` resolves with a remote `has_reviewed`, main records `review_prompt: acted` (a retired card is left alone); `submitReview` with a `fetch` that throws twice returns `{ ok:false, error:'network_error' }` after two attempts, and with a `fetch` that throws once then succeeds returns `ok:true`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS (+ `test:components`, typechecks).
- [ ] **Step 5: Commit** `fix(cards): support retires on its button, reviews from anywhere retire the review card`.

### Task 5: Browser extension — connecting retires it, a failed store link says so (spec §6 row 9)

**Files:**
- Modify: `electron/ipcHandlers.ts` (`open-external` returns `{ ok: boolean }`), `electron/preload.ts`, `src/types/electron.d.ts`, `src/components/onboarding/BrowserExtensionToaster.tsx`, `src/components/onboarding/OrchestratedToasterHost.tsx`
- Test: `electron/services/__tests__/OpenExternalResult2026_09_26.test.mjs` (new), `src/components/onboarding/__tests__/BrowserExtensionToaster.test.mjs` (update)

- [ ] **Step 1: Failing tests** — `open-external` returns `{ok:true}` when `shell.openExternal` resolves, `{ok:false}` when it rejects, for a blocked protocol and for a non-string; extension card: connecting reports `onDismiss('connected')` and the host records `'never'` (retired, §6 row 9); install records `'acted'` only when `openExternal` answered `ok:true`; on `ok:false` the card stays open with "Couldn't open the Chrome Web Store" and a Copy link button (`navigator.clipboard.writeText(CHROME_STORE_URL)`), recording nothing.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (existing callers ignore the return value; `undefined` → `{ok:…}` is compatible).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `fix(cards): the extension card retires on connect and admits a store link that failed`.

### Task 6: Max/Ultra reachability (spec §6 row 18)

**Files:**
- Modify: `src/lib/cards/cardInputs.mjs`, `src/App.tsx` (focus refresh)
- Test: `src/lib/cards/__tests__/cardInputs.test.mjs`, `src/components/__tests__/CardInputsRefresh2026_09_26.test.mjs` (new)

- [ ] **Step 1: Failing tests** — `cardInputsFromSources({ licence:{isPremium:true, plan:'pro'}, usage:{ok:true, plan:'max', quota:{…}} }).planTier === 'max'` (the usage plan is fresher: a Pro→Max upgrade never rewrites the stored licence plan); `usage.plan` absent → licence plan; App refreshes card inputs when the launcher window regains focus, at most once per 5 minutes.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `fix(cards): Max/Ultra reads the plan the server reports and notices quota mid-session`.

### Task 7: Every own AI route counts (Phase 0 deferred minor; spec §5 row 3 "no own provider key")

**Files:**
- Modify: `src/lib/trialPolicy.mjs` (+ `.d.mts`)
- Test: `src/lib/__tests__/TrialPolicy2026_09_26.test.mjs` (extend)

- [ ] **Step 1: Failing table rows** — `hasOwnAiKey` true for `ninerouterBaseURL` alone (keyless 9Router), a non-empty `codexOAuthTokens`, a non-empty `antigravityOAuthTokens`; still false for STT keys only, for an empty token object, and for an Ollama base URL alone (Ollama has a default URL and no explicit opt-in field — ruling, cost: a local-Ollama-only user still sees key-less cards).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm run -s test:lib` + the electron trial tests (rebuild first) → PASS.
- [ ] **Step 5: Commit** `fix(trial): a ChatGPT, Antigravity or keyless 9Router sign-in is an AI route of your own`.

### Task 8: Scheduler scenarios across launches (spec §11 scenarios 1-7)

**Files:**
- Test: `src/lib/onboarding/__tests__/schedulerScenarios2026_09_26.test.mjs` (new)

Real `OnboardingOrchestrator`, real `STAGES` + `QUIET_WINDOW_STAGE`, fake performance clock, persisted `localStorage` carried across simulated launches, ledger outcomes applied with `applyOutcome` as the host would:
1. New user, no keys: day 1 Permissions → trial promo (after 60 s); extension on a later launch; no promo before 24 h.
2. Own keys on day 4: "Three services" (`natively_api_existing`); the next promo waits 72 h.
3. Three "later"s: back after 7 and 21 days, then never.
4. Crash while a card is open (persisted `activeToasterId`, no outcome): no strike; the card can return on a later launch.
5. Meeting starts: nothing new opens; the open card stays.
6. Trial ended open: nothing else opens; an open card leaves the slot.
7. Pro at 80 %: Max/Ultra shows; "never" retires it for good.

- [ ] **Step 1: Write the scenarios.** **Step 2: Run** — any failure is a production bug: fix it test-first (ledger a ruling if the spec is the one that is wrong). **Step 3: Commit** `test(onboarding): the spec's seven scheduler scenarios, across launches`.

### Task 9: Verify

- [ ] `npm run -s typecheck:ts7 && npm run -s typecheck:ts7:electron && npm run -s typecheck:premium`, `npm run -s test:lib`, `npm run -s test:components`, electron `*2026_09_26*` tests, full `npm test` (known env failures only).
- [ ] Live (isolated scratch instance, macOS, DEV `?forceTrialEnded=1`): Trial ended "Use my own keys" → Cleaning up → All set → "Add my keys" opens AI Providers. The trial promo's Start is NOT clicked live: it would claim a real server-side trial for this machine's hardware id; its states are covered by the Task 1 tests.
- [ ] Fresh reviewer on the whole phase; fix pass.
