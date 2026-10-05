# Toaster Policy Phase 4: Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dead keys and dead code the card ledger made obsolete, and make every card override DEV-only and scheduled like a real card.

**Architecture:** Deletions pinned by source assertions (nothing may write a key nobody reads, or keep an IPC nobody calls); DEV overrides gated on `import.meta.env.DEV` in the renderer, and a forced card goes through the orchestrator (`forceCard`) so it takes the one card slot and records no ledger outcome.

**Tech Stack:** Electron + React renderer, TypeScript, node:test.

**Spec:** `docs/superpowers/specs/2026-09-26-toaster-policy-design.md` (§9 Phase 4, §10 Dev overrides).

## Global Constraints

- Shared code; nothing branches on the operating system.
- A forced card is still a stage (cannot overlap another) and records no ledger outcome (§10).
- Every override is DEV-build only: a packaged (production) renderer ignores `?forceAd`, `?review=`, `?forceTrialEnded`, `?extToaster`, `?noorch`, `?isolate` (§10).
- Keys already migrated into the ledger are no longer written; nothing reads them after the one-time import.

## Review Focus

- A production build with `?review=force` or `window.__reviewForceShow = true`: no review card (today `isDevForceShow` returns true before it checks DEV).
- DEV `?forceAd=profile` while another card is open: the ad waits (one slot), and closing it writes nothing to the ledger.
- The premium submodule absent: removing `useAdCampaigns` from `src/premium/index.tsx` must not break the open-source build (the stub path).
- An existing user's legacy keys (`natively_dismissed_campaigns`, `last_shown_time_<ad>`) are still read once by the renderer import (`collectRendererLegacy`) — only the WRITERS go.
- `review:record-session` removal: main still records sessions itself (`main.ts` `recordSessionStart` / `beforeQuit`).

---

### Task 1: Dead keys and dead code (spec §9 Phase 4)

**Files:** `src/components/onboarding/BrowserExtensionToaster.tsx` (`natively_ext_connect_dismissed_v1`, `persistDismiss`), premium ads (`stamp()` writes of `natively_*_dismissed`), `premium/src/useAdCampaigns.ts` + `src/premium/index.tsx` (export), `src/App.tsx` (`natively_show_profile_toaster`, the always-mounted ad elements), `src/lib/onboarding/orchestrator.ts` (`queue:set`), `electron/ipcHandlers.ts` + `electron/preload.ts` + `src/types/electron.d.ts` (`review:record-session`), `electron/DonationManager.ts` (`SHOW_DELAY_MS`), `src/components/trial/FreeTrialBanner.tsx` (`PLAN_PRO_URL`), `electron/preload.ts` + `src/types/electron.d.ts` (`wipeTrialProfileData`, no renderer caller since Phase 3; the `trial:wipe-profile-data` IPC goes with it).
**Test:** `src/components/__tests__/DeadCardKeys2026_09_26.test.mjs` (new) + updates to the tests that pinned the removed text.

- [ ] **Step 1: Failing source test** — none of those identifiers/keys appear in the files above (the renderer legacy import `src/lib/cards/rendererLegacy.mjs` still reads its legacy keys); `useAdCampaigns` is not exported by `src/premium/index.tsx`; App mounts no ad element outside the orchestrator host.
- [ ] **Step 2: Run** → FAIL. **Step 3: Delete.** **Step 4: Run** typechecks (ts7, ts7:electron, premium), `test:lib`, `test:components`, rebuild + `npm test` → PASS (known env failures only).
- [ ] **Step 5: Commit** `chore(cards): drop the keys and code the card ledger replaced`.

### Task 2: DEV-only overrides, scheduled like a card (spec §10)

**Files:** `src/lib/onboarding/orchestrator.ts` (`forceCard(id)`; snapshot `forcedToasterId`), `src/components/onboarding/OrchestratedToasterHost.tsx` (forced showing records nothing; isolate flags DEV-gated), `src/App.tsx` (`?forceAd` → `forceCard`, `?noorch` DEV-gated, the DEV review host only on explicit `?review=force`), `src/components/ReviewPromptHost.tsx` (`isDevForceShow` and the `window.review*` helpers DEV-only), `src/components/onboarding/BrowserExtensionToaster.tsx` (`?extToaster` DEV-only).
**Test:** `src/lib/onboarding/__tests__/orchestratorForceCard2026_09_26.test.mjs` (new, behavioural) + `src/components/__tests__/DevOverridesGated2026_09_26.test.mjs` (new, source).

- [ ] **Step 1: Failing tests** — `forceCard('profile_ad')` with the slot empty makes it active and `getSnapshot().forcedToasterId === 'profile_ad'`; with another card open it returns false and changes nothing; `markDismissed` clears `forcedToasterId`. Host: a forced showing neither starts the recorder nor records an outcome. Source: every override read is behind `import.meta.env.DEV`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (+ suites).
- [ ] **Step 5: Commit** `chore(cards): card overrides are DEV-only and take the card slot like a real card`.

### Task 3: Verify

- [ ] Typechecks, `test:lib`, `test:components`, full `npm test`, a live DEV `?forceAd=profile` check in the isolated instance (the ad shows, its close writes nothing to `card-ledger.json`), fresh reviewer, fix pass.
