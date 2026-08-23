/**
 * Fail-loud guard: asserts that Electron's native addons on disk are built
 * for the true hardware architecture. Runs at:
 *   - end of `postinstall` (catches fresh installs run under Rosetta)
 *   - husky pre-commit (catches regressions before merge)
 *   - CI (catches regressions before deploy)
 *
 * Covers macOS (Mach-O slice, poisoned by Rosetta) AND Windows (PE machine
 * type, poisoned when a rebuild loses `/p:Platform=x64` and silently emits a
 * 32-bit DLL). The Windows half was previously skipped outright, so a build
 * where both better-sqlite3 and keytar were 32-bit passed this guard and only
 * surfaced at runtime as "is not a valid Win32 application".
 *
 * Single source of truth for the check lives in
 * `electron/lib/nativeArch.mjs` so the boot-time gate in main.ts uses the
 * same logic and cannot drift. This file is a thin shim so the existing
 * `package.json` postinstall chain and husky hook keep invoking a
 * `.js` filename (no path changes needed in those configs).
 */
const path = require('path');
const fs = require('fs');

(async () => {
  const mod = await import(
    'file://' + path.join(__dirname, '..', 'electron', 'lib', 'nativeArch.mjs').replace(/\\/g, '/')
  );
  const repoRoot = path.resolve(__dirname, '..');
  const result = mod.verifyAll(repoRoot);

  if (result.skipped) return; // non-darwin: nothing to do

  // Log OK / warn-missing lines so the user sees what was checked.
  for (const rel of mod.TARGETS) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      console.warn(`[verify-native-arch] ${rel} not present — skipping (expected after rebuild step).`);
      continue;
    }
    const mismatch = result.mismatches.find((m) => m.path === rel);
    if (!mismatch) {
      console.log(`[verify-native-arch] OK ${rel} (${result.hardware})`);
    }
  }

  if (!result.ok) {
    const lines = result.mismatches.map(
      (m) => `  - ${m.path}: built ${m.actual}, need ${m.expected}`,
    );
    // Rosetta is a macOS concept; printing it on Windows sends the reader
    // chasing a cause that cannot exist there. The Windows cause is a rebuild
    // that lost its x64 target — most often two builds racing on the same
    // node_modules tree, which makes MSBuild fall back to Win32.
    const platformHint = process.platform === 'darwin'
      ? '\nIf your terminal is running under Rosetta, open a fresh arm64 terminal first.'
      : '\nIf another build (e.g. `npm run dist`) is running, stop it first — concurrent\n' +
        'rebuilds of the same native module can emit a 32-bit binary.';

    throw new Error(
      `Native module architecture mismatch (hardware is ${result.hardware}):\n` +
      lines.join('\n') +
      `\n\nFix: run \`${result.fix}\`\n` +
      platformHint,
    );
  }
})().catch((err) => {
  console.error('[verify-native-arch] ' + err.message);
  process.exit(1);
});