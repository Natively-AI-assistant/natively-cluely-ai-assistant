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
const { existsSync, openSync, readSync, closeSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TARGETS = Object.freeze([
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'node_modules/keytar/build/Release/keytar.node',
]);

const ARCH_TO_MACHO = { arm64: 'arm64', x64: 'x86_64' };

// PE IMAGE_FILE_HEADER.Machine -> Node arch. Kept byte-identical to
// nativeArch.mjs (parity test asserts both files agree).
const PE_MACHINE_TO_ARCH = Object.freeze({
  0x8664: 'x64',
  0x014c: 'ia32',
  0xaa64: 'arm64',
});

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

function pePlatformArch(absPath) {
  let fd;
  try {
    fd = openSync(absPath, 'r');

    const dos = Buffer.alloc(2);
    if (readSync(fd, dos, 0, 2, 0) < 2 || dos.toString('latin1') !== 'MZ') {
      return 'unknown (not a PE image: missing MZ signature)';
    }

    const lfanew = Buffer.alloc(4);
    if (readSync(fd, lfanew, 0, 4, 0x3c) < 4) return 'unknown (truncated DOS header)';
    const peOffset = lfanew.readInt32LE(0);
    if (peOffset <= 0) return `unknown (bad PE offset ${peOffset})`;

    const head = Buffer.alloc(6);
    if (readSync(fd, head, 0, 6, peOffset) < 6) return 'unknown (truncated PE header)';
    if (head.toString('latin1', 0, 4) !== 'PE\0\0') return 'unknown (missing PE signature)';

    const machine = head.readUInt16LE(4);
    return PE_MACHINE_TO_ARCH[machine] || `unknown (PE machine 0x${machine.toString(16).padStart(4, '0')})`;
  } catch (error) {
    return `unknown (${error.message})`;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* already gone */ }
    }
  }
}

function binaryArch(absPath, platform = os.platform()) {
  if (platform === 'win32') return pePlatformArch(absPath);
  const out = execFileSync('file', ['-b', absPath], { encoding: 'utf8' });
  if (/\barm64\b/.test(out)) return 'arm64';
  if (/\bx86_64\b/.test(out)) return 'x64';
  return `unknown (${out.trim()})`;
}

/**
 * Resolve a TARGET (a `node_modules/...` relative path) to an absolute path,
 * correctly handling packaged vs dev layouts. See electron/lib/nativeArch.mjs
 * for the full rationale.
 */
function resolveTargetPath(rel, { repoRoot, resourcesPath } = {}) {
  if (resourcesPath) {
    return path.join(resourcesPath, 'app.asar.unpacked', rel);
  }
  return path.join(repoRoot || process.cwd(), rel);
}

function verifyAll(repoRoot = process.cwd(), opts = {}) {
  const platform = opts.platform || os.platform();
  if (platform !== 'darwin' && platform !== 'win32') {
    return { ok: true, skipped: true, mismatches: [] };
  }
  const expected = detectHardwareArch();
  const mismatches = [];
  for (const rel of TARGETS) {
    const abs = resolveTargetPath(rel, { repoRoot, resourcesPath: opts.resourcesPath });
    if (!existsSync(abs)) continue;
    const actual = binaryArch(abs, platform);
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
        expected: platform === 'win32' ? expected : ARCH_TO_MACHO[expected] || expected,
      });
    }
  }
  return {
    ok: mismatches.length === 0,
    hardware: expected,
    mismatches,
    fix: buildFixCommand({ packaged: opts.packaged, platform }),
    packaged: !!opts.packaged,
  };
}

// Packaged-mode reinstall message — kept byte-identical to nativeArch.mjs
// (parity test asserts both files agree). An end-user cannot run
// `npm run rebuild:native`; the only action available is to reinstall the
// DMG that matches their Mac's CPU.
const PACKAGED_REINSTALL_MESSAGE =
  'This copy of Natively was built for a different chip than your Mac.\n' +
  'Please download the correct version and reinstall:\n\n' +
  '  https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant/releases/latest\n\n' +
  '  • Apple Silicon (M1–M4): the arm64 DMG\n' +
  '  • Intel Macs:            the standard DMG\n\n' +
  'Your data is safe — reinstalling over the current app keeps meeting\n' +
  'history and settings.';

// Windows counterpart. The macOS text names Apple Silicon and DMGs, neither of
// which exists here; the realistic Windows cause is a 32-bit installer on a
// 64-bit machine. Kept byte-identical to nativeArch.mjs.
const PACKAGED_REINSTALL_MESSAGE_WINDOWS =
  'This copy of Natively was built for a different processor architecture\n' +
  'than this PC. Please download the correct installer and reinstall:\n\n' +
  '  https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant/releases/latest\n\n' +
  'Your data is safe — reinstalling over the current app keeps meeting\n' +
  'history and settings.';

function buildFixCommand(opts = {}) {
  const platform = opts.platform || os.platform();
  if (opts.packaged) {
    return platform === 'win32' ? PACKAGED_REINSTALL_MESSAGE_WINDOWS : PACKAGED_REINSTALL_MESSAGE;
  }
  if (platform === 'darwin') {
    return 'arch -arm64 npm run rebuild:native';
  }
  return 'npm run rebuild:native';
}

module.exports = {
  TARGETS,
  detectHardwareArch,
  binaryArch,
  pePlatformArch,
  buildFixCommand,
  resolveTargetPath,
  verifyAll,
};