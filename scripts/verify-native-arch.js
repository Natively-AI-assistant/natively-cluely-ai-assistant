/**
 * Fail-loud guard: asserts that Electron's native addons on disk are built
 * for the true hardware architecture. Run at the end of `postinstall` so a
 * Rosetta-poisoned (x86_64-on-arm64) binary is caught at install time with a
 * one-line fix, instead of surfacing later as a wall of ERR_DLOPEN_FAILED
 * stack traces at app startup.
 *
 * Mirrors the verifyArtifacts() throw-on-mismatch style in build-native.js.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');

const TARGETS = [
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'node_modules/keytar/build/Release/keytar.node',
];

function detectHardwareArch() {
  if (os.platform() !== 'darwin') return process.arch;
  try {
    const isArm = execFileSync('sysctl', ['-in', 'hw.optional.arm64'], { encoding: 'utf8' }).trim();
    return isArm === '1' ? 'arm64' : 'x64';
  } catch {
    return process.arch;
  }
}

// Map a Node/Electron arch string to the token that `file` prints.
const ARCH_TO_MACHO = { arm64: 'arm64', x64: 'x86_64' };

function binaryArch(absPath) {
  // `file` prints e.g. "...: Mach-O 64-bit bundle arm64"
  const out = execFileSync('file', ['-b', absPath], { encoding: 'utf8' });
  if (/\barm64\b/.test(out)) return 'arm64';
  if (/\bx86_64\b/.test(out)) return 'x64';
  return `unknown (${out.trim()})`;
}

function main() {
  // Only meaningful on macOS, where Rosetta arch drift happens. Other
  // platforms don't have the x86_64/arm64 translation footgun.
  if (os.platform() !== 'darwin') {
    return;
  }

  const expected = detectHardwareArch();
  const mismatches = [];

  for (const rel of TARGETS) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      // Not built yet (e.g. partial install) — the rebuild step is what
      // creates these; absence isn't an arch error.
      console.warn(`[verify-native-arch] ${rel} not present — skipping (expected after rebuild step).`);
      continue;
    }
    const actual = binaryArch(abs);
    if (actual !== expected) {
      mismatches.push(`${rel}: built ${actual}, need ${ARCH_TO_MACHO[expected] || expected}`);
    } else {
      console.log(`[verify-native-arch] OK ${rel} (${actual})`);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Native module architecture mismatch (hardware is ${expected}):\n` +
      mismatches.map((m) => `  - ${m}`).join('\n') +
      `\n\nFix: run \`npm run rebuild:native\` from a native (non-Rosetta) shell.\n` +
      `If your terminal is running under Rosetta, open a fresh arm64 terminal first.`
    );
  }
}

main();
