# TypeScript 7 Upgrade — Phase 0 Audit

**Date:** 2026-08-14
**Scope:** Phase 0 only (read-only audit). No repository file was modified to produce this document.
**Author:** Claude Code (automated audit)

---

## 0. Headline

| Question | Answer |
|---|---|
| Does TS 7 exist and is it GA? | **Yes.** `typescript@7.0.2` is `latest` on npm. |
| Is the repo on TS 6? | **No — it is on TS 5.9.3.** The mission brief assumes a 6.x baseline. See §7.1. |
| Does TS 7 emit anything here? | **No, and it never will.** Emit is already 100 % esbuild/vite. `tsc` is type-check-only. This is the exact pattern TS 7 recommends, so Phase 3 is a small change. |
| Are there genuine TS 7 *checker* regressions? | **Zero.** Measured, not assumed. See §4.3. |
| What is the actual work? | **Config modernization (2 code sites) + a decision about TS 7's new `strict` default (74 errors).** |
| Can `typescript` simply be bumped to 7? | **No.** `react-doctor` runs in `.husky/pre-commit` and hard-caps at `<7`. See §5. |

**The single most important number:** on the electron project, TS 7 with `strict` explicitly disabled produces **exactly the same 4 errors** as TS 5.9.3 on the identical config. TS 7's checker is behaviour-identical to TS 5.9 on this codebase. All remaining noise is attributable to two config decisions, both of which are ours to make.

---

## 1. Method (why these numbers are trustworthy)

Phase 0 forbids changing anything, so TS 7 was installed **out-of-tree** in a scratchpad
(`npm i -D typescript@7.0.2` in a throwaway directory) and its `tsc` was pointed at the repo's real
tsconfig files. `node_modules/` and every tracked file are untouched.

Every TS 7 measurement is paired with a **control run of the repo's own TS 5.9.3 against the identical
config**. Without that control, a TS 7 error count is meaningless — it cannot be told apart from the
cost of the config change itself. Where a hypothesis had two explanations that predicted the same
observation, a discriminating experiment was run rather than picking the likelier story (§4.2, §4.4).

Probe artifacts live in the session scratchpad; they are not part of the repo.

---

## 2. Current state

### 2.1 Compiler

| | Declared | Installed |
|---|---|---|
| root `package.json` → `typescript` | `^5.6.3` (devDependency) | **5.9.3** |

There is no `typescript` entry in any other in-repo `package.json` on the build path.

### 2.2 tsconfig inventory (in-repo, excluding `.claude/worktrees/` and submodules)

| File | Purpose | On a build path? |
|---|---|---|
| `tsconfig.json` | renderer sources — `include: ["src","premium/src"]`, `noEmit: true` | **Yes** — `npm run build` runs bare `tsc` |
| `tsconfig.node.json` | `vite.config.mts` only, `composite: true` | Referenced only; bare `tsc` does not build project references |
| `electron/tsconfig.json` | main process + `../premium/electron/**` | **Yes** — `npm run typecheck:electron` |
| `natively-browser/tsconfig.json` | separate browser-extension sub-app | Independent |
| `renderer/tsconfig.json` | **vestigial** — see §6.3 | No |

`natively/`, `natively-control/`, `natively-api/` are separate sub-projects / gitlinks with their own
toolchains and are **out of scope** for this upgrade.

### 2.3 How the build actually works — the decisive architectural fact

```
npm run build      → rimraf && tsc && vite build      # tsc = CHECK ONLY (noEmit: true)
npm run build:electron → node scripts/build-electron.js  # esbuild, transpile-only
npm run typecheck:electron → tsc -p electron/tsconfig.json --noEmit
```

`scripts/build-electron.js` is esbuild (`bundle: true`, `platform: 'node'`, `format: 'cjs'`,
`target: 'node20'`) and its own header says *"transpile-only, no type checking … Run `npm run
typecheck:electron` separately for type safety."*

**Consequence:** the checker and the emitter are already fully separated. TS 7's headline limitation —
that it is a type-checker whose emit story is still maturing — costs this repo nothing. Phase 3 is
reduced to changing which binary runs `--noEmit`.

Two scripts do still use `tsc` for *emit* — `build:electron:tsc` and `watch` (`tsc -p
electron/tsconfig.json --watch`). Neither is on `app:build` / `dist`. They are dev conveniences and are
discussed in §7.3 because the recommended `module` setting interacts with them.

---

## 3. TS 7 availability

```
npm view typescript dist-tags
  latest: 7.0.2      next: 7.1.0-dev.20260813.1      rc: 7.0.1-rc      beta: 6.0.0-beta
```

`@typescript/native-preview` is superseded (last publish `7.0.0-dev.20260707.2`); the native compiler now
ships as `typescript` proper. **Use `typescript@7.0.2`, not the preview package.**

---

## 4. Measurements

### 4.1 Results matrix

Error counts. "current cfg" = the file as committed today; "modernized cfg" = TS7-legal equivalent.

| Project | TS 5.9.3, current cfg | TS 7.0.2, current cfg | TS 7.0.2, modernized cfg |
|---|---|---|---|
| `tsconfig.json` (src/, premium/src) | **0** | **69** | **0** ✅ (see §4.2) |
| `tsconfig.node.json` | 0 | **0** ✅ | 0 |
| `electron/tsconfig.json` | **0** | **config-fatal — refuses to load** | **4** with `strict:false` / **78** with TS7's default `strict` |
| `natively-browser/tsconfig.json` | — | **0** ✅ | 0 |
| `renderer/tsconfig.json` | — | config-fatal | vestigial — defer (§6.3) |

TS 7 rejects `electron/tsconfig.json` before checking a single file:

```
electron/tsconfig.json(11,5):  error TS5102: Option 'baseUrl' has been removed.
  Use '"paths": {"*": ["./*"]}' instead.
electron/tsconfig.json(14,25): error TS5108: Option 'moduleResolution=node10' has been removed.
```

### 4.2 The 69 root-project errors are ONE root cause, and it is fully fixable

Distribution: 64 × TS7016 (`Could not find a declaration file for module
'react-syntax-highlighter/dist/esm/…'`), 4 × TS2591 (`Cannot find name 'process'`), 1 × TS2503
(`Cannot find namespace 'NodeJS'`).

**Root cause: TS 7 no longer auto-includes `@types/*` packages. An explicit `types` field is required.**

Under TS 5.9 an absent `types` field means "include every visible `@types/*` package". Those packages
supplied both the Node globals *and* — via `@types/react-syntax-highlighter@15.5.13`, which declares
each deep subpath as an exact-name ambient module (`declare module
"react-syntax-highlighter/dist/esm/prism-light"`, ~6 000 lines of them) — the types for the deep
imports. `react-syntax-highlighter@16.1.1` itself ships **zero** `.d.ts` files, so without that ambient
block the deep imports are untyped.

Verification, in order:

1. `--typeRoots ./node_modules/@types` alone → still 69. Not a *discovery* problem.
2. `--types node` → 69 → 64. Kills exactly the 5 Node-global errors.
3. `--types node,react-syntax-highlighter` → **0 errors, exit 0.**
4. **Discriminator** (this is the one that matters — "auto-inclusion is broken" and "one bad package
   poisons the scan" both predict 1–3 identically): a minimal throwaway project containing *only*
   `@types/node`, no `types` field, one file using `process.cwd()` and `NodeJS.Timeout`.
   TS 7 → `TS2591` + `TS2503`. TS 5.9 → loads `@types/node` fine. **Auto-inclusion is globally absent in
   TS 7**, not project-specific.
5. Reproduced under `moduleResolution: nodenext` as well, so it is **not** a `bundler`-mode quirk.

> **Fix:** add `"types": ["node", "react-syntax-highlighter"]` to `tsconfig.json`. Zero suppressions,
> zero `any`, zero `@ts-ignore`. **The root project then passes TS 7 cleanly.**

> ⚠️ **This is not a no-op — record it.** It narrows the global type surface from ~50 auto-included
> packages to 2. Packages reached through `import` statements (`react`, `react-dom`, `ws`, `three`, …)
> are unaffected; only packages contributing *ambient globals* could regress. The full current
> auto-included set is:
>
> `babel__core babel__generator babel__template babel__traverse better-sqlite3 cacheable-request color
> color-convert color-name debug diff dom-mediacapture-record duplexify electron esrecurse estree
> estree-jsx fs-extra hast http-cache-semantics istanbul-lib-coverage json-schema katex keytar keyv
> marked mdast ms node node-fetch pako plist prismjs pumpify qrcode raf react react-dom
> react-syntax-highlighter responselike retry screenshot-desktop stats.js three trusted-types unist uuid
> verror webxr ws`
>
> Candidates that could plausibly supply globals and should be re-added to `types` if anything breaks:
> `dom-mediacapture-record`, `trusted-types`, `webxr`, `stats.js`. The measured result is that none are
> needed today (exit 0).

### 4.3 The electron project decomposes cleanly — and TS 7 adds nothing

`electron/tsconfig.json` cannot be measured as-is, so a TS7-legal equivalent was built
(`module: Preserve` + `moduleResolution: bundler`, `baseUrl` dropped, `types: ["node"]`) and run under
**both** compilers.

| Configuration | Errors |
|---|---|
| TS 5.9.3, **current** committed config | **0** (green baseline) |
| TS 5.9.3, modernized config | **4** |
| TS 7.0.2, modernized config, `strict: false` | **4** — *byte-identical output* (see below) |
| TS 7.0.2, modernized config, TS 7 default `strict` | **78** |

Therefore:

```
  4  errors  ← cost of CONFIG MODERNIZATION alone (reproduces on TS 5.9 — not a TS 7 issue)
+74  errors  ← cost of TS 7 defaulting `strict: true`
+ 0  errors  ← genuine TS 7 checker behaviour differences
─────────────
 78  total
```

**TS 7's checker is behaviour-identical to TS 5.9.3 on this codebase.** That is the strongest possible
result for a compiler migration and it de-risks the whole effort.

This was settled by `diff`, not by comparing counts — the two runs' error lists were sorted and diffed
and came back **empty**, i.e. the same four `file(line,col): error TSxxxx` records in both:

```
electron/main.ts(8254,10):                 error TS2769: No overload matches this call.
electron/main.ts(8254,34):                 error TS7006: Parameter '_event' implicitly has an 'any' type.
electron/utils/lifecycleTracker.ts(154,12): error TS2769: No overload matches this call.
electron/utils/lifecycleTracker.ts(154,36): error TS7006: Parameter 'event' implicitly has an 'any' type.
```

Module/resolution pairings tried, so the choice is measured rather than reasoned:

| `module` / `moduleResolution` | Result |
|---|---|
| `CommonJS` / `node16` | `TS5110` — rejected, invalid pairing |
| `NodeNext` / `nodenext` | 91 errors, incl. **12 × TS2835** (mandatory `.js` extensions on relative imports) |
| **`Preserve` / `bundler`** | **78 errors, no TS2835** ← recommended; also the honest model, since esbuild bundles |

### 4.4 The 4 config-modernization errors are 2 sites — and they expose a latent bug

```
electron/main.ts(8254,10)               error TS2769: No overload matches this call.
electron/main.ts(8254,34)               error TS7006: Parameter '_event' implicitly has an 'any' type.
electron/utils/lifecycleTracker.ts(154,12) error TS2769: No overload matches this call.
electron/utils/lifecycleTracker.ts(154,36) error TS7006: Parameter 'event' implicitly has an 'any' type.
```

Both are `app.on('gpu-process-crashed', …)`. The TS7006 is a knock-on of the TS2769 (a failed overload
match strips the callback's contextual type), so this is **2 real sites, not 4 problems**.

Mechanism, confirmed by inspection:

- `grep -c gpu-process-crashed node_modules/electron/electron.d.ts` → **0**. Electron 43 no longer
  declares this event.
- `grep -c gpu-process-crashed node_modules/@types/electron/index.d.ts` → **1**. That package is
  `@types/electron@1.4.38`, headed *"Type definitions for Electron v1.4.8"* — a stub for a 2016 Electron.

Under `moduleResolution: node10` + TS 5.9 auto-`@types`, the **9-year-old `@types/electron` stub was
shadowing Electron 43's real typings** for the main process. (It also carries
`/// <reference types="node" />`, which is where the Node globals were quietly coming from.)
Modernizing resolution makes TS see Electron 43's actual API surface.

> 🔴 **Latent runtime finding, independent of TypeScript.** The code registers listeners for
> `gpu-process-crashed`, an event Electron 43 **removed**. Those handlers are dead — on **both macOS and
> Windows**. `electron/main.ts:8254`'s own comment already calls it *"Deprecated alias of
> child-process-gone"*, and a `child-process-gone` handler exists alongside it, so the recovery
> behaviour is believed to be already covered.
>
> **Not fixed in this audit.** Removing a listener is a behaviour change, which the mission forbids
> ("zero product behaviour changes"), and confirming the `child-process-gone` path fully covers the GPU
> case needs runtime verification on both platforms. **Flagged for a separate change.**

---

## 5. Tool compatibility — what blocks a plain `typescript` bump

Peer/dependency ranges read from the installed tree, not from documentation.

| Package | Installed | Declared TS range | TS 7.0.2? | Notes |
|---|---|---|---|---|
| `@typescript-eslint/*` (7 pkgs) | 8.59.3 | `>=4.8.4 <6.1.0` (peer) | ❌ | Hard cap. Verdict rests on the measured range, not on the "no programmatic API until 7.1" narrative. |
| `react-doctor` | 0.2.10 | `>=5.0.4 <7` (dep) | ❌ | **Runs in `.husky/pre-commit` and `.github/workflows/react-doctor.yml`.** |
| `@tapjs/test` (via `tap@21.5.0`, a **root dependency**) | 4.4.8 | `typescript 5.9` (**dep**, not peer) | ❌ | Will resolve its own nested copy. |
| `ts-api-utils` | 2.5.0 | `>=4.8.4` (peer) | — | Transitive of typescript-eslint. |
| `tshy` | 3.3.2 | `^5.9.3` (dep) | — | Transitive. |
| `deslop-js` | 0.0.13 | `^6.0.3` (dep) | — | Transitive. |
| `esbuild` | 0.21.5 | *no TS API* | ✅ | Owns all emit. Unaffected. |
| `vite` | 5.4.21 | *no TS API* | ✅ | Unaffected. |
| `electron-builder` | 26.8.1 | *no TS API* | ✅ | Unaffected. |

**Absent entirely** (the mission anticipated these): no `ts-jest`, no `vitest`, no `ts-node` (direct), no
`ts-morph`, no `ts-loader`, no `tsup`, no `rollup-plugin-typescript2`. Tests run via `node --test` /
`electron --test` on `.mjs` files, plus `node --experimental-strip-types` for a few `.ts` entry points —
**none of which involve `tsc` at all.** The alias strategy therefore has a much smaller blast radius here
than in a typical repo.

> 🔴 **Blocker for a naive bump.** Setting root `typescript` to `^7` breaks `react-doctor`, which runs on
> **every commit by every person in this repo** via `.husky/pre-commit`, and in CI. This is the concrete
> justification for the mission's `typescript7@npm:typescript@latest` alias approach — the existing
> `typescript` package must stay at 5.x.

---

## 6. TS7-fatal option scan (all in-repo tsconfigs)

| File | Option | TS 7 | Assessment |
|---|---|---|---|
| `electron/tsconfig.json` | `baseUrl: "."` | `TS5102` removed | **Not load-bearing.** All 50 distinct bare specifiers in `electron/**` resolve either from `node_modules` or as Node builtins; **zero** rely on `baseUrl`. Safe to delete outright — no `paths` replacement needed. |
| `electron/tsconfig.json` | `moduleResolution: "node"` | `TS5108` removed | → `bundler` (with `module: Preserve`). §4.3. |
| `renderer/tsconfig.json` | `target: "es5"` | `TS5108` removed | Vestigial — §6.3 |
| `renderer/tsconfig.json` | `moduleResolution: "node"` | `TS5108` removed | Vestigial — §6.3 |
| `tsconfig.json`, `tsconfig.node.json`, `natively-browser/tsconfig.json` | — | — | **Clean.** |

Not present anywhere: `importsNotUsedAsValues`, `preserveValueImports`, `downlevelIteration`, `outFile`,
`charset`, `keyofStringsOnly`, `suppress*`, `noImplicitUseStrict`, `noStrictGenericChecks`.
(`outDir` is fine in TS 7.)

Also unsupported by the native compiler, and confirmed absent here: `module` AMD/UMD/System,
`moduleResolution: classic`, `esModuleInterop: false`, `allowSyntheticDefaultImports: false`,
`alwaysStrict: false`.

### 6.1 `target` and `module`

Every live config already targets `ES2022`/`ESNext` — no bump needed. `module` is explicit everywhere.

### 6.2 `strict`

`tsconfig.json`, `natively-browser` and `renderer` already set `strict: true`.
**`electron/tsconfig.json` sets only `noImplicitAny: true` and has never been strict.** This is the
74-error decision in §7.2.

### 6.3 `renderer/` is vestigial

It is git-tracked and has its own `package.json`, but is referenced by **no** root script and **no**
Vite config; root `tsconfig.json` includes only `src` and `premium/src`. Its two TS7-fatal options are
therefore inert. **Recommendation: leave it alone and note it**, rather than spending Phase 1 on dead
config. (The `vite-plugin-electron-renderer` dependency is an unrelated package name.)

---

## 7. Deltas from the mission brief

### 7.1 The repo is on TS 5.9.3, not TS 6 — and skipping 6.x is acceptable

The brief's Phase 2/3 language assumes a "TS6 compat path". There is no 6.x here; this is 5.9 → 7.0.

The value of a 6.x waypoint is that it surfaces the removals as *warnings* before they become fatal.
**That value has already been extracted empirically** — every removal that affects this repo is
enumerated in §6 with its exact error code and file:line. A 6.x detour would produce no information this
audit lacks. **Recommendation: skip 6.x.**

### 7.2 🟡 Decision required — TS 7's `strict` default vs. the "no loosening" rule

These two mission rules collide on `electron/tsconfig.json`:

- Hard rule: *"no disabling strict flags to make errors go away — surface them instead."*
- Phase 1: *"Enable `strict: true` explicitly… If this produces errors, list them in the audit doc — fix
  only trivial/safe ones; flag the rest."*

The electron project has **never** been strict. Writing `"strict": false` into it is not a *regression* —
it pins the behaviour that is in effect today, against a changed compiler default. But it is also plainly
not what "enable strict" means. This is a judgement call that belongs to the user, so it is surfaced
rather than decided.

The 74 errors, by file:

| File | Count | In premium submodule? |
|---|---|---|
| `premium/electron/knowledge/HeuristicExtractor.ts` | 20 | 🔴 **Yes** |
| `electron/LLMHelper.ts` | 12 | No |
| `electron/IntelligenceEngine.ts` | 12 | No |
| `electron/main.ts` | 10 | No |
| `electron/ipcHandlers.ts` | 10 | No |
| `electron/db/DatabaseManager.ts` | 4 | No |
| 9 further files | 1–2 each | No |

By code: 31 × TS2339 (property missing on type), 11 × TS2322 (assignability), 9 × TS2454 (used before
assigned), 9 × TS18047 (possibly `null`), 8 × TS18048 (possibly `undefined`), 4 × TS2345, 2 × TS7006,
2 × TS2769, 2 × TS2531. These are ordinary strict-null findings, concentrated in 6 files — genuinely
tractable, and the kind of thing that finds real bugs.

> 🔴 **Hard constraint:** 20 of the 74 (27 %) are in **`premium/`, a separate private git submodule**.
> They cannot be fixed on `chore/ts7-upgrade`; they need a coordinated change in
> `Natively-AI-assistant/natively-premium`. Any plan to go strict must account for this.

**Four options. These are presented neutrally — the choice is §10 item 1 and belongs to the user, not to
this audit.** Note that A and C both disable a strict flag, which the mission's hard rules name
explicitly; that is stated here as a fact about each option, not as a verdict.

| | Approach | Effect | Disables a strict flag? |
|---|---|---|---|
| **A** | Pin `"strict": false` in `electron/tsconfig.json` with an explanatory comment + `TODO`. Keep `noImplicitAny: true`. | Preserves today's behaviour exactly and unblocks Phases 1–3 immediately. Defers strictness to its own reviewable change. | **Yes** — this is the mission's named prohibition, even though it only pins the status quo against a changed default. |
| **B** | `strict: true`, fix all 74. | Best end state. But 27 % is cross-repo (§ below), and it injects behaviour-affecting edits into a migration whose stated goal is *zero* behaviour change. | No |
| **C** | `strict: true` with `strictNullChecks: false`. | Removes ~28 of the errors. | **Yes** — and less honest than A, since it hides the loosening inside an apparently-strict config. |
| **D** | `strict: true` on `electron/**`, with `premium/**` dropped from the project's **root file set**. | **54 errors, all in-repo, no submodule coupling. Measured, not assumed.** | No |

**Option D is the one that satisfies every hard rule simultaneously**, and it was verified rather than
theorised, because the obvious objection is that eight `electron/**` files import from `premium/**` and
excluding a directory does not normally remove imported files from the program:

| Run | Errors | premium-file errors | `TS2307` (broken imports) |
|---|---|---|---|
| `strict` on, premium in root set | 78 | 20 | 0 |
| `strict` on, premium **excluded** | **58** | **0** | **0** |

78 − 20 = 58 exactly, and **zero `TS2307`** — the premium imports still resolve and still type-check as
*dependencies*; their internal errors simply stop being reported because they are no longer root files.
Of the 58, four are the pre-existing config errors from §4.4, leaving **54 genuine strict findings, every
one of them in this repository.**

The trade-off to weigh for D: `premium/**` stops being strict-checked from this project, so strict
regressions inside the submodule would go unnoticed here. Making premium strict is then a separate,
properly-scoped change in `natively-premium`.

### 7.3 `module: Preserve` interacts with the two tsc-emit scripts

The recommended `module: Preserve` makes `tsc` emit modules untransformed, which would be wrong for the
CommonJS main process. It does **not** affect `npm run build` / `dist` (esbuild owns that emit), but it
does affect the two dev-only scripts that emit via tsc: `build:electron:tsc` and `watch`.

**Recommendation:** in Phase 1, add `"noEmit": true` to `electron/tsconfig.json` (it is only ever used
for checking on real build paths) and repoint `watch` at esbuild's watch mode, or retire both scripts.
To be settled at Phase 1; flagged here so it is not discovered mid-flip.

### 7.4 🟡 The "lint" gate in every phase is not runnable as written

Each phase is specified to end with build + typecheck + **lint** + tests green. **There is no root ESLint
config and no `lint` script.** `ls eslint.config.* .eslintrc*` at root → nothing; no `lint` key in
`package.json` `scripts`. ESLint 10.4.0 and `@typescript-eslint` 8.59.3 are present only as
(dev)dependencies with nothing wiring them up. `natively/` and `natively-control/` carry their own
configs, but those are out-of-scope sub-projects.

**The lint gate will be reported as `not applicable — no root lint configuration exists`, never as
"passed".** Standing up ESLint is out of scope for a compiler migration.

The runnable gates are: `npm run build`, `npm run typecheck:electron`, `npm test`, `npm run test:lib`,
`npm run test:scripts`, `npm run test:intelligence`, and `npm run dist` for packaging.

---

## 8. 🔴 Blocker: the working tree is shared and dirty

| | |
|---|---|
| Current branch | `audit/autopilot-2026-08-14` (**not** `main`) |
| Modified tracked files | **21** |
| Untracked files | **168** |
| Staged | 0 |
| `chore/ts7-upgrade` exists? | No |

None of this work is part of the TS 7 upgrade — it is another task's in-flight state (`chargeback_evidence/`,
`natively-control/`, `transitions/`, `undefined/`, assorted new `.test.mjs` files, plus 21 modified
sources). Project history also records that **other agents share this working directory** and that
`git stash` is unsafe here.

**Mitigation adopted (no user action needed):**

- Create `chore/ts7-upgrade` from the current HEAD — this does not move or discard anything.
- Commit **only by explicit path** (`git add docs/ts7-upgrade-audit.md`, and in later phases the specific
  tsconfig/package files).
- **Never** `git add -A`, `git add .`, `git commit -a`, or `git stash`.
- `main` is not touched, and no file is deleted.

The branch will inherit the pre-existing dirty state in the working tree. That is unavoidable without
disturbing another task's work, and it is harmless as long as the add-by-path discipline holds.

---

## 9. Recommended plan

Phase 0 is complete; nothing below has been executed.

**Phase 1 — config modernization on TS 5.9** (validate with the repo's own compiler)
1. `tsconfig.json`: add `"types": ["node", "react-syntax-highlighter"]`. *(Verified: TS 7 → 0 errors.)*
2. `electron/tsconfig.json`: delete `baseUrl` (no `paths` replacement needed — §6); `moduleResolution:
   "node"` → `"bundler"`; `module: "CommonJS"` → `"Preserve"`; add `"types": ["node"]`; add `"noEmit":
   true` (§7.3). Preserve old values in comments per the mission's rule.
3. Resolve §7.2 with the user before touching `strict`.
4. Leave `renderer/` alone (§6.3).
5. Expect the 2 `gpu-process-crashed` sites to surface (§4.4) — needs a decision, as fixing them is a
   behaviour change.
6. Gates: `npm run build`, `npm run typecheck:electron`, test suites, `npm run dist`. Lint → N/A (§7.4).

**Phase 2 — side-by-side**
`npm i -D typescript7@npm:typescript@7.0.2`; add `typecheck:ts7` and `typecheck:ts7:electron`. Keep
`typescript@5.x` in place for `react-doctor`, `typescript-eslint` and `tap` (§5). Add to CI non-blocking.
Note: `test:ci` and `build-smoke.yml` need the private `premium` submodule; CI already handles this via an
explicit path-limited checkout.

**Phase 3 — flip**
Repoint the `--noEmit` check steps at `typescript7`. Emit stays with esbuild/vite (already true — §2.3).
Leave `react-doctor`, `typescript-eslint` and `tap` on `typescript@5.x` and record the TS 7.1 follow-up.
Validate a full packaged build and an app smoke run on **macOS and Windows** — `build-smoke.yml` already
runs a two-OS matrix.

**Phase 4 — report** → `docs/ts7-upgrade-report.md`.

---

## 10. Open items requiring a decision

| # | Item | Ref |
|---|---|---|
| 1 | `strict` on the electron project — **A** pin `false` / **B** fix all 74 incl. 20 in the `premium` submodule / **C** `strictNullChecks: false` / **D** `strict: true` with `premium/**` out of the root file set (54 errors, all in-repo, no strict flag disabled). A and C disable a strict flag, which the mission's hard rules name explicitly. | §7.2 |
| 2 | `gpu-process-crashed` handlers are dead on Electron 43. Remove them (behaviour change) or leave and suppress? | §4.4 |
| 3 | `build:electron:tsc` / `watch` emit via tsc and conflict with `module: Preserve`. Retire, or repoint at esbuild? | §7.3 |
| 4 | Confirm the lint gate is waived as not-applicable. | §7.4 |
| 5 | Confirm `renderer/` is dead and may be skipped. | §6.3 |

---

## 11. Cross-platform statement

Per the repository's cross-platform contract:

- **Nature of the change.** Type-checking configuration only. `tsc` never produces a shipped artifact
  here (§2.3), so no runtime, packaging, native-module, or platform-integration behaviour is altered by
  anything proposed in §9.
- **macOS:** `Reviewed but not executed` — Phase 0 changed nothing; the probes were read-only.
- **Windows:** `Reviewed but not executed` — same.
- Both platforms' branches are unaffected: no `process.platform` code, no shell scripts, no native
  helpers, no path handling, and no electron-builder configuration were read as needing change.
- The `gpu-process-crashed` finding (§4.4) affects **both** platforms equally and is explicitly *not*
  actioned here.
- `build-smoke.yml` already runs a `macos-latest` + `windows-latest` matrix, so Phases 1–3 have a
  two-platform validation path available.

## 12. Commands actually executed

Read-only inspection plus, in a throwaway scratchpad directory:

```
npm view typescript dist-tags / versions
npm view @typescript/native-preview dist-tags
npm i -D typescript@7.0.2                       # out-of-tree scratchpad ONLY
<scratchpad>/tsc -p <each repo tsconfig> --noEmit          # TS 7 probes
./node_modules/.bin/tsc -p <each repo tsconfig> --noEmit   # TS 5.9.3 controls
<scratchpad>/tsc -p <synthesised electron configs>         # node16 / nodenext / preserve
npx ctx7@latest library|docs /microsoft/typescript-go      # primary-source option removals
```

No repository file was created, modified, or deleted while producing this audit; this document is the
first and only write.
