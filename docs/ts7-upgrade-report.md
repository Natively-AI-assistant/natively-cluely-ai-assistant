# TypeScript 7 Upgrade — Phase 1 Report (STOPPED — decision required)

**Date:** 2026-08-14
**Branch:** `chore/ts7-upgrade`
**Status:** Phase 1 ~95 % complete, **halted on one architectural conflict I created.**
Phases 2–4 **not started.**
**Companion:** `docs/ts7-upgrade-audit.md` (Phase 0)

---

## 0. Why this stopped

The brief's stop rule:

> *"If any gate fails and the failure is not caused by your change … proceed only if your diff is
> provably not the cause; otherwise STOP and report."*

Four tests fail with `tsc emission failed — LLMHelper.js missing from isolated tree`, and **my config
change is provably the cause.** §5 has the analysis and a ready-to-apply fix, but it needs a decision
because it introduces a second tsconfig. Everything else in Phase 1 is done and verified.

---

## 1. Scorecard

| Gate | Baseline (before any change) | After Phase 1 | Verdict |
|---|---|---|---|
| `npm run build` | exit 0, 0 TS errors | **exit 0, 0 TS errors** | ✅ |
| `npm run build:electron` (esbuild) | exit 0 | **exit 0** | ✅ unaffected by `module: Preserve` |
| `npm run typecheck:electron` | exit 0, 0 errors | **exit 2, exactly the 2 deferred** | ✅ meets the stated criterion |
| `npm run test:lib` | exit 0 | **exit 0** | ✅ |
| `npm run test:scripts` | exit 0 | **exit 0** | ✅ |
| `npm test` | exit 1 — **128 fail / 7443** (pre-existing) | exit 1 — 123 fail / 7410 | ⚠️ 4 self-inflicted remain (§5) |
| lint | — | — | **N/A — no root ESLint config exists** (audit §7.4) |
| `npm run dist` | not run | **not run** | ⛔ blocked behind §5 |
| `npm run test:intelligence` | not run | **not run** | ⛔ blocked behind §5 |

**Strict findings: 52 of 54 fixed, 2 deferred, 0 suppressed.**
No `any` added, no `@ts-ignore`, no strict flag relaxed. The one sanctioned `as any` (decision 2) is the
`gpu-process-crashed` event name, in both listeners, as specified.

---

## 2. Versions

| | Before | After |
|---|---|---|
| `typescript` (declared / installed) | `^5.6.3` / 5.9.3 | **unchanged** — Phase 2 was to add the `typescript7` alias |
| Type-checking compiler | TS 5.9.3 | TS 5.9.3 (Phase 1 validates on the current compiler by design) |
| Emit | esbuild / vite | unchanged |

---

## 3. Config diff

**`tsconfig.json`** — added `"types": ["node", "react-syntax-highlighter"]`. TS 7 dropped `@types/*`
auto-inclusion; without this the root project reports 69 errors under TS 7 and 0 with it (audit §4.2).
Verified: still 0 errors under TS 5.9.3.

**`electron/tsconfig.json`**

| Option | Before | After | Why |
|---|---|---|---|
| `baseUrl` | `"."` | **removed** | TS5102. Not load-bearing (audit §6) — no `paths` replacement needed. |
| `moduleResolution` | `"node"` | `"bundler"` | TS5108 (node10 removed). |
| `module` | `"CommonJS"` | `"Preserve"` | Required by `bundler`. **This is the §5 conflict.** |
| `noImplicitAny` | `true` | removed | Subsumed by `strict`. |
| `strict` | *(absent)* | `true` | Decision 1 / audit §7.2 option D. |
| `types` | *(absent)* | `["node"]` | TS 7 requires it explicitly. |
| `noEmit` | *(absent)* | `true` | **This is the §5 conflict.** |
| `include` | had `../premium/electron/**/*.ts` | premium removed from the **root file set** | Scopes `strict` to this repo. premium still type-checks as a *dependency* — verified **0 × TS2307**. |

Old values are preserved in comments in both files.

**`package.json` / `scripts/build-electron.js`** (decision 3): removed `build:electron:tsc`; `watch` now
runs `node scripts/build-electron.js --watch`; the esbuild script gained `--watch` via
`context()`/`watch()`. Both paths smoke-tested. No files deleted.

---

## 4. Strict fixes (52)

Every fix is type-level or a guard that provably cannot change behaviour. Grouped by technique:

**Fixed at the declaration so call sites keep their exact source text** *(see §6 — this repo has tests
that assert on literal source)*
- `IntelligenceEngine`: typed `orchestrator` at its binding rather than adding a type argument to
  `withTimeout(...)`. `getKnowledgeOrchestrator()` is declared `: any`, which collapsed the grounding
  result to `{}` and made 7 property reads fail.
- `LLMHelper`: typed the `require('./services/ModesManager')` (`as typeof import(...)` — already an
  idiom here) so `getInstance()` has a real return type and the assignment narrows `| null` away,
  letting the read keep its plain dot.

**Generic-signature correction (type-level only)**
- `withTimeout<T, F = T>`: a timeout fallback is not the same type as the resolved value. Sharing one
  parameter collapsed `T` onto the fallback's `null`. `F = T` keeps every other caller inferring as
  before.

**Type-only import**
- `import type { PromptAssemblyResult }` in `IntelligenceEngine` (fully erased; adds no `require`).
  Restores real checking on the seven grounding reads instead of masking them.

**Justified non-null assertions** — each with a one-line reason, each provably dominated by a guard:
`nativelyKey` (earlier throw), `response` (definite-assignment; invariant documented **and flagged as
fragile** — see §7), `dismissed_count` (the `=== 0` branch always returns), `cachedPromptIds`
(assigned on the same straight line), `this.db` ×2 (guarded at method entry; tsc discards narrowing
inside `catch`), `manualOwnership` ×5 (assigned unconditionally immediately above), `selectedPath`
(guard + assignment on the line above), `app.dock` ×1 (expression position only).

**Guards that preserve control flow**
- `app.dock` ×6 statement-position calls wrapped `if (app.dock) app.dock.hide();` — restores the exact
  literal, narrows correctly (no call between guard and use), and skips nothing (the guard wraps only
  the dock call, not the sibling tray call). All sites were already darwin-gated.

**Sentinel reconciliation (both values falsy; callee behaviour unchanged)**
- `?? null` on two optional calls; `?? undefined` on `showCropper()`; `|| ''` on two question
  fall-throughs (the idiom already used 9× in that file); `?? false` on two hoisted-`var` reads that
  already had `catch { return false }`.

**Catch-bound `unknown`** — asserted to only the shape actually read
(`(e as { message?: string })?.message`), preserving the exact `?.message || e` semantics. 3 sites.

**Signature widening** — `processAndSaveMeeting`'s `usage: any[]` → `any[] | undefined`, stating the
contract callers already satisfy. Verified the callee only passes `usage` through (line 226) and never
dereferences it, so this does not hide a runtime throw.

**Overload selection** — the LAN dialog: Electron types `(options)` and `(parent, options)` but not
`(undefined, options)`. Choosing by parent presence leaves the runtime call identical.

---

## 5. ⛔ BLOCKER — `module: Preserve` + `noEmit` breaks four tsc-emitting tests

Four tests build an isolated CJS tree by running the **project tsconfig through tsc for emit**:

```js
execSync(`node node_modules/.bin/tsc -p electron/tsconfig.json --outDir ${target}`)
// then: createRequire(...)  → loads the emitted LLMHelper.js as CommonJS
```

| Test |
|---|
| `electron/llm/__tests__/EvidenceResolverWiringIdentity2026_07_12.test.mjs` |
| `electron/services/__tests__/LLMHelperNegotiationCoachingGate.test.mjs` |
| `electron/services/__tests__/PhoneChatRouteOptions.test.mjs` |
| `electron/intelligence/__tests__/ContextOsProductionDefaultRollout2026_07_18.test.mjs` |

Two independent reasons they now fail:

1. `noEmit: true` — `--outDir` does not override it, so nothing is emitted.
2. `module: "Preserve"` — even with emit re-enabled, tsc would preserve `import`/`export`, and these
   tests `require()` the output. **Preserve can never satisfy them.**

**This is a genuine miss in the Phase 0 audit.** §2.3 concluded "emit is already 100 % esbuild" on the
strength of the *package scripts*. It never grepped the test suite for `tsc` invocations, and tsc-emit
turns out to have a fourth consumer beyond `build:electron:tsc` and `watch`.

**Why there is no free fix.** `moduleResolution: bundler` *requires* `module: esnext`/`preserve`.
`CommonJS` + `node16` is rejected (TS5110). The only TS7-legal setting that emits requireable CJS is
`module: Node16` + `moduleResolution: node16`, which demands extensioned relative imports
(12 × TS2835 measured) — a large, unrelated change to import statements across the main process.

**Recommended fix (not applied — needs your decision):** give the tests a dedicated emit config.

```jsonc
// electron/tsconfig.emit.json — tsc-for-emit ONLY (the 4 isolated-tree tests).
// The main project is check-only; this exists because those tests require() the output.
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "module": "Node16",
    "moduleResolution": "node16"
  }
}
```

…and point the four `execSync` lines at `electron/tsconfig.emit.json`. The TS2835 errors this config
reports are harmless here: tsc still emits (no `noEmitOnError`), and all four tests already swallow the
compiler's exit status (`try { execSync(...) } catch { /* expected */ }`) and assert only on the emitted
file.

Alternatives, if you'd rather not add a second config: (a) migrate those four tests to esbuild, matching
how the app is actually built; (b) revert `module` to `CommonJS`, keep `moduleResolution: node`, and
accept that `electron/tsconfig.json` is not TS7-legal until the tests move — which defers the whole
migration for the main process.

---

## 6. ⚠️ Class of regression worth knowing about

**This repo has many tests that assert on literal source text** — cross-platform parity guards,
wiring-order guards, adjacency guards. Type-only annotations change that text and break them, with no
behavioural change whatsoever. Four such breaks occurred and all four are fixed:

| Guard | Asserted literal | Resolution |
|---|---|---|
| `WindowsPlatformParity` | `'app.dock.hide();'`, `'app.dock.show();'` | wrapped in `if (app.dock)`, literal restored — 22 pass / 0 fail |
| `ActivationPolicyOrdering` | `/app\.dock\.hide\s*\(\s*\)/` | same — 3 pass / 0 fail |
| `WtaParallelPrestream` | `'await withTimeout(orchestrator.processQuestion('` | typed at the declaration — 8 pass / 0 fail |
| `WhatToAnswerSnapshotWiring` | `/modesMgrForInjection\.getActive…\?\.?\(_pinnedModeId\)/` | typed require — 30 pass / 0 fail |

**Rule for the rest of this migration: fix nullability at the binding, never on the asserted
expression.** No guard test was weakened or edited to accommodate a type change.

---

## 7. Deferred strict findings (2) — deliberate, per the no-suppression rule

| # | Site | Why deferred |
|---|---|---|
| 1 | `IntelligenceEngine:2268` `TS2322` | `queryOkfCards(pack: KnowledgePack, …)` vs `EvidenceResolver`'s DI port `{cards, packVersion}`. Genuinely ambiguous which side owns the contract; picking wrong changes a port used by several call sites. |
| 2 | `ModeHybridRetriever:1558` `TS18047` | `reranker` possibly null. **No guard found in 1520–1558; the enclosing scope was not traced.** Same shape as the real latent bug in §7.1, so it should be resolved deliberately, not asserted away. |

Gate criterion is therefore "no NEW errors beyond these two" — currently met exactly.

### 7.1 Latent bug found by strict, left in place

`LLMHelper.streamWithNatively`: if the loop's `signal.aborted` break is ever reached on attempt 0,
`response` is unassigned and `lastErr` unset, so `if (lastErr) throw` does not fire and `response.ok`
throws a `TypeError`. **Currently unreachable** — the caller-abort early-bail returns and there is no
`await` before the loop, and the retry paths always set `lastErr`. Documented at the declaration with an
explicit fragility warning: adding an `await` before the loop makes it reachable.

Also still open from Phase 0: **`gpu-process-crashed` is dead on Electron 43.** Both listeners are
retained as instructed, with the `TODO(electron43)` marker.

---

## 8. Working-tree contamination — disclosure

This branch is shared. Another task committed onto it twice, and edits files I edit, *while I work*
(tracked-modified went 21 → 38 during the session; `DatabaseManager.ts` became dirty *after* I checked
it was clean).

**`git add <file>` cannot separate hunks inside a shared file.** Consequence, stated plainly:

> 🔴 **Commit `20115636` contains ~127 lines of another task's in-flight Gemini model-bump work** in
> `LLMHelper.ts` (plus some in `main.ts`), swept in by a path-scoped `git add`. Nothing was lost, but
> that commit's message does not describe those lines. It was **left as-is deliberately** — the other
> task is actively committing to this branch, and rewriting shared history is the one action here that
> could destroy work.

After discovering this, every later commit touching a contaminated file was staged by **reconstructing
`HEAD` + only my edits**, syntax-checking the result with esbuild, and staging the blob directly — so
`ipcHandlers.ts`, `DatabaseManager.ts` and `LLMHelper.ts` were committed without consuming the other
task's changes, which remain intact and unstaged.

`main` untouched. Zero files deleted. Zero `git add -A` / `-a` / `stash`.

---

## 9. Commit ledger

| Commit | Contents |
|---|---|
| `fe26dabe` | Phase 0 audit |
| `20115636` | configs + gpu casts + LLMHelper/main strict — ⚠️ **also carries another task's work (§8)** |
| `5779039e` | IntelligenceEngine + 7 single-error files |
| `0aaf75d8` | ipcHandlers + DatabaseManager (reconstructed staging) |
| `3601334d` | retire tsc-emit scripts, watch → esbuild |
| `efda6e2b` | keep source-asserting guard tests passing (dock + withTimeout) |
| `505e987f` | restore plain-dot spelling for the wiring guard |

---

## 10. What Phases 2–4 still need

Unchanged from the brief, plus:

- **Phase 2** blocked only by §5 (a broken emit config would be inherited by the TS7 side-by-side run).
  `typescript@5.x` must stay for `react-doctor` (pre-commit hook), `typescript-eslint`, and `tap`.
- **Phase 3** additionally needs `npm run dist` and a packaged smoke run on **macOS and Windows**.
- **Follow-ups to carry into Phase 4's final report:** (a) `natively-premium` strict migration
  (20 findings, separate repo); (b) `gpu-process-crashed` removal after runtime verification on both
  platforms; (c) drop the `typescript7` alias once react-doctor / typescript-eslint / tap support TS 7.1;
  (d) `renderer/` cleanup (vestigial — audit §6.3); (e) type `getKnowledgeOrchestrator()` properly and
  drop the `PromptAssemblyResult` type-import; (f) the two deferred findings in §7.

---

## 11. Cross-platform statement

- **Change nature:** type-checking configuration and type-level source annotations. No runtime,
  packaging, native-module, or platform-integration behaviour was altered.
- `Covered by automated macOS branch tests` / `Covered by automated Windows branch tests` — the
  `app.dock` work is guarded by `WindowsPlatformParity.test.mjs` and `ActivationPolicyOrdering.test.mjs`,
  which assert the macOS dock path and the Windows tray path independently; both pass.
- **All 7 `app.dock` sites were verified darwin-gated before being touched**, so Windows behaviour is
  provably unchanged — `!`/`if (app.dock)` preserve it where `?.` would have silently altered it.
- `Reviewed but not executed on macOS` — no packaged build was produced (`npm run dist` not run).
- `Requires physical Windows verification` — nothing in this phase was executed on Windows.
- **Never claimed:** cross-platform verified.

## 12. Commands actually executed

```
npm run build                 npm run build:electron        npm run typecheck:electron
npm test  (x3: baseline, mid, final)                        npm run test:lib
npm run test:scripts          node --test <individual guard test files>
./node_modules/.bin/tsc -p electron/tsconfig.json --noEmit  (iteratively, ~12x)
./node_modules/.bin/esbuild --loader=ts  (syntax-checking reconstructed blobs)
node scripts/build-electron.js --watch   (smoke)
```

Not run, and not claimed: `npm run dist`, `npm run test:intelligence`, any Windows execution,
any packaged-app smoke test.
