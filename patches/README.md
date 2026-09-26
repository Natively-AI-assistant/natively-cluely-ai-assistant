# Native-module preinstall patches

These patches inject a `preinstall` script into `better-sqlite3` and `keytar`
that runs `scripts/verify-native-arch.js` before either package's own `install`
script (`prebuild-install || node-gyp rebuild`) executes.

## Why

The chain `postinstall` guard in the root `package.json` only fires on full
`npm install` of the repo. It does NOT fire on:

- `npm rebuild <package>`
- `npm install <package>` (per-package)
- `npm install <package>@<version>` (upgrade)
- Manual `node-gyp rebuild` from inside `node_modules/<pkg>/`
- IDE-spawned terminals that run an install/rebuild out of band

In all of those cases, `prebuild-install` (run by the package's own `install`
script) can silently download the wrong-arch prebuilt `.node` from GitHub —
specifically, an x86_64 darwin prebuilt when invoked under Rosetta or an
x86_64 node, even on arm64 hardware. That produces the
`ERR_DLOPEN_FAILED (have 'x86_64', need 'arm64')` failure mode the boot-time
gate (in `electron/main.ts`) now catches at app launch.

By patching the package's `preinstall` to run our arch verify BEFORE
`prebuild-install` runs, we make every install flow — including the per-package
ones — fail loud with the one-line fix.

## Maintenance

When `better-sqlite3` or `keytar` is bumped in `package.json`:

1. `npm install` — npm overwrites the patched package.json
2. patch-package in the postinstall chain re-applies the existing patch
3. Verify the patch still applies cleanly: `npx patch-package`
4. If the upstream package.json has drifted (e.g. the maintainer added or
   removed a sibling script), the patch will fail to apply. Regenerate it:
   - `rm -rf node_modules/better-sqlite3 && npm install --ignore-scripts`
   - Re-add the `preinstall` line by hand (the exact text in the patch)
   - `npx patch-package better-sqlite3 keytar --exclude 'build/Release/.*\.node$|^build/'`
5. Commit the updated patch file. NEVER commit compiled `.node` binaries —
   the `--exclude` flag above is what keeps the patch tiny.

## What the patch does

Adds one line to each package's `scripts` block:

```json
"preinstall": "node ../../scripts/verify-native-arch.js || (echo '[nativeArch] <pkg> install BLOCKED: arch mismatch (see fix above)' && exit 1)"
```

The verify script returns non-zero on arch mismatch, which:
- npm treats as a fatal install error → no binary downloaded
- The user sees the same "Fix: `arch -arm64 npm run rebuild:native`" message
  they would have seen at boot or postinstall

## What it does NOT cover

- A genuine first install on a clean machine where no `.node` file exists
  yet. The verify script skips missing files (not an arch error if the
  binary isn't there yet). The `rebuild-native-electron` step that runs
  AFTER patch-package in postinstall is what creates the binary, and then
  the trailing `verify-native-arch.js` checks the result. On Rosetta,
  that step is `arch -arm64`-wrapped internally so it's correct.

- Non-macOS platforms. The verify script returns `skipped: true` on
  Linux/Windows. better-sqlite3 prebuilds handle arch selection correctly
  on those platforms.

## Regeneration flags

```bash
npx patch-package better-sqlite3 keytar \
  --exclude 'build/Release/.*\.node$|^build/'
```

The `--exclude` is mandatory — without it the patch captures compiled
binaries as diffs and becomes unusable (you'd be committing machine-
specific compiled .node files into the patch).