# Device migration snapshot — 2026-09-15

Everything that existed **only on the retired Windows dev box** and on no remote,
collected here so it can be reviewed as one whole.

Two kinds of content live in this PR:

1. **Applied directly** — the uncommitted working tree, committed as `3c4636d3`
   and visible as normal file changes in this PR's diff.
2. **Captured as patches** — work from branches 1,100+ commits behind `main` that
   cannot be merged cleanly (18–20 conflicting files each). Merging those by hand
   would produce a result that is neither the old code nor the new, which is the
   worst thing to hand a reviewer. They are preserved here as readable diffs in
   `patches/` and as real git refs under `backup/*` on the remote.

Nothing below has been built, run, or test-validated. This is preservation, not
a readiness claim.

## patches/

| # | Patch | Origin | Size | Status |
|---|---|---|---|---|
| 01 | `launcher-3to2-aspect-lock` | `97b583de` (2026-08-04) | 6 files, +1057/−33 | **Unique work — on no remote.** New `launcherAspect.ts`, `launcherResizeAnimation.ts` + 457 lines of tests. Superseded in spirit by `efd6b163`'s frameless-launcher rewrite, but the aspect/animation modules have no equivalent on `main`. |
| 02 | `windows-undetectable-mode-tray-taskbar` | `343d7888` (2026-08-04) | 3 files, +114 | **Unique work — on no remote.** Tray + launcher taskbar follow undetectable mode. Related to open PR #418 but not identical. |
| 03 | `audio-zerofill-detector-no-subsampling` | `289553d8` (2026-08-03) | 5 files, +512/−146 | Patch-equivalent to the commit in open PR #425. `systemAudioHealthClassifier` rework. |
| 04 | `stash-premerge29-build-tooling-preflight` | stash, 2026-08-27 23:27 | 5 files, +285/−38 | Superseded by `3c4636d3`, **except** `build-native.js` — this version keeps the ia32 cross-compile path. |
| 05 | `stash-corner-work-ab` | stash, 2026-08-26 08:54 | 4 files, +240/−9 | Launcher corner-radius experiment. `src/main.tsx` +45, `index.css` +151. Not represented on `main`. |
| 06 | `dangling-baseline-check-wip` | dropped stash `9f3f4d10` (2026-08-28) | 5 files, +285/−38 | Was **unreachable** — `git gc` could have pruned it. |
| 07 | `dangling-css-baseline-wip` | dropped stash `67db2d37` (2026-08-28) | 5 files, +285/−38 | Was unreachable. **Byte-identical to 06** — kept for provenance only. |
| 08 | `dangling-ia32-cross-compile-wip` | dropped stash `89ba422b` (2026-08-27) | 4 files, +233/−38 | Was unreachable. Holds the ia32 cross-compile code (`NATIVELY_BUILD_ALL_WIN_ARCHES`, `i686-pc-windows-msvc`) that `3c4636d3` deletes. |
| 09 | `gitignore-amend-predecessor` | `f3aec22c` (2026-08-27) | 1 file, +14 | Amend predecessor of `10fb04e6`. Content identical; provenance only. |
| 10 | ipc — no model install when all providers disabled | `6c7e5fff` (2026-07-28) | 1 file, +8/−13 | **Was unreachable. Not an upstream duplicate.** |
| 11 | stealth — tray disguise + overlay taskbar sync | `f1694233` (2026-07-29) | 3 files, +161/−134 | **Was unreachable. Not an upstream duplicate.** Related to open PR #406, not identical |
| 12 | stealth — win32 gate on `syncOverlayInteractionPolicy` | `65a5046f` (2026-08-04) | 1 file, +1/−1 | **Was unreachable. Not an upstream duplicate.** Near-twin of `b710bbd3` on #418 |

`backup/main-before-local-merge` is also on the remote. It has **zero** unique
patches — all 16 of its commits already landed upstream — so it gets no patch file.

## Second fsck pass — 13 more unreachable commits

The first `git fsck` sweep was filtered to the 2026-08-25..28 window, which hid
every older dangling object. A second unfiltered pass found **13 commits
reachable from no branch, no tag and no remote**. All 13 are now reachable from
`backup/dangling-anchor-2026-09-15`, a commit whose tree is identical to `main`
and whose only purpose is to keep them from being pruned by `git gc`.

Ten are patch-duplicates of commits already on `origin/main` (WIP stashes from
the Aug 3-4 markdown and aspect-lock work) and get no diff file. The three that
are **not** duplicates are patches 10-12 above.

## Why ia32 appears in three patches

`scripts/build-native.js` in patches 04, 06 and 08 contains the ia32 cross-compile
loop. `3c4636d3` removes it deliberately: the ia32 installer target was dropped
because `onnxruntime-node`, `sqlite-vec` and `@napi-rs/canvas` publish no 32-bit
Windows binary, so a 32-bit installer could only ship a crippled app. The code is
kept here in case 32-bit ever returns.

## To apply any patch

```
git apply --3way migration-snapshot/patches/01-launcher-3to2-aspect-lock.diff
```

Expect conflicts against current `main` — these predate ~1,100 commits. The
corresponding `backup/*` branch is the better starting point for a real rebase.

## Not in this PR — copy to the new machine by hand

Gitignored on purpose by `10fb04e6`; they are local tooling config, not repo content:

`AGENTS.md`, `GEMINI.md`, `CODEBUDDY.md`, `QODER.md`, `.cursorrules`,
`.windsurfrules`, `opencode.jsonc`, `.claude/`, `.vscode/settings.json`

Rebuildable, intentionally skipped: `.code-review-graph/`, `native-module/*.node`,
`models/`, `dist/`, `dist-electron/`.
