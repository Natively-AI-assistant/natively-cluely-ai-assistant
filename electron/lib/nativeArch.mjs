/**
 * Single source of truth for "is this native addon built for the right arch?"
 *
 * Why this lives here:
 *   Three places need to answer this question:
 *     1. main.ts boot gate (catches per-package rebuilds that bypass postinstall)
 *     2. scripts/rebuild-native-electron.js (rebuild step)
 *     3. scripts/verify-native-arch.js (postinstall + husky pre-commit + CI)
 *
 *   Before this module, each of the script files had its own copy of
 *   `detectHardwareArch` and `binaryArch`. When the implementation drifted
 *   (e.g. someone fixed the postinstall one but not the boot gate), a
 *   poisoned `.node` could pass the gate but fail at dlopen. Centralizing
 *   means one edit covers all three consumers.
 *
 * Why .mjs (not .ts):
 *   main.ts can import .mjs directly via the existing ESM-style imports
 *   (see main.ts:6 `import { ... } from "./audio/systemAudioHealthClassifier.mjs"`),
 *   and scripts/* are plain Node CommonJS that can `require()` an .mjs via
 *   dynamic import. Keeping it .mjs avoids the TS compile-step coupling
 *   for the scripts (which currently run as plain Node via npm scripts
 *   without any build step).
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Targets: every native addon Electron loads at runtime.
// Keep this list in sync with scripts/rebuild-native-electron.js `MODULES`.
// ---------------------------------------------------------------------------

/** Relative to repo root. */
export const TARGETS = Object.freeze([
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'node_modules/keytar/build/Release/keytar.node',
]);

/** Mach-O arch token printed by `file` for each Node arch string. */
const ARCH_TO_MACHO = { arm64: 'arm64', x64: 'x86_64' };

// ---------------------------------------------------------------------------
// Hardware-truth arch (immune to Rosetta).
// ---------------------------------------------------------------------------

/**
 * Resolve the true hardware architecture, immune to Rosetta translation.
 * Under Rosetta, `process.arch`/`os.arch()` report 'x64' on arm64 silicon —
 * the exact lie that poisons native builds. `sysctl hw.optional.arm64`
 * reports the hardware truth even when this process is x86_64-translated.
 *
 * @returns {'arm64' | 'x64' | string}
 */
export function detectHardwareArch() {
  if (os.platform() !== 'darwin') return process.arch;
  try {
    const isArm = execFileSync('sysctl', ['-in', 'hw.optional.arm64'], { encoding: 'utf8' }).trim();
    if (isArm === '1') return 'arm64';
    // hw.optional.arm64 absent/0 → genuine Intel hardware
    return 'x64';
  } catch {
    // sysctl missing (sandboxed CI without it?) — fall back to process arch.
    // This is the worst-case path: on arm64-under-Rosetta it will lie.
    // The verify functions below still catch the resulting binary mismatch.
    return process.arch;
  }
}

// ---------------------------------------------------------------------------
// Binary-arch probe.
// ---------------------------------------------------------------------------

/**
 * Read the Mach-O arch of a .node file via the `file` utility.
 *
 * @param {string} absPath  absolute path to a compiled .node
 * @returns {'arm64' | 'x64' | `unknown (${string})`}
 */
export function binaryArch(absPath) {
  // `file` prints e.g. "...: Mach-O 64-bit bundle arm64"
  const out = execFileSync('file', ['-b', absPath], { encoding: 'utf8' });
  if (/\barm64\b/.test(out)) return 'arm64';
  if (/\bx86_64\b/.test(out)) return 'x64';
  return `unknown (${out.trim()})`;
}

// ---------------------------------------------------------------------------
// Repo-root-aware verify.
// ---------------------------------------------------------------------------

/**
 * Resolve a TARGET (a `node_modules/...` relative path) to an absolute path,
 * correctly handling packaged vs dev layouts.
 *
 *   - Packaged: electron-builder unpacks native `.node` files to
 *     `${resourcesPath}/app.asar.unpacked/${rel}`. Probing the asar side
 *     returns ENOTDIR from `file -b` (asar is a virtual filesystem that
 *     `file` cannot `open()`), which previously caused a false-positive
 *     "Built unknown" mismatch and fired the dialog for every end-user
 *     launch of v2.8.1.
 *   - Dev: fall back to `${repoRoot}/${rel}` (the existing behavior).
 *
 * @param {string} rel            TARGET entry, e.g. "node_modules/better-sqlite3/build/Release/better_sqlite3.node"
 * @param {{ repoRoot?: string, resourcesPath?: string }} [opts]
 * @returns {string} absolute path
 */
export function resolveTargetPath(rel, { repoRoot, resourcesPath } = {}) {
  if (resourcesPath) {
    return path.join(resourcesPath, 'app.asar.unpacked', rel);
  }
  return path.join(repoRoot || process.cwd(), rel);
}

/**
 * Run the arch check against every TARGET. Returns a structured result
 * suitable for both throwing (script use) and in-place UI (boot gate).
 *
 * Behavior:
 *   - Non-darwin platforms: returns `{ ok: true, skipped: true }` (no Rosetta
 *     risk on Linux/Windows; better-sqlite3 prebuilds handle arch themselves).
 *   - Missing .node files: skipped with a warning, NOT counted as a mismatch
 *     (a fresh `npm install` won't have rebuilt yet — that's the rebuild
 *     step's job, not this verifier's).
 *   - Mismatched .node files: collected into `mismatches` with the actual
 *     and expected arch, plus the one-line fix the user can copy.
 *
 * Packaged mode:
 *   - Pass `opts.resourcesPath` (= `process.resourcesPath` from the Electron
 *     main process) so each TARGET resolves into `app.asar.unpacked/`. The
 *     existing single-arg form (`verifyAll(repoRoot)`) is unchanged and
 *     stays in use by `scripts/verify-native-arch.js` + the parity test.
 *
 * @param {string} [repoRoot]  defaults to process.cwd(); pass explicitly
 *                             when called from main.ts (which has its own cwd).
 * @param {{ resourcesPath?: string, packaged?: boolean }} [opts]
 * @returns {{ ok: boolean, skipped?: boolean, hardware?: string, mismatches: Array<{ path: string, actual: string, expected: string }>, fix: string, packaged?: boolean }}
 */
export function verifyAll(repoRoot = process.cwd(), opts = {}) {
  if (os.platform() !== 'darwin') {
    return { ok: true, skipped: true, mismatches: [] };
  }

  const expected = detectHardwareArch();
  const mismatches = [];

  for (const rel of TARGETS) {
    const abs = resolveTargetPath(rel, { repoRoot, resourcesPath: opts.resourcesPath });
    if (!existsSync(abs)) {
      // Not built yet (e.g. partial install) — the rebuild step is what
      // creates these; absence isn't an arch error.
      continue;
    }
    const actual = binaryArch(abs);
    if (String(actual).startsWith('unknown')) {
      // `file -b` output can vary across macOS releases/locales. Unknown probe
      // output is not proof of a wrong-arch binary, so fail open instead of
      // blocking every launch with the native-arch dialog.
      console.warn(`[nativeArch] could not classify ${rel} (${actual}); skipping arch gate for this file`);
      continue;
    }
    if (actual !== expected) {
      mismatches.push({
        path: rel,
        actual,
        expected: ARCH_TO_MACHO[expected] || expected,
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    hardware: expected,
    mismatches,
    fix: buildFixCommand({ packaged: opts.packaged }),
    packaged: !!opts.packaged,
  };
}

// ---------------------------------------------------------------------------
// User-facing fix guidance.
// ---------------------------------------------------------------------------

/**
 * End-user-facing message for a packaged-app arch mismatch. An end-user
 * cannot run `npm run rebuild:native`; the only action available is to
 * reinstall the DMG that matches their Mac's CPU.
 */
const PACKAGED_REINSTALL_MESSAGE =
  'This copy of Natively was built for a different chip than your Mac.\n' +
  'Please download the correct version and reinstall:\n\n' +
  '  https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant/releases/latest\n\n' +
  '  • Apple Silicon (M1–M4): the arm64 DMG\n' +
  '  • Intel Macs:            the standard DMG\n\n' +
  'Your data is safe — reinstalling over the current app keeps meeting\n' +
  'history and settings.';

/**
 * The single command the user (or our dialog) should suggest.
 * Always wraps in `arch -arm64` on macOS so the toolchain itself runs
 * natively, not under Rosetta.
 *
 * In packaged mode (`opts.packaged === true`), end-users cannot rebuild
 * from a terminal — return a reinstall-the-DMG message instead.
 */
export function buildFixCommand(opts = {}) {
  if (opts.packaged) return PACKAGED_REINSTALL_MESSAGE;
  if (os.platform() === 'darwin') {
    return 'arch -arm64 npm run rebuild:native';
  }
  return 'npm run rebuild:native';
}