# Toaster Policy Phase 0: paying-user trial lock-in — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user whose trial expired but who has since paid (licence), saved a real Natively key, or saved their own AI key never sees the "Trial ended" card again and never loses résumé/JD data to the expiry wipe.

**Architecture:** One pure decision module (`src/lib/trialPolicy.mjs`) decides, for an expired trial token, whether to show the card, wipe profile data, and clear the token. The main process applies it in one function (`settleExpiredTrial`) called from every place the trial state can change: the startup read, the status poll, licence activation, Natively-key save, and every credentials change. The expiry wipe moves from the renderer (which ran it in every window) into that function, runs once per trial, and never for a licensed user. The renderer only shows the card when main says so.

**Tech Stack:** Electron main (TypeScript, esbuild bundle in `dist-electron`), React renderer, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-26-toaster-policy-design.md` §5 #3 and §9 Phase 0.

## Global Constraints

- Shared code only: no `process.platform` branches; paths via `app.getPath('userData')`.
- The trial token clear must keep `trialClaimed` (CredentialsManager.clearTrialToken already does).
- A trial with time left is never touched by any of this.
- `trial:wipe-profile-data` must refuse to run for a licensed user (defence in depth).

## Review Focus

- Licence activated **during a live trial**: the trial must keep running (the licence is the Pro app, not AI access). Test: live token + licence → settle does nothing.
- Several windows poll at once: settle must be idempotent (second call sends nothing, wipes nothing). Test: call twice, one `trial-ended`.
- Server says expired before the local clock does: `trial:status` must settle too. Test via status with a stubbed `expired: true` reply.
- Own **STT-only** key (Deepgram) is not an AI key: the card must still show. Test in the pure module.
- Degraded credential store: `clearTrialToken` refuses while degraded; settle must not crash and must still hide the card when licensed. Covered by returning the decision independent of the clear's success.

---

### Task 1: Pure trial policy module

**Files:**
- Create: `src/lib/trialPolicy.mjs`, `src/lib/trialPolicy.d.mts`
- Test: `src/lib/__tests__/TrialPolicy2026_09_26.test.mjs`

**Interfaces:**
- Produces: `hasOwnAiKey(creds): boolean`; `resolveExpiredTrial({ hasToken, expired, licensed, hasRealNativelyKey, hasOwnAiKey, wipedForThisTrial }): { showEndedCard: boolean, wipe: boolean, clearToken: boolean }`

- [ ] **Step 1: Write the failing test** (table-driven, literal expectations)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasOwnAiKey, resolveExpiredTrial } from '../trialPolicy.mjs';

const base = { hasToken: true, expired: true, licensed: false, hasRealNativelyKey: false, hasOwnAiKey: false, wipedForThisTrial: false };
const CASES = [
  ['no token',                       { hasToken: false },                          { showEndedCard: false, wipe: false, clearToken: false }],
  ['live trial',                     { expired: false },                           { showEndedCard: false, wipe: false, clearToken: false }],
  ['live trial + licence',           { expired: false, licensed: true },           { showEndedCard: false, wipe: false, clearToken: false }],
  ['expired, nothing else',          {},                                           { showEndedCard: true,  wipe: true,  clearToken: false }],
  ['expired, already wiped',         { wipedForThisTrial: true },                  { showEndedCard: true,  wipe: false, clearToken: false }],
  ['expired + licence',              { licensed: true },                           { showEndedCard: false, wipe: false, clearToken: true }],
  ['expired + real Natively key',    { hasRealNativelyKey: true },                 { showEndedCard: false, wipe: true,  clearToken: true }],
  ['expired + own AI key',           { hasOwnAiKey: true },                        { showEndedCard: false, wipe: true,  clearToken: true }],
  ['expired + key, already wiped',   { hasOwnAiKey: true, wipedForThisTrial: true }, { showEndedCard: false, wipe: false, clearToken: true }],
];
for (const [name, patch, want] of CASES) {
  test(`resolveExpiredTrial: ${name}`, () => assert.deepEqual(resolveExpiredTrial({ ...base, ...patch }), want));
}

test('hasOwnAiKey: any LLM key, base URL or custom provider counts', () => {
  for (const f of ['geminiApiKey', 'groqApiKey', 'openaiApiKey', 'claudeApiKey', 'deepseekApiKey', 'nvidiaNimApiKey',
    'openrouterApiKey', 'fluxionApiKey', 'ninerouterApiKey', 'litellmBaseURL']) {
    assert.equal(hasOwnAiKey({ [f]: 'x' }), true, f);
  }
  assert.equal(hasOwnAiKey({ customProviders: [{ id: 'a' }] }), true);
  assert.equal(hasOwnAiKey({ curlProviders: [{ id: 'a' }] }), true);
});

test('hasOwnAiKey: blank values, STT-only keys and the Natively key do not count', () => {
  assert.equal(hasOwnAiKey({}), false);
  assert.equal(hasOwnAiKey(null), false);
  assert.equal(hasOwnAiKey({ geminiApiKey: '   ' }), false);
  assert.equal(hasOwnAiKey({ deepgramApiKey: 'x', groqSttApiKey: 'x', nativelyApiKey: 'x' }), false);
  assert.equal(hasOwnAiKey({ customProviders: [], curlProviders: [] }), false);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --experimental-strip-types --test src/lib/__tests__/TrialPolicy2026_09_26.test.mjs` → FAIL, module not found.

- [ ] **Step 3: Implement** `src/lib/trialPolicy.mjs` (header comment explaining the lock-in bug) with `AI_KEY_FIELDS` = the ten fields above, `hasOwnAiKey` checking trimmed strings and non-empty provider arrays, and `resolveExpiredTrial`:

```js
export function resolveExpiredTrial(s) {
  if (!s || !s.hasToken || !s.expired) return { showEndedCard: false, wipe: false, clearToken: false };
  const clearToken = !!(s.licensed || s.hasRealNativelyKey || s.hasOwnAiKey);
  return { showEndedCard: !clearToken, wipe: !s.licensed && !s.wipedForThisTrial, clearToken };
}
```

Plus `trialPolicy.d.mts` declaring both.

- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** `feat(trial): pure policy for an expired trial token`.

### Task 2: Main process settles an expired trial in one place

**Files:**
- Modify: `electron/services/SettingsManager.ts` (add `trialExpiryWipedFor?: string` to `AppSettings`)
- Modify: `electron/ipcHandlers.ts`: extract `wipeTrialProfileData()`; add `settleExpiredTrial(reason)`; call it from `trial:get-local`, `trial:status`, `license:activate` (success), `set-natively-api-key` (accepted save), `broadcastCredentialsChanged`; make `trial:wipe-profile-data` refuse when licensed.
- Test: `electron/services/__tests__/TrialSupersededByPurchase2026_09_26.test.mjs` (unlicensed process) and `electron/services/__tests__/TrialSupersededLicensed2026_09_26.test.mjs` (writes `license.enc` before the bundle loads, so the whole process is licensed).

**Interfaces:**
- Consumes: Task 1's `hasOwnAiKey`, `resolveExpiredTrial` (imported from `../src/lib/trialPolicy.mjs`).
- Produces: `trial:get-local` → adds `showEndedCard: boolean`; returns `hasToken: false, superseded: true` when it cleared the token. `trial:status` → adds `showEndedCard` when `expired`. Main sends `trial-ended` `{ choice: 'superseded' }` whenever it clears an expired token.

`settleExpiredTrial(reason)`:
1. Read token, expiry, startedAt; `expired` = expiry ≤ now. Return a no-op decision if no token or not expired.
2. `licensed` = `LicenseManager.getInstance().isPremium()` (false if the module is missing); `hasRealNativelyKey` = Natively key set and not the trial sentinel; `hasOwnAiKey(cm.getAllCredentials())`; `wipedForThisTrial` = `SettingsManager.get('trialExpiryWipedFor') === startedAt`.
3. `resolveExpiredTrial(...)`. If `wipe`: run `wipeTrialProfileData()`, then `SettingsManager.set('trialExpiryWipedFor', startedAt)`. If `clearToken`: `cm.clearTrialToken()` and send `trial-ended` `{ choice: 'superseded' }` to every window.
4. Return the decision. Idempotent: after a clear there is no token; after a wipe the marker blocks a second one.

Tests (executing the compiled handlers, harness copied from `TrialEndsOnlyOnPurchaseOrByok2026_09_25.test.mjs`):
- Unlicensed file:
  - expired trial, nothing else: get-local → `showEndedCard: true`; token kept; marker set; a second call wipes nothing.
  - expired trial + own Gemini key saved via `set-gemini-api-key` (or `cm.setGeminiApiKey` then a credentials change) → token cleared, one `trial-ended` with `choice: 'superseded'`, `showEndedCard: false`.
  - expired trial + accepted real Natively key → token cleared.
  - Deepgram-only key → card still shows.
  - trial with time left → nothing changes.
- Licensed file:
  - expired trial → get-local `showEndedCard: false`, token cleared, **no wipe** (marker unset), `trial:wipe-profile-data` returns `{ success: false, error: 'licensed' }`.
  - live trial + licence → token kept.

- [ ] Step 1: write both test files; Step 2: build (`npm run build:electron`) and run them → FAIL; Step 3: implement; Step 4: rebuild and pass; Step 5: commit `fix(trial): a paying user is never locked behind the Trial ended card`.

### Task 3: Renderer follows main's decision

**Files:**
- Modify: `src/App.tsx` (trial effect): drop both renderer-side expiry wipes; show the card only when `local.showEndedCard` / `res.showEndedCard` is true.
- Modify: `electron/preload.ts` and `src/types/electron.d.ts` types for `getLocalTrial` / `getTrialStatus` (`showEndedCard?: boolean`, `superseded?: boolean`).

The existing `onTrialEnded` listener already closes the card and clears the banner when main sends `trial-ended`, so a licence or key arriving while the card is open closes it with no new wiring.

- [ ] Steps: edit; `npm run typecheck:ts7`; `npm run test:lib`; commit `fix(trial): the launcher shows Trial ended only when main says so`.

### Task 4: Verify

- [ ] `npm run test:lib`, `npm run typecheck:ts7`, `npm run typecheck:electron`, the two new electron test files plus `TrialEndsOnlyOnPurchaseOrByok2026_09_25.test.mjs` and `TrialActivationRuntimeSync2026_09_25.test.mjs`.
- [ ] Fresh reviewer subagent over the branch diff.
