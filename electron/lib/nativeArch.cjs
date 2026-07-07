/**
 * CommonJS shim around electron/lib/nativeArch.mjs.
 *
 * Needed because some consumers (scripts/rebuild-native-electron.js,
 * electron/nativeArchGate.ts) are CommonJS and call detectHardwareArch()
 * and verifyAll() synchronously at module top level. Native CommonJS
 * cannot `require()` an ESM .mjs file synchronously — the only ways are
 * dynamic `import()` (async, can't be used at top level) or a child-process
 * bridge (heavyweight for a 5-line helper).
 *
 * This shim reimplements the public surface of nativeArch.mjs using only
 * CommonJS APIs. It MUST be kept in lockstep with nativeArch.mjs — drift
 * here re-introduces the bug the shared module exists to prevent.
 *
 * Sync callers: scripts/rebuild-native-electron.js (detectHardwareArch)
 *               electron/nativeArchGate.ts (verifyAll, run at module-load
 *                 before init_DatabaseManager fires)
 * Async/ESM callers: scripts/verify-native-arch.js (uses nativeArch.mjs via
 *                    dynamic import — has the full surface including async
 *                    verifyAll)
 */

const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TARGETS = Object.freeze([
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'node_modules/keytar/build/Release/keytar.node',
]);

const ARCH_TO_MACHO = { arm64: 'arm64', x64: 'x86_64' };

function detectHardwareArch() {
  if (os.platform() !== 'darwin') return process.arch;
  try {
    const isArm = execFileSync('sysctl', ['-in', 'hw.optional.arm64'], { encoding: 'utf8' }).trim();
    if (isArm === '1') return 'arm64';
    return 'x64';
  } catch {
    return process.arch;
  }
}

function binaryArch(absPath) {
  const out = execFileSync('file', ['-b', absPath], { encoding: 'utf8' });
  if (/\barm64\b/.test(out)) return 'arm64';
  if (/\bx86_64\b/.test(out)) return 'x64';
  return `unknown (${out.trim()})`;
}

function buildFixCommand() {
  if (os.platform() === 'darwin') {
    return 'arch -arm64 npm run rebuild:native';
  }
  return 'npm run rebuild:native';
}

function verifyAll(repoRoot = process.cwd()) {
  if (os.platform() !== 'darwin') {
    return { ok: true, skipped: true, mismatches: [] };
  }
  const expected = detectHardwareArch();
  const mismatches = [];
  for (const rel of TARGETS) {
    const abs = path.join(repoRoot, rel);
    if (!existsSync(abs)) continue;
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

module.exports = {
  TARGETS,
  detectHardwareArch,
  binaryArch,
  buildFixCommand,
  verifyAll,
};