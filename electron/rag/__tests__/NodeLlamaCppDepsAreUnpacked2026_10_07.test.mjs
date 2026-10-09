// Regression test for: GGUF rerankers failed to start in every packaged build
// with "Cannot find package 'chalk' imported from ...app.asar.unpacked/
// node_modules/node-llama-cpp/dist/bindings/Llama.js".
//
// THE BUG. node-llama-cpp is in asarUnpack (it carries native binaries), but
// its own dependencies were not. electron-builder hoists the production tree,
// so chalk@5 (which the dev tree keeps nested under node-llama-cpp, because the
// root has chalk@4 as a dev dependency) lands at the TOP of node_modules inside
// app.asar. node-llama-cpp is ESM, and its `import 'chalk'` resolves on the real
// filesystem from app.asar.unpacked/, where there is no chalk: Node's ESM loader
// does not go through Electron's asar shim, so it never looks inside the archive.
//
// The dev tree cannot show this, and neither can a macOS or Windows
// `--dir` build that is only launched: the failure is a missing file on the
// import path of one worker.
//
// THE GUARD. Every package node-llama-cpp can reach through dependencies and
// optionalDependencies must be matched by an asarUnpack pattern. The closure is
// DERIVED from node_modules rather than hard-coded, so a node-llama-cpp upgrade
// that adds a dependency fails here instead of in a user's packaged app.
//
// Platform note: asar layout is identical on macOS and Windows, and the check is
// by package NAME, so it holds for both. Optional platform packages that are not
// installed on the machine running the test are skipped; the scoped patterns for
// them (@node-llama-cpp/**, @reflink/**) are asserted separately.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const { minimatch } = require('minimatch');

const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const asarUnpack = pkg?.build?.asarUnpack ?? [];

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** Node-style lookup: <dir>/node_modules/<name>, then each ancestor's. */
function resolvePackageDir(fromDir, name) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function dependencyClosure(rootName) {
  const rootDir = resolvePackageDir(repoRoot, rootName);
  assert.ok(rootDir, `${rootName} is not installed`);
  const seen = new Map();
  // Declared optional dependencies, installed or not. The walk only follows what
  // this machine installed, so a Windows-only package would otherwise be
  // invisible to a test that runs on macOS.
  const declaredOptional = new Set();
  const walk = (dir) => {
    if (seen.has(dir)) return;
    const manifest = readJson(path.join(dir, 'package.json'));
    seen.set(dir, manifest.name);
    for (const name of Object.keys(manifest.optionalDependencies ?? {})) declaredOptional.add(name);
    const names = Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies });
    for (const name of names) {
      const found = resolvePackageDir(dir, name);
      if (found) walk(found);
    }
  };
  walk(rootDir);
  return { installed: new Set(seen.values()), declaredOptional };
}

const isUnpacked = (name) =>
  asarUnpack.some((pattern) => minimatch(`node_modules/${name}/package.json`, pattern, { dot: true }));

test('every package node-llama-cpp depends on is unpacked beside it', () => {
  const { installed: closure } = dependencyClosure('node-llama-cpp');

  // The walk is only meaningful if it reaches the package the bug was about.
  assert.ok(closure.has('chalk'), 'closure walk should reach chalk');
  assert.ok(closure.size > 50, `closure suspiciously small: ${closure.size}`);

  const missing = [...closure].filter((name) => !isUnpacked(name)).sort();
  assert.deepEqual(
    missing,
    [],
    'node-llama-cpp is ESM and resolves imports from app.asar.unpacked; these dependencies ' +
      'would stay inside app.asar and fail with "Cannot find package". Add ' +
      '"**/node_modules/<name>/**" to build.asarUnpack in package.json:\n  ' + missing.join('\n  '),
  );
});

test('every DECLARED optional dependency is unpacked, including other operating systems\'', () => {
  // The Windows and Linux binaries (@node-llama-cpp/win-x64, @reflink/reflink-win32-x64-msvc, ...)
  // are not installed on a Mac, so the closure above cannot see them. Their names
  // come from the manifests, which list every platform.
  const { declaredOptional } = dependencyClosure('node-llama-cpp');
  assert.ok(declaredOptional.has('@node-llama-cpp/win-x64'), 'manifest walk should see the Windows runtime');
  const missing = [...declaredOptional].filter((name) => !isUnpacked(name)).sort();
  assert.deepEqual(missing, [], 'optional platform packages not covered by asarUnpack:\n  ' + missing.join('\n  '));
});

test('optional platform packages are unpacked by scope, not by this machine\'s name', () => {
  // A literal like "@reflink/reflink-darwin-arm64" would pass on the build host
  // and silently drop the Windows binary. These two families ship one package
  // per OS/arch, so they must be matched by scope.
  assert.ok(asarUnpack.includes('**/node_modules/@node-llama-cpp/**'));
  assert.ok(asarUnpack.includes('**/node_modules/@reflink/**'));
  const hostSpecific = asarUnpack.filter((p) => /(darwin|win32|linux)-(x64|arm64|ia32)/.test(p));
  assert.deepEqual(hostSpecific, [], 'asarUnpack must not name a single OS/arch package');
});
