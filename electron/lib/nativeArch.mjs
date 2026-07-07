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
 * @param {string} [repoRoot]  defaults to process.cwd(); pass explicitly
 *                             when called from main.ts (which has its own cwd).
 * @returns {{ ok: boolean, skipped?: boolean, hardware?: string, mismatches: Array<{ path: string, actual: string, expected: string }>, fix: string }}
 */
export function verifyAll(repoRoot = process.cwd()) {
  if (os.platform() !== 'darwin') {
    return { ok: true, skipped: true, mismatches: [] };
  }

  const expected = detectHardwareArch();
  const mismatches = [];

  for (const rel of TARGETS) {
    const abs = path.join(repoRoot, rel);
    if (!existsSync(abs)) {
      // Not built yet (e.g. partial install) — the rebuild step is what
      // creates these; absence isn't an arch error.
      continue;
    }
    const actual = binaryArch(abs);
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
    fix: buildFixCommand(),
  };
}

// ---------------------------------------------------------------------------
// User-facing fix command.
// ---------------------------------------------------------------------------

/**
 * The single command the user (or our dialog) should suggest.
 * Always wraps in `arch -arm64` on macOS so the toolchain itself runs
 * natively, not under Rosetta.
 */
export function buildFixCommand() {
  if (os.platform() === 'darwin') {
    return 'arch -arm64 npm run rebuild:native';
  }
  return 'npm run rebuild:native';
}