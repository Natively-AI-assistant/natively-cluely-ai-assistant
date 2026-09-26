// The Windows artifact bookkeeping in scripts/build-native.js must never leave
// the developer with no native module.
//
// Windows locks a loaded DLL against deletion, so the script renames the
// previous .node aside before `napi build` writes a new one. The hazard is what
// happens to that copy when the build FAILS: runCommand uses execSync, which
// throws and aborts the script. A revision that unlinked the copy up-front
// destroyed the last-good binary in the ordinary case (app not running, so the
// unlink succeeds) before a build that might not produce a replacement — and
// .gitignore lists native-module/*.node, so git cannot restore it.
//
// These tests drive the REAL script with os.platform() forced to 'win32' and
// `napi build` stubbed, then assert on the actual filesystem.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const scriptPath = path.join(repoRoot, 'scripts/build-native.js');

const ARTIFACT = 'index.win32-x64-msvc.node';
const LAST_GOOD = 'LAST-GOOD-BINARY';

/**
 * Runs build-native.js in a throwaway tree with a fake native-module dir.
 *
 * The script is loaded as source and evaluated with `os` and `child_process`
 * shimmed, so the control flow under test is the shipped control flow — not a
 * paraphrase of it. `buildSucceeds:false` makes the stubbed napi build throw
 * exactly the way execSync does on a non-zero exit.
 */
function runBuildNative({ buildSucceeds, artifactWritten = ARTIFACT }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-build-native-'));
  const nativeDir = path.join(tmp, 'native-module');
  fs.mkdirSync(nativeDir, { recursive: true });
  fs.writeFileSync(path.join(nativeDir, ARTIFACT), LAST_GOOD);

  const source = fs.readFileSync(scriptPath, 'utf8');

  const fakeOs = { ...os, platform: () => 'win32', arch: () => 'x64' };
  const commands = [];
  const fakeChildProcess = {
    execSync: (cmd, opts) => {
      commands.push(cmd);
      if (String(cmd).includes('napi build')) {
        if (!buildSucceeds) {
          const err = new Error(`Command failed: ${cmd}`);
          err.status = 101;
          throw err;
        }
        // A successful build writes a fresh artifact, as napi would. The name
        // is parameterised: napi can exit 0 and still emit a DIFFERENT triple
        // (toolchain falls back to ia32, or the target name changes).
        fs.writeFileSync(path.join(nativeDir, artifactWritten), 'FRESH-BINARY');
        return '';
      }
      return '';
    },
    spawnSync: () => ({ status: 0, stdout: '', stderr: '' }),
  };

  const fakeRequire = (id) => {
    if (id === 'os' || id === 'node:os') return fakeOs;
    if (id === 'child_process' || id === 'node:child_process') return fakeChildProcess;
    return require(id);
  };

  let threw = null;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', source);
    fn(fakeRequire, { exports: {} }, {}, path.join(tmp, 'scripts'), path.join(tmp, 'scripts/build-native.js'));
  } catch (e) {
    threw = e;
  }

  const remaining = fs.readdirSync(nativeDir);
  return { tmp, nativeDir, remaining, threw, commands };
}

// `require` is not defined in an ESM module scope; build a CJS one.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('a FAILED Windows build leaves the previous .node in place', () => {
  const { nativeDir, remaining, threw } = runBuildNative({ buildSucceeds: false });

  assert.ok(threw, 'a failing napi build must still abort the script');

  const artifactPath = path.join(nativeDir, ARTIFACT);
  assert.ok(
    fs.existsSync(artifactPath),
    `BUG: the last-good ${ARTIFACT} was destroyed by a failed build. It is gitignored, ` +
      `so the developer cannot get it back. Files left behind: ${JSON.stringify(remaining)}`
  );
  assert.equal(
    fs.readFileSync(artifactPath, 'utf8'),
    LAST_GOOD,
    'the restored artifact must be the original bytes, not a truncated or partial write'
  );
});

test('a SUCCESSFUL Windows build replaces the artifact and sweeps the stale copy', () => {
  const { nativeDir, remaining } = runBuildNative({ buildSucceeds: true });

  const artifactPath = path.join(nativeDir, ARTIFACT);
  assert.ok(fs.existsSync(artifactPath), 'a successful build must leave the fresh artifact');
  assert.equal(fs.readFileSync(artifactPath, 'utf8'), 'FRESH-BINARY');

  const strays = remaining.filter((f) => f.includes('.node.stale-'));
  assert.deepEqual(
    strays,
    [],
    `a successful build must clean up its moved-aside copies; found ${JSON.stringify(strays)}`
  );
});

test('a build that exits 0 with the WRONG artifact still keeps the previous .node', () => {
  // napi returns 0 but writes a different triple than this platform/arch
  // expects — a toolchain that silently falls back to ia32, or a target rename.
  // verifyArtifacts() is what catches that, so it MUST run before the stale
  // copies are swept. Sweeping first deleted the last-good binary and only then
  // reported the failure, with the restore path already behind us.
  const { nativeDir, remaining, threw } = runBuildNative({
    buildSucceeds: true,
    artifactWritten: 'index.win32-ia32-msvc.node',
  });

  assert.ok(threw, 'a missing expected artifact must abort the script');
  assert.match(String(threw.message), /Missing native artifacts|artifact/i);

  const artifactPath = path.join(nativeDir, ARTIFACT);
  assert.ok(
    fs.existsSync(artifactPath),
    `BUG: napi exited 0 without producing ${ARTIFACT}, and the last-good copy was swept before ` +
      `verifyArtifacts() could reject it. Files left behind: ${JSON.stringify(remaining)}`
  );
  assert.equal(fs.readFileSync(artifactPath, 'utf8'), LAST_GOOD);
});

test('a rescue copy survives the next run\'s stale sweep', () => {
  // When the restore rename fails (the DLL is mapped by a running Natively),
  // the script prints "the last-good binary is at <path>". The sweep at the top
  // of the NEXT run used to delete every '.node.stale-*' file unconditionally —
  // including that one — so the advice pointed at a file the next build removed
  // before the developer could act on it.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-rescue-'));
  const nativeDir = path.join(tmp, 'native-module');
  fs.mkdirSync(nativeDir, { recursive: true });

  // The state a failed restore leaves behind: a rescue copy plus an ordinary
  // stale copy from some older build.
  // Name it exactly as the script does: '.node.stale-<ts>' + the marker. The
  // marker must sit INSIDE the sweep's '.node.stale-' filter, or the skip is
  // dead code and this test proves nothing.
  const rescue = path.join(nativeDir, `${ARTIFACT}.stale-1111111111.rescue-last-good`);
  const ordinaryStale = path.join(nativeDir, `${ARTIFACT}.stale-1234567890`);
  fs.writeFileSync(rescue, LAST_GOOD);
  fs.writeFileSync(ordinaryStale, 'OLD-JUNK');

  const source = fs.readFileSync(scriptPath, 'utf8');
  const fakeOs = { ...os, platform: () => 'win32', arch: () => 'x64' };
  const fakeChildProcess = {
    execSync: (cmd) => {
      if (String(cmd).includes('napi build')) {
        fs.writeFileSync(path.join(nativeDir, ARTIFACT), 'FRESH-BINARY');
      }
      return '';
    },
    spawnSync: () => ({ status: 0, stdout: '', stderr: '' }),
  };
  const fakeRequire = (id) => {
    if (id === 'os' || id === 'node:os') return fakeOs;
    if (id === 'child_process' || id === 'node:child_process') return fakeChildProcess;
    return require(id);
  };

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', source);
    fn(fakeRequire, { exports: {} }, {}, path.join(tmp, 'scripts'), path.join(tmp, 'scripts/build-native.js'));
  } catch {
    // A throw is irrelevant here; only the filesystem outcome matters.
  }

  assert.ok(
    fs.existsSync(rescue),
    'BUG: the stale sweep deleted the rescue copy the failure message tells the developer to recover from'
  );
  assert.equal(fs.readFileSync(rescue, 'utf8'), LAST_GOOD);
  assert.ok(
    !fs.existsSync(ordinaryStale),
    'ordinary stale copies must still be swept — only the marked rescue copy is preserved'
  );
});
