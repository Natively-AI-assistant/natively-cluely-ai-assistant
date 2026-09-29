// Tests for the two halves of the v2.8.7 Intel-packaging fix:
//
//   1. scripts/lib/ensure-mac-optional-deps.cjs — installs BOTH darwin arches of a
//      per-arch optional-dependency family before a universal mac pack.
//   2. verifyPackedArchFamilies in scripts/ad-hoc-sign.js — fails the build if a
//      pack is missing its own arch's member of such a family.
//
// THE BUG THEY EXIST FOR: v2.8.7's x64 DMG shipped with only
// @napi-rs/canvas-darwin-arm64. Nothing was mis-built, so the existing Arch Guard
// (which checks for WRONG arch and tolerates MISSING files) stayed silent. The app
// launched fine — canvas loads lazily — but PDF text extraction failed on every
// Intel Mac with "DOMMatrix is not defined".
//
// Everything here is pure or filesystem-fixture based: no npm, no network, and both
// platform branches run from either host.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveVersions, computeMissing, ensureMacOptionalDeps } = require('../lib/ensure-mac-optional-deps.cjs');
const { verifyPackedArchFamilies } = require('../ad-hoc-sign.js');

// ---------------------------------------------------------------------------
// resolveVersions / computeMissing
// ---------------------------------------------------------------------------

const LOCK = {
  packages: {
    'node_modules/@napi-rs/canvas': {
      version: '0.1.80',
      optionalDependencies: {
        '@napi-rs/canvas-darwin-arm64': '0.1.80',
        '@napi-rs/canvas-darwin-x64': '0.1.80',
        '@napi-rs/canvas-win32-x64-msvc': '0.1.80',
      },
    },
  },
};

test('resolveVersions pins both darwin arches from the lockfile', () => {
  const v = resolveVersions(LOCK, 'node_modules/@napi-rs/canvas', [
    '@napi-rs/canvas-darwin-arm64',
    '@napi-rs/canvas-darwin-x64',
  ]);
  assert.deepEqual(v, {
    '@napi-rs/canvas-darwin-arm64': '0.1.80',
    '@napi-rs/canvas-darwin-x64': '0.1.80',
  });
});

test('resolveVersions fails loudly rather than floating to "latest"', () => {
  // A native binding drifting from its parent package is its own class of bug,
  // so an unresolvable pin must stop the build, not install whatever npm has.
  assert.throws(
    () => resolveVersions(LOCK, 'node_modules/@napi-rs/canvas', ['@napi-rs/canvas-darwin-riscv']),
    /Missing @napi-rs\/canvas-darwin-riscv/
  );
});

test('resolveVersions names the package when the lockfile entry is absent', () => {
  assert.throws(() => resolveVersions(LOCK, 'node_modules/nope', ['x']), /node_modules\/nope/);
});

test('computeMissing returns only the not-yet-installed packages', () => {
  const installed = new Set(['a']);
  assert.deepEqual(computeMissing(['a', 'b', 'c'], (n) => installed.has(n)), ['b', 'c']);
  assert.deepEqual(computeMissing(['a'], (n) => installed.has(n)), []);
});

test('ensureMacOptionalDeps is a no-op on Windows', () => {
  // Windows builds resolve their own optional deps; this step must not run there
  // (and must not read package-lock.json or shell out) — injected platform proves it.
  const r = ensureMacOptionalDeps({
    label: 'test',
    rootDir: '/definitely/not/a/repo',
    lockKey: 'node_modules/whatever',
    required: ['a'],
    tmpPrefix: 't-',
    platform: 'win32',
  });
  assert.deepEqual(r, { skipped: true, installed: [] });
});

// ---------------------------------------------------------------------------
// verifyPackedArchFamilies — the build-time catch
// ---------------------------------------------------------------------------

/** Build a fake packed .app containing the given platform packages. */
function fakePack(packages) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-'));
  const nm = path.join(root, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules');
  for (const pkg of packages) {
    const dir = path.join(nm, ...pkg.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: pkg, version: '0.0.0' }));
  }
  fs.mkdirSync(nm, { recursive: true });
  return root;
}

/** Run the guard with console noise suppressed. */
function guard(appPath, arch) {
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try {
    verifyPackedArchFamilies(appPath, arch);
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

test('the exact v2.8.7 shape fails the build: x64 pack with only the arm64 canvas', () => {
  const app = fakePack([
    '@napi-rs/canvas-darwin-arm64', // the bug: arm64 only
    '@img/sharp-darwin-x64',
    '@img/sharp-libvips-darwin-x64',
    'sqlite-vec-darwin-x64',
  ]);
  assert.throws(() => guard(app, 'x64'), (err) => {
    assert.match(err.message, /@napi-rs\/canvas-darwin-x64 MISSING/);
    assert.match(err.message, /@napi-rs\/canvas-darwin-arm64 IS packed/);
    assert.match(err.message, /Intel/);
    return true;
  });
});

test('a complete x64 pack passes', () => {
  const app = fakePack([
    '@napi-rs/canvas-darwin-x64',
    '@img/sharp-darwin-x64',
    '@img/sharp-libvips-darwin-x64',
    'sqlite-vec-darwin-x64',
  ]);
  guard(app, 'x64'); // must not throw
});

test('the mirror-image bug is caught too: arm64 pack with only the x64 canvas', () => {
  const app = fakePack(['@napi-rs/canvas-darwin-x64']);
  assert.throws(() => guard(app, 'arm64'), /@napi-rs\/canvas-darwin-arm64 MISSING/);
});

test('a family absent for BOTH arches is tolerated, not fatal', () => {
  // The dependency may legitimately not ship; only a half-present family is proof
  // of the packaging bug.
  const app = fakePack(['@img/sharp-darwin-x64', '@img/sharp-libvips-darwin-x64', 'sqlite-vec-darwin-x64']);
  guard(app, 'x64'); // canvas absent entirely — must not throw
});

test('a non-mac target arch is skipped entirely', () => {
  const app = fakePack(['@napi-rs/canvas-darwin-arm64']);
  guard(app, 'ia32'); // must not throw
});

test('the afterPack hook electron-builder calls is still a function', () => {
  // The guards are exported as siblings of `.default`; regressing that shape would
  // break packaging silently.
  assert.equal(typeof require('../ad-hoc-sign.js').default, 'function');
});
