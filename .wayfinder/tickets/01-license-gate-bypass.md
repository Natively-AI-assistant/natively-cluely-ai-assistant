# Bypass the premium license gate unconditionally

**Labels:** `wayfinder:task`  
**Map:** [Natively Pro Features — Open Source Reimplementation](../map.md)  
**Blocks:** 02, 03, 04, 05, 06

## Question

Where exactly does the license gate need to change so that all pro features are accessible without a license key, and what is the minimal diff to make it unconditional?

## Scope

- `electron/ipcHandlers.ts` — `isProOrTrialActive()` function (line ~301): make it `return true`
- `electron/premium/featureGate.ts` — `isPremiumAvailable()`: make it `return true` so main.ts stops trying to require the premium submodule
- `electron/main.ts` — the try/require block at lines 1036–1044 that loads `KnowledgeOrchestratorClass` and `KnowledgeDatabaseManagerClass`: needs to fall through gracefully to the OSS implementation once ticket 06 is done; for now ensure it doesn't crash when premium/ is empty
- Verify: run the app and confirm settings panels that were previously locked (Modes, Profile Intelligence) no longer show a paywall

## Answer

**Resolution.** The license gate is bypassed at its single choke point plus the availability probe. The `main.ts` require block was left untouched because it already fails gracefully (ticket 06 owns the OSS orchestrator replacement).

**Files changed (2):**

- `electron/ipcHandlers.ts` — `isProOrTrialActive()` (~line 303): replaced the LicenseManager + trial-token body with an unconditional `return true`. This is the real gate — all 30 `!isProOrTrialActive()` call sites (Modes, Profile Intelligence, evidence packs, etc.) now short-circuit to unlocked. Signature unchanged (`(): boolean`), no imports touched.
- `electron/premium/featureGate.ts` — `isPremiumAvailable()`: now sets `_premiumAvailable = true` and returns it, without probing the empty `premium/` dir. Because it returns before any `require()`, this does NOT introduce a startup crash. It also has zero runtime callers today, so the effect is purely to satisfy the documented contract for future callers; `resetFeatureGate()` remains functional.

**Not changed:**

- `electron/main.ts` (lines 1036–1046): the `try/require` block loading `KnowledgeOrchestratorClass` / `KnowledgeDatabaseManagerClass` / `textHasCompEvidence` already catches the missing-module failure and logs "Knowledge modules not available", setting the classes to `null`. It boots cleanly with an empty `premium/` dir as-is. Wiring the OSS orchestrator is ticket 06 — out of scope here.

**Diff summary:**

```
ipcHandlers.ts   isProOrTrialActive: full premium/trial body → `return true;`
featureGate.ts   isPremiumAvailable: require()-probe → `_premiumAvailable = true; return _premiumAvailable;`
```

**Verification:**

- `electron/premium/featureGate.ts` typechecks clean standalone (`tsc --noEmit`, no errors).
- Full `npm run build:electron` could NOT be run in this environment: `npm install` fails with registry auth error `E401` (private-registry dependency), so `esbuild`/`node_modules` are unavailable. This is an environment/credentials limitation, not a code defect. Both edits are minimal, additive-free changes (no new imports, no signature changes) and are type-safe by inspection.
