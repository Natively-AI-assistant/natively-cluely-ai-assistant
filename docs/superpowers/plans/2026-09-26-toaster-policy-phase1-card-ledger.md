# Toaster Policy Phase 1: card ledger + policy module + migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A main-process card ledger that records, for every onboarding and promotional card, how often it was shown, its strikes, when it may return and whether it is retired — seeded from what users already did — with the policy rules in one pure module. No visible change yet: Phase 2 makes the scheduler obey it.

**Architecture:** `src/lib/cards/cardPolicy.mjs` holds every rule as pure functions over a plain ledger object (strike gaps, budget, day-1, priority, outcome effects, legacy migration). `electron/services/cards/CardLedger.ts` owns the file `card-ledger.json` in `app.getPath('userData')` (atomic writes, corrupt-file recovery) and applies the policy. IPC `cards:get`, `cards:record`, `cards:import-legacy` expose it; `cards:changed` broadcasts updates. Main counts real launches and imports its own legacy stores (DonationManager, review state, trial claimed) once; the launcher imports the renderer-side legacy keys once.

**Tech Stack:** Electron main (TypeScript), React renderer, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-26-toaster-policy-design.md` §2–§4, §7.1, §7.2, §8.

## Global Constraints

- Promo budget: 1 promotional card per rolling 72 h; first promo allowed 24 h after first launch.
- Strikes: a card shows at most 3 times ever (Evin's choice). 1st "no" → wait 7 d, 2nd "no" → wait 21 d, 3rd "no" → retired. Explicit never retires immediately. (The 60 d step in the spec is never reached under a 3-showing cap; see the Task 1 ruling.)
- Card classes: onboarding = `browser_extension`, `trial_promo`, `natively_api_new`; promotional (priority) = `max_ultra` 1, `natively_api_existing` 2, `profile_ad` 3, `jd_ad` 4, `review_prompt` 5, `support` 6.
- Follow-ups: `browser_extension` acted → one more showing after 7 d, then retired. `max_ultra` acted → retired until the given cycle end.
- Migration never overwrites real ledger data and runs once per source; imported strikes are capped at 2.
- Ledger path via `app.getPath('userData')`; no OS branches anywhere.

## Review Focus

- Corrupt or half-written `card-ledger.json` (crash mid-write, manual edit): the app must start with a fresh ledger, not crash, and keep a `.bak` of the bad file. Test in Task 2.
- Clock moved backwards (user changes the date): `nextEligibleAt` in the future must not become permanent; eligibility compares with `>=` and a negative elapsed time only delays. Test: `promoBudgetOpen` with `now < lastPromoShownAt` returns false, then true after the budget from the stored time.
- Unknown card id or outcome from the renderer (typo, older build): `cards:record` rejects it and writes nothing. Test in Task 3.
- Legacy data with garbage types (`natively_dismissed_campaigns` not an array, non-numeric timestamps): migration ignores the bad field and imports the rest. Test in Task 1 and Task 4.
- Two windows recording at once: records are applied to the in-memory ledger synchronously in main, so there is no lost update. Test: two records in a row both land.

---

### Task 1: Pure policy module

**Files:**
- Create: `src/lib/cards/cardPolicy.mjs`, `src/lib/cards/cardPolicy.d.mts`
- Test: `src/lib/cards/__tests__/cardPolicy.test.mjs`

**Interfaces (Produces):**
- `DAY_MS`, `CARDS` (id → `{ cls: 'onboarding'|'promo', priority: number|null, followUpAfterActedMs?: number, actedRetiresUntilCycleEnd?: boolean }`), `STRIKE_GAPS_MS`, `PROMO_BUDGET_MS`, `DAY_ONE_MS`, `OUTCOMES = ['shown','acted','later','never','interrupted']`
- `emptyLedger(now): Ledger` — `{ version: 1, firstLaunchAt: now, launchCount: 0, lastPromoShownAt: null, imported: {}, cards: {} }`
- `entryOf(ledger, id): Entry` — `{ shows: 0, strikes: 0, nextEligibleAt: null, retired: false, retiredReason: null, retiredUntil: null, lastShownAt: null, followUpPending: false }` merged with stored
- `applyOutcome(ledger, id, outcome, now, meta?): Ledger` (pure, returns a new object)
- `isCardAvailable(ledger, id, now): boolean`
- `promoBudgetOpen(ledger, now): boolean`, `dayOneOver(ledger, now): boolean`
- `pickPromotional(candidateIds, ledger, now): string | null`
- `migrateLegacy(ledger, legacy, now): Ledger` where `legacy = { firstSeenAt?, startupCount?, reviewed?, reviewNever?, donated?, donationShows?, donationLastShownAt?, dismissedAds?, trialClaimed?, stageShows? }`

Outcome rules (hand-derived test table):

| Start | Outcome | Result |
|---|---|---|
| fresh | shown | shows 1, lastShownAt now; promo also sets lastPromoShownAt |
| fresh | later | strikes 1, nextEligibleAt now+7d |
| strikes 1 | later | strikes 2, nextEligibleAt now+21d |
| strikes 2 | later | strikes 3, retired, reason 'strikes' |
| any | never | retired, reason 'never' |
| fresh | acted (generic) | retired, reason 'acted' |
| browser_extension fresh | acted | not retired, followUpPending, nextEligibleAt now+7d |
| browser_extension followUpPending | acted or later | retired, reason 'acted' |
| max_ultra | acted, meta.until = T | retiredUntil T, not retired |
| any | interrupted | unchanged |

Ruling (ledgered in Task 1): the user's chosen option reads "each promo shows at most 3 times ever … 7 → 21 → 60 days". Three showings means the 3rd "no" retires, so only the 7 d and 21 d gaps are ever used; `STRIKE_GAPS_MS` keeps `[7d, 21d]`. Cost if wrong: one extra showing after 60 d, a one-line change.

- [ ] Steps: failing table-driven tests → implement → pass → commit `feat(cards): pure card policy`.

### Task 2: CardLedger service (main)

**Files:**
- Create: `electron/services/cards/CardLedger.ts`
- Test: `electron/services/__tests__/CardLedger2026_09_26.test.mjs` (requires `dist-electron/electron/services/cards/CardLedger.js`; constructs `new CardLedger(tmpFile, clock)` directly, no Electron)

**Interfaces (Produces):** `class CardLedger { constructor(filePath: string, now?: () => number); get(): Ledger; record(id, outcome, meta?): Ledger; recordLaunch(): Ledger; importLegacy(source: 'main'|'renderer', legacy): Ledger; static getInstance(): CardLedger }` — `getInstance` anchors on `globalThis` and uses `path.join(app.getPath('userData'), 'card-ledger.json')`. Atomic save: write `<file>.tmp`, then `rename`. A file that fails to parse is renamed to `<file>.bak` and a fresh ledger starts. `importLegacy` is a no-op when `ledger.imported[source]` is set.

- [ ] Steps: failing tests (persist across instances; atomic tmp gone after save; corrupt file → fresh + .bak; import once per source; launchCount increments; two records both land) → implement → build → pass → commit `feat(cards): main-process card ledger`.

### Task 3: IPC + main wiring

**Files:**
- Modify: `electron/ipcHandlers.ts` (`cards:get`, `cards:record` with id/outcome validation against `CARDS`/`OUTCOMES`, `cards:import-legacy` with shape validation; broadcast `cards:changed`)
- Modify: `electron/main.ts` (beside `reviewService.recordSessionStart()`: `CardLedger.getInstance().recordLaunch()` and `importLegacy('main', gatherMainLegacy())`)
- Create: `electron/services/cards/mainLegacy.ts` (`gatherMainLegacy()`: DonationManager state, ReviewService local state, CredentialsManager trialClaimed; each read in its own try/catch)
- Modify: `electron/preload.ts`, `src/types/electron.d.ts` (`cardsGet`, `cardsRecord`, `cardsImportLegacy`, `onCardsChanged`)
- Test: `electron/services/__tests__/CardsIpc2026_09_26.test.mjs` (executing harness like the trial tests)

- [ ] Steps: failing tests (record valid → persisted + broadcast; unknown id/outcome → `{ ok: false }` and nothing written; import-legacy rejects non-object) → implement → build → pass → commit `feat(cards): IPC for the card ledger`.

### Task 4: Renderer legacy import

**Files:**
- Create: `src/lib/cards/rendererLegacy.mjs` + `.d.mts` (`collectRendererLegacy(storage)` — reads `natively_onboarding_state_v1` (completed, lastShownTimes, startupCount), `natively_dismissed_campaigns`; maps campaign ids `natively_api`→[`natively_api_new`,`natively_api_existing`], `profile`→`profile_ad`, `jd`→`jd_ad`, `max_ultra_upgrade`→`max_ultra`; stage ids `browser_extension`, `trial_promo`, `support`, `review_prompt` map to themselves)
- Modify: `src/App.tsx` (launcher only, once per mount: `cardsImportLegacy(collectRendererLegacy(localStorage))`)
- Test: `src/lib/cards/__tests__/rendererLegacy.test.mjs`

- [ ] Steps: failing tests (fake storage; garbage values ignored) → implement → wire → typecheck → commit `feat(cards): import the launcher's legacy card history once`.

### Task 5: Verify

- [ ] `npm run test:lib`, `npm run typecheck:ts7`, `npm run typecheck:electron`, the new electron test files, then a fresh reviewer over the branch diff.
