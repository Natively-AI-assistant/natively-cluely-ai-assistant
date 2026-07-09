/**
 * Packaged-mode resolution test for the nativeArch boot gate.
 *
 * Background:
 *   v2.8.1 shipped a fatal "Native modules are wrong architecture" dialog
 *   for every end-user launch because the boot gate probed the asar virtual
 *   filesystem (`app.asar/node_modules/...`) instead of the real unpacked
 *   tree (`app.asar.unpacked/node_modules/...`). The shipped binaries are
 *   correct (`file -b` on them prints `Mach-O 64-bit bundle arm64`) — the
 *   gate just looked in the wrong place.
 *
 * What this test asserts:
 *   1. PRODUCTION PATH: with `resourcesPath` pointing at the already-shipped
 *      `release/mac-arm64/Natively.app/Contents/Resources` AND the current
 *      Mac being arm64, `verifyAll(undefined, { resourcesPath, packaged })`
 *      returns `ok:true`. This is the exact call the boot gate makes after
 *      the v2.8.2 fix — if it ever fires `ok:false` on this binary, the
 *      shipped DMG is broken.
 *   2. UNPACKED PATH RESOLUTION: `resolveTargetPath` must produce a path
 *      under `app.asar.unpacked/`, not `app.asar/`. A regression here
 *      re-introduces the v2.8.1 bug.
 *   3. NEGATIVE CASE: a hand-crafted temp tree with a wrong-arch `.node`
 *      must produce `ok:false` with the correct mismatch entry — proving
 *      the gate still fires when a real mismatch exists.
 *   4. PACKAGED UX: `buildFixCommand({ packaged: true })` returns the
 *      end-user reinstall message, NOT a developer shell command.
 *
 * Runs under bare node (`node --test`) — does not require Electron.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

// Load the CJS mirror synchronously — the boot gate uses the CJS surface
// (it runs before require('electron') is safe), so testing the CJS side is
// what actually exercises the production code path.
const cjs = require('./lib/nativeArch.cjs');

// ---------------------------------------------------------------------------
// Path constants — resolve against THIS test file's location so the test
// is independent of the cwd `node --test` was invoked with.
// ---------------------------------------------------------------------------

// `new URL(...).pathname` strips a leading `/` on POSIX, which broke the
// earlier path-join. `fileURLToPath` returns the canonical filesystem path.
const HERE = path.dirname(fileURLToPath(import.meta.url));
// HERE = <repo>/electron  →  REPO_ROOT = <repo>. One `..` is enough.
const REPO_ROOT = path.resolve(HERE, '..');
const SHIPPED_ARM64_RESOURCES = path.join(REPO_ROOT, 'release', 'mac-arm64', 'Natively.app', 'Contents', 'Resources');
const SHIPPED_X64_RESOURCES = path.join(REPO_ROOT, 'release', 'mac', 'Natively.app', 'Contents', 'Resources');
const SHIPPED_RESOURCES = SHIPPED_ARM64_RESOURCES;
const SHIPPED_SQLITE = path.join(SHIPPED_ARM64_RESOURCES, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
const SHIPPED_KEYTAR = path.join(SHIPPED_ARM64_RESOURCES, 'app.asar.unpacked', 'node_modules', 'keytar', 'build', 'Release', 'keytar.node');
const SHIPPED_X64_SQLITE = path.join(SHIPPED_X64_RESOURCES, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
const SHIPPED_X64_KEYTAR = path.join(SHIPPED_X64_RESOURCES, 'app.asar.unpacked', 'node_modules', 'keytar', 'build', 'Release', 'keytar.node');

function isArm64Mac() {
  if (os.platform() !== 'darwin') return false;
  try {
    return execFileSync('sysctl', ['-in', 'hw.optional.arm64'], { encoding: 'utf8' }).trim() === '1';
  } catch {
    return false;
  }
}

describe('nativeArch packaged resolution (v2.8.2 fix)', () => {
  test('resolveTargetPath produces app.asar.unpacked paths, not app.asar paths', () => {
    const rel = 'node_modules/better-sqlite3/build/Release/better_sqlite3.node';
    const resolved = cjs.resolveTargetPath(rel, { resourcesPath: SHIPPED_RESOURCES });
    assert.ok(
      resolved.includes('app.asar.unpacked/'),
      `path must include 'app.asar.unpacked/' (got: ${resolved})`,
    );
    assert.ok(
      !resolved.includes('app.asar/'),
      `path must NOT include 'app.asar/' (got: ${resolved})`,
    );
  });

  test('SHIPPED arm64 binaries verify clean via the packaged resourcesPath path', { skip: !existsSync(SHIPPED_SQLITE) || !existsSync(SHIPPED_KEYTAR) || !isArm64Mac(), reason: 'requires the shipped mac-arm64 .app + an arm64 Mac' }, () => {
    const result = cjs.verifyAll(undefined, {
      resourcesPath: SHIPPED_RESOURCES,
      packaged: true,
    });
    assert.equal(result.ok, true, `expected ok:true, got mismatches=${JSON.stringify(result.mismatches)}`);
    assert.equal(result.packaged, true);
    assert.equal(result.hardware, 'arm64');
    assert.deepEqual(result.mismatches, []);
  });

  test('Packaged fix command is end-user-actionable, not a developer shell command', () => {
    const msg = cjs.buildFixCommand({ packaged: true });
    assert.ok(!msg.includes('npm run'), 'must NOT suggest npm scripts to end-users');
    assert.ok(!msg.includes('arch -'), 'must NOT suggest shell-arch wrappers');
    assert.ok(msg.includes('releases/latest'), 'must point users to the release page');
    assert.ok(msg.includes('arm64'), 'must explain the two DMG flavors');
  });

  test('NEGATIVE: a real wrong-arch .node tree under app.asar.unpacked fires ok:false', {
    skip: !isArm64Mac() || !existsSync(SHIPPED_X64_SQLITE) || !existsSync(SHIPPED_X64_KEYTAR),
    reason: 'requires an arm64 Mac plus the shipped x64 .app fixture',
  }, () => {
    // Build a fake packaged Resources tree using the REAL x64 .node files
    // from the x64 packaged .app as the wrong-arch fixtures. This exercises
    // the actual `file -b` probe and avoids the previous inert monkey-patch
    // false positive (verifyAll calls the local lexical binaryArch binding,
    // not module.exports.binaryArch).
    const tmpResources = mkdtempSync(path.join(os.tmpdir(), 'natively-arch-test-'));
    try {
      const sqliteDir = path.join(tmpResources, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release');
      const keytarDir = path.join(tmpResources, 'app.asar.unpacked', 'node_modules', 'keytar', 'build', 'Release');
      mkdirSync(sqliteDir, { recursive: true });
      mkdirSync(keytarDir, { recursive: true });
      copyFileSync(SHIPPED_X64_SQLITE, path.join(sqliteDir, 'better_sqlite3.node'));
      copyFileSync(SHIPPED_X64_KEYTAR, path.join(keytarDir, 'keytar.node'));

      const result = cjs.verifyAll(undefined, {
        resourcesPath: tmpResources,
        packaged: true,
      });

      assert.equal(result.ok, false, 'expected real x64 fixtures to mismatch on arm64 Mac');
      assert.equal(result.mismatches.length, 2);
      assert.ok(result.mismatches.every((m) => m.actual === 'x64'), JSON.stringify(result.mismatches));
      assert.ok(result.mismatches.some((m) => m.path.includes('better-sqlite3')));
      assert.ok(result.mismatches.some((m) => m.path.includes('keytar')));
      assert.ok(result.fix.includes('releases/latest'), 'fix message must be the packaged reinstall');
    } finally {
      rmSync(tmpResources, { recursive: true, force: true });
    }
  });

  test('Missing .node in the unpacked tree is silently skipped (not a mismatch)', () => {
    // A fresh install before the rebuild step won't have unpacked binaries
    // yet — the gate must not block the app on infra absence. The
    // postinstall verify-native-arch script handles that case separately.
    const tmpResources = mkdtempSync(path.join(os.tmpdir(), 'natively-arch-test-empty-'));
    try {
      mkdirSync(path.join(tmpResources, 'app.asar.unpacked'), { recursive: true });
      const result = cjs.verifyAll(undefined, {
        resourcesPath: tmpResources,
        packaged: true,
      });
      assert.equal(result.ok, true, 'no files = no mismatch (rebuild step is responsible for creating them)');
      assert.deepEqual(result.mismatches, []);
    } finally {
      rmSync(tmpResources, { recursive: true, force: true });
    }
  });
});