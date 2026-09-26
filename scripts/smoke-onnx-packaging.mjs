#!/usr/bin/env node
// scripts/smoke-onnx-packaging.mjs
//
// PHASE-2B: smoke-test that the ONNX runtime dependencies resolve correctly
// from a packaged-app perspective. This catches regressions where a build
// pass strips a transitive dep (e.g. onnxruntime-common was hoisted under
// onnxruntime-node/, and a packaging step that filters by direct deps
// would remove it — leaving @huggingface/transformers unable to load).
//
// Run from repo root:   node scripts/smoke-onnx-packaging.mjs
//
// What it asserts:
//   1. onnxruntime-common is reachable from require.resolve()
//   2. onnxruntime-node is reachable
//   3. @huggingface/transformers is reachable
//   4. The onnxruntime-common version matches onnxruntime-node's declared
//      dependency range (they MUST be the same major.minor to avoid ABI drift)
//   5. Each package's main file exists on disk
//
// Exits non-zero on any failure. Used by the release gate (CI).
//
// Intentionally does NOT try to load the native binding — we only check that
// the JS resolver can find the deps. Loading the native binding requires
// electron-rebuild + correct ABI; that's covered by the existing
// scripts/verify-native-arch.js check.

import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(url.pathToFileURL(path.join(repoRoot, 'package.json')).href);

const failures = [];

function check(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (e) {
    failures.push({ label, error: e });
    console.error(`  ✗ ${label}: ${e?.message || e}`);
  }
}

function resolveOrThrow(pkgName) {
  // resolve from the package.json context so the test fails the same way
  // a packaged app would (Node's module resolution from the app root).
  return require.resolve(pkgName, { paths: [repoRoot] });
}

function readPkg(pkgPath) {
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
}

console.log(`[smoke-onnx-packaging] repoRoot=${repoRoot}`);

let onnxCommonPath, onnxNodePath, transformersPath;

check('onnxruntime-common resolves via require.resolve', () => {
  onnxCommonPath = resolveOrThrow('onnxruntime-common');
  if (!fs.existsSync(onnxCommonPath)) {
    throw new Error(`onnxruntime-common resolved to ${onnxCommonPath} but file does not exist`);
  }
});

check('onnxruntime-node resolves via require.resolve', () => {
  onnxNodePath = resolveOrThrow('onnxruntime-node');
  if (!fs.existsSync(onnxNodePath)) {
    throw new Error(`onnxruntime-node resolved to ${onnxNodePath} but file does not exist`);
  }
});

check('@huggingface/transformers resolves via require.resolve', () => {
  transformersPath = resolveOrThrow('@huggingface/transformers');
  if (!fs.existsSync(transformersPath)) {
    throw new Error(`@huggingface/transformers resolved to ${transformersPath} but file does not exist`);
  }
});

check('onnxruntime-common is a DIRECT dependency in package.json', () => {
  const pkg = readPkg(path.join(repoRoot, 'package.json'));
  const declared = pkg.dependencies?.['onnxruntime-common'];
  if (!declared) {
    throw new Error('onnxruntime-common is NOT in package.json#dependencies — risk: packaging passes that filter by direct deps will strip it, and @huggingface/transformers will fail with "Cannot find package onnxruntime-common"');
  }
  console.log(`    declared = ${declared}`);
});

check('onnxruntime-node is a direct dependency in package.json', () => {
  const pkg = readPkg(path.join(repoRoot, 'package.json'));
  const declared = pkg.dependencies?.['onnxruntime-node'];
  if (!declared) {
    throw new Error('onnxruntime-node is NOT in package.json#dependencies');
  }
  console.log(`    declared = ${declared}`);
});

check('onnxruntime-common version matches onnxruntime-node declared peer', () => {
  if (!onnxCommonPath || !onnxNodePath) {
    throw new Error('resolve step failed earlier; skipping version cross-check');
  }
  // require.resolve returns the package's MAIN entry (e.g. dist/cjs/index.js),
  // and subpaths can have their own package.json (ESM vs CJS), so walk up
  // until we find a package.json whose "name" matches the package we want.
  function findPkgJson(start, expectedName) {
    let dir = path.dirname(start);
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, 'package.json');
      if (fs.existsSync(candidate)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
          if (parsed.name === expectedName) return candidate;
        } catch { /* keep walking */ }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(`Could not find package.json for "${expectedName}" starting from ${start}`);
  }
  const commonPkg = readPkg(findPkgJson(onnxCommonPath, 'onnxruntime-common'));
  const nodePkg = readPkg(findPkgJson(onnxNodePath, 'onnxruntime-node'));
  const wanted = nodePkg.dependencies?.['onnxruntime-common'];
  if (!wanted) {
    throw new Error(`onnxruntime-node@${nodePkg.version} does not declare onnxruntime-common as a dep — would cause ABI mismatch`);
  }
  console.log(`    onnxruntime-node@${nodePkg.version} declares onnxruntime-common@${wanted}; installed onnxruntime-common@${commonPkg.version}`);
  // Loose equality (npm ranges may include ^ or ~).
  const wantedCore = wanted.replace(/^[\^~]/, '').split('.').slice(0, 2).join('.');
  const installedCore = commonPkg.version.split('.').slice(0, 2).join('.');
  if (wantedCore !== installedCore) {
    throw new Error(`major.minor mismatch: installed ${commonPkg.version} vs wanted ${wanted}`);
  }
});

check('asarUnpack includes onnxruntime-{node,common,web}, @huggingface/transformers', () => {
  const pkg = readPkg(path.join(repoRoot, 'package.json'));
  const unpack = pkg.build?.asarUnpack ?? [];
  const required = [
    'onnxruntime-node',
    'onnxruntime-common',
    'onnxruntime-web',
    '@huggingface/transformers',
  ];
  const missing = required.filter((needle) => !unpack.some((p) => p.includes(needle)));
  if (missing.length) {
    throw new Error(`asarUnpack is missing required globs: ${missing.join(', ')}`);
  }
});

console.log('');
if (failures.length) {
  console.error(`[smoke-onnx-packaging] FAILED (${failures.length} check${failures.length === 1 ? '' : 's'})`);
  for (const f of failures) {
    console.error(`  - ${f.label}: ${f.error?.message || f.error}`);
  }
  process.exit(1);
}
console.log('[smoke-onnx-packaging] OK — ONNX runtime deps resolve from packaged-app context');
