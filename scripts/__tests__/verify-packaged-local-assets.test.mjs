// The packaged-app gate must refuse a package that cannot run a GGUF model.
//
// THE GAPS (reproduced 2026-10-09 on fake macOS and Windows packages before any
// fix; the gate exited 0 for every one of them):
//
//   - no GGUF reranker worker under app.asar.unpacked;
//   - no llama.cpp runtime for the target at all, or only another OS's;
//   - a package.json in node-llama-cpp's import closure that is not valid JSON.
//     The walk skipped it silently, so everything BELOW it went unchecked.
//
// What it already caught, and still must: a dependency of node-llama-cpp that
// is absent from the unpacked tree (the "Cannot find package 'chalk'" failure
// that shipped in 2.9.2 on Windows).
//
// Every case builds a complete fake package and then breaks exactly one thing,
// so a failure names its cause. The runtime layout below is written out by hand
// from the published @node-llama-cpp/* 3.20.0 packages, NOT read back from the
// gate, so the two have to agree independently.
//
// Fixture based: no npm, no network. Both platform shapes run from either host.
// A fake tree is not a real package: release-macos.yml and build-smoke.yml run
// this same gate against the artifacts electron-builder actually produced.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as gate from '../verify-packaged-local-assets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', 'verify-packaged-local-assets.mjs');

const GGUF_WORKER = 'dist-electron/electron/rag/ggufRerankerWorker.js';

// node-llama-cpp resolves `bins/<name>/llama-addon.node` and refuses a folder
// with no `_nlcBuildMetadata.json` beside it (resolvePrebuiltBinaryPath). It
// finds the folder by importing the package, hence dist/index.js.
const RUNTIMES = {
  // One .app per arch, both built on one host: each must carry both, the same
  // way the gate already requires both arches of sharp and sqlite-vec.
  darwin: ['mac-arm64-metal', 'mac-x64'],
  // The CPU build. The Vulkan and CUDA packages only work with a matching GPU
  // and driver, so they are no substitute on a fresh PC.
  win32: ['win-x64'],
};
const runtimeFiles = (name) => [
  `node_modules/@node-llama-cpp/${name}/dist/index.js`,
  `node_modules/@node-llama-cpp/${name}/bins/${name}/llama-addon.node`,
];
const runtimeMetadata = (name) => `node_modules/@node-llama-cpp/${name}/bins/${name}/_nlcBuildMetadata.json`;
const runtimeManifest = (name) => `node_modules/@node-llama-cpp/${name}/package.json`;

function put(root, rel, body = 'x') {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

function putRuntime(unpacked, name) {
  for (const rel of runtimeFiles(name)) put(unpacked, rel);
  put(unpacked, runtimeMetadata(name), '{"buildOptions":{}}');
  put(unpacked, runtimeManifest(name), JSON.stringify({ name: `@node-llama-cpp/${name}`, version: '3.20.0' }));
}

/** A fake package that satisfies every requirement, for `platform`. */
function completePackage(t, platform) {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-package-gate-'));
  t.after(() => fs.rmSync(top, { recursive: true, force: true }));
  const app = platform === 'darwin' ? path.join(top, 'X.app') : path.join(top, 'win-unpacked');
  const resources = platform === 'darwin' ? path.join(app, 'Contents', 'Resources') : path.join(app, 'resources');
  const unpacked = path.join(resources, 'app.asar.unpacked');

  for (const rel of gate.REQUIRED_MODEL_FILES) put(path.join(resources, 'models'), rel);
  for (const dir of gate.REQUIRED_PACKAGE_DIRS) put(unpacked, `${dir}/package.json`, '{}');
  const native = platform === 'darwin'
    ? gate.REQUIRED_UNPACKED_NATIVE_DARWIN
    : [...gate.REQUIRED_UNPACKED_NATIVE_WIN32, ...gate.REQUIRED_UNPACKED_NATIVE_WIN32_ANY.map((any) => any[0])];
  for (const rel of [...gate.REQUIRED_UNPACKED_NATIVE_COMMON, ...native]) put(unpacked, rel);
  for (const rel of gate.REQUIRED_WORKER_FILES) put(unpacked, rel);
  put(unpacked, GGUF_WORKER);
  if (platform === 'darwin') {
    fs.chmodSync(put(resources, `apple-speech/${gate.APPLE_SPEECH_HELPER}`), 0o755);
  }

  // node-llama-cpp -> chalk -> ansi-x, plus an optional package for another OS
  // that is legitimately not installed.
  put(unpacked, 'node_modules/node-llama-cpp/package.json', JSON.stringify({
    name: 'node-llama-cpp',
    version: '3.20.0',
    dependencies: { chalk: '*' },
    optionalDependencies: { '@node-llama-cpp/linux-x64': '*' },
  }));
  put(unpacked, 'node_modules/chalk/package.json', JSON.stringify({ name: 'chalk', dependencies: { 'ansi-x': '*' } }));
  put(unpacked, 'node_modules/ansi-x/package.json', JSON.stringify({ name: 'ansi-x' }));
  for (const name of RUNTIMES[platform]) putRuntime(unpacked, name);

  return { app, unpacked };
}

function runGate(app, platform) {
  const result = spawnSync(process.execPath, [SCRIPT, '--app', app, '--platform', platform], { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const remove = (unpacked, rel) => fs.rmSync(path.join(unpacked, ...rel.split('/')), { recursive: true, force: true });

for (const platform of ['darwin', 'win32']) {
  const [firstRuntime] = RUNTIMES[platform];

  test(`${platform}: a complete package passes`, (t) => {
    const { app } = completePackage(t, platform);
    const { status, output } = runGate(app, platform);
    assert.equal(status, 0, output);
  });

  test(`${platform}: a package with no GGUF reranker worker is refused`, (t) => {
    const { app, unpacked } = completePackage(t, platform);
    remove(unpacked, GGUF_WORKER);
    const { status, output } = runGate(app, platform);
    assert.equal(status, 1, output);
    assert.match(output, /ggufRerankerWorker\.js/);
  });

  test(`${platform}: a package with no llama.cpp runtime is refused`, (t) => {
    const { app, unpacked } = completePackage(t, platform);
    remove(unpacked, 'node_modules/@node-llama-cpp');
    const { status, output } = runGate(app, platform);
    assert.equal(status, 1, output);
    assert.match(output, new RegExp(`@node-llama-cpp/${firstRuntime}`));
  });

  test(`${platform}: another operating system's runtime does not count`, (t) => {
    const { app, unpacked } = completePackage(t, platform);
    remove(unpacked, 'node_modules/@node-llama-cpp');
    for (const name of RUNTIMES[platform === 'darwin' ? 'win32' : 'darwin']) putRuntime(unpacked, name);
    const { status, output } = runGate(app, platform);
    assert.equal(status, 1, output);
    assert.match(output, new RegExp(`@node-llama-cpp/${firstRuntime}`));
  });

  test(`${platform}: a runtime folder without its binary is refused`, (t) => {
    const { app, unpacked } = completePackage(t, platform);
    remove(unpacked, `node_modules/@node-llama-cpp/${firstRuntime}/bins/${firstRuntime}/llama-addon.node`);
    const { status, output } = runGate(app, platform);
    assert.equal(status, 1, output);
    assert.match(output, /llama-addon\.node/);
  });

  test(`${platform}: an empty runtime binary is refused`, (t) => {
    const { app, unpacked } = completePackage(t, platform);
    put(unpacked, `node_modules/@node-llama-cpp/${firstRuntime}/bins/${firstRuntime}/llama-addon.node`, '');
    const { status, output } = runGate(app, platform);
    assert.equal(status, 1, output);
    assert.match(output, /llama-addon\.node/);
  });

  for (const [label, body] of [['missing', null], ['unreadable', '{bad']]) {
    test(`${platform}: a runtime whose build metadata is ${label} is refused`, (t) => {
      // node-llama-cpp treats a folder without readable metadata as "no
      // prebuilt binary", and with build:'never' there is nothing to fall back to.
      const { app, unpacked } = completePackage(t, platform);
      if (body === null) remove(unpacked, runtimeMetadata(firstRuntime));
      else put(unpacked, runtimeMetadata(firstRuntime), body);
      const { status, output } = runGate(app, platform);
      assert.equal(status, 1, output);
      assert.match(output, /_nlcBuildMetadata\.json/);
    });
  }

  test(`${platform}: a runtime package with an unreadable manifest is refused`, (t) => {
    const { app, unpacked } = completePackage(t, platform);
    put(unpacked, runtimeManifest(firstRuntime), '{bad');
    const { status, output } = runGate(app, platform);
    assert.equal(status, 1, output);
    assert.match(output, new RegExp(`@node-llama-cpp/${firstRuntime}`));
  });

  test(`${platform}: an unreadable node-llama-cpp manifest is refused, not skipped`, (t) => {
    const { app, unpacked } = completePackage(t, platform);
    put(unpacked, 'node_modules/node-llama-cpp/package.json', '{bad');
    const { status, output } = runGate(app, platform);
    assert.equal(status, 1, output);
    assert.match(output, /node-llama-cpp.*package\.json/);
  });

  test(`${platform}: an unreadable manifest deeper in the closure is refused, not skipped`, (t) => {
    // The old walk returned early here, so chalk's own missing dependency was
    // never looked for either.
    const { app, unpacked } = completePackage(t, platform);
    put(unpacked, 'node_modules/chalk/package.json', '{bad');
    remove(unpacked, 'node_modules/ansi-x');
    const { status, output } = runGate(app, platform);
    assert.equal(status, 1, output);
    assert.match(output, /chalk.*package\.json/);
  });

  test(`${platform}: a manifest that is JSON but not an object is refused`, (t) => {
    const { app, unpacked } = completePackage(t, platform);
    put(unpacked, 'node_modules/chalk/package.json', 'null');
    const { status, output } = runGate(app, platform);
    assert.equal(status, 1, output);
    assert.match(output, /chalk.*package\.json/);
  });

  test(`${platform}: a missing dependency of node-llama-cpp is still refused`, (t) => {
    const { app, unpacked } = completePackage(t, platform);
    remove(unpacked, 'node_modules/ansi-x');
    const { status, output } = runGate(app, platform);
    assert.equal(status, 1, output);
    assert.match(output, /ansi-x \(needed by chalk\)/);
  });
}

test('darwin: one arch\'s runtime alone is refused, naming the missing one', (t) => {
  // The shape an Apple-Silicon build host produces on its own: npm installs
  // mac-arm64-metal there and never mac-x64, so the Intel app has no runtime.
  const { app, unpacked } = completePackage(t, 'darwin');
  remove(unpacked, 'node_modules/@node-llama-cpp/mac-x64');
  const { status, output } = runGate(app, 'darwin');
  assert.equal(status, 1, output);
  assert.match(output, /@node-llama-cpp\/mac-x64/);
  assert.doesNotMatch(output, /@node-llama-cpp\/mac-arm64-metal/);
});

test('win32: a GPU-only runtime is refused, because a PC without that GPU has nothing to load', (t) => {
  const { app, unpacked } = completePackage(t, 'win32');
  remove(unpacked, 'node_modules/@node-llama-cpp/win-x64');
  putRuntime(unpacked, 'win-x64-vulkan');
  const { status, output } = runGate(app, 'win32');
  assert.equal(status, 1, output);
  assert.match(output, /@node-llama-cpp\/win-x64\b/);
});

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: a runtime of another version than node-llama-cpp is refused`, (t) => {
    // node-llama-cpp will not load it, so a complete runtime left over from
    // another version is the same as no runtime: every GGUF model fails.
    const { app, unpacked } = completePackage(t, platform);
    const [name] = RUNTIMES[platform];
    put(unpacked, runtimeManifest(name), JSON.stringify({ name: `@node-llama-cpp/${name}`, version: '3.19.0' }));
    const { status, output } = runGate(app, platform);
    assert.equal(status, 1, output);
    assert.match(output, new RegExp(`@node-llama-cpp/${name} is version 3\\.19\\.0, but node-llama-cpp is 3\\.20\\.0`));
  });
}

test('the runtime check names an unsupported platform instead of guessing', () => {
  assert.equal(typeof gate.llamaRuntimeProblems, 'function', 'the gate should export llamaRuntimeProblems');
  assert.throws(() => gate.llamaRuntimeProblems(os.tmpdir(), 'linux'), /Unsupported platform: linux/);
});

test('the gate still runs when the checkout is reached through a link', (t) => {
  // Importable for these tests means "does nothing unless run directly". A
  // wrong answer to "was I run directly" would make the build gate print
  // nothing and exit 0, which is the one failure a gate may not have. Node
  // resolves the entry script's real path but leaves argv[1] as typed, so a
  // linked checkout is where the two disagree.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-package-gate-link-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const link = path.join(dir, 'checkout');
  try {
    // 'junction' needs no privilege on Windows and is ignored elsewhere.
    fs.symlinkSync(path.resolve(__dirname, '..', '..'), link, 'junction');
  } catch (error) {
    t.skip(`cannot create a directory link here: ${error.code}`);
    return;
  }
  const result = spawnSync(
    process.execPath,
    [path.join(link, 'scripts', 'verify-packaged-local-assets.mjs')],
    { encoding: 'utf8' },
  );
  assert.match(result.stdout, /\[verify-packaged-local-assets\] source mode/, 'the gate must run, not exit silently');
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('source mode: this repository still unpacks everything the GGUF path needs', () => {
  // The repo-tree half of the gate, which `npm run app:build` runs before
  // packaging on both operating systems.
  for (const glob of ['**/ggufRerankerWorker.js', '**/node_modules/node-llama-cpp/**', '**/node_modules/@node-llama-cpp/**']) {
    assert.ok(gate.REQUIRED_ASARUNPACK_GLOBS?.includes(glob), `the gate should require the asarUnpack glob ${glob}`);
  }
  assert.ok(gate.REQUIRED_PACKAGE_DIRS.includes('node_modules/node-llama-cpp'));
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
