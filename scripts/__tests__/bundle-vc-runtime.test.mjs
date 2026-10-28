// scripts/__tests__/bundle-vc-runtime.test.mjs
//
// onnxruntime-node's Windows binaries need four Visual C++ runtime DLLs that
// nothing in the package provided. scripts/bundle-vc-runtime.cjs copies them
// next to the binding during afterPack so local models load on a PC that has
// never had the Visual C++ Redistributable installed.
//
// The step is exercised here with a fake packaged app and fake PE files, for a
// Windows target built on a Windows host, a Windows target built on macOS, and
// a macOS target. It has NOT run on a real Windows build host.
//
// Run: node --test scripts/__tests__/bundle-vc-runtime.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { bundleVcRuntimeForAfterPack, readPeMachine, onnxBindingDir, llamaRuntimeBinDirs, VC_RUNTIME_DLLS } = require('../bundle-vc-runtime.cjs');
const { runAfterPack } = require('../after-pack.cjs');

const X64 = 0x8664;
const IA32 = 0x014c;

/** A minimal file with a valid DOS + PE header for `machine`. */
function writePe(file, machine) {
  const buf = Buffer.alloc(0x80);
  buf.writeUInt16LE(0x5a4d, 0);        // "MZ"
  buf.writeUInt32LE(0x40, 0x3c);       // e_lfanew
  buf.writeUInt32LE(0x00004550, 0x40); // "PE\0\0"
  buf.writeUInt16LE(machine, 0x44);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}

function fixture({ machine = X64, dlls = VC_RUNTIME_DLLS } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vc runtime bundle-')); // space in the path on purpose
  const appOutDir = path.join(root, 'win-unpacked');
  const target = onnxBindingDir(appOutDir, 'x64');
  fs.mkdirSync(target, { recursive: true });
  const source = path.join(root, 'redist');
  for (const dll of dlls) writePe(path.join(source, dll), machine);
  return { root, appOutDir, target, source };
}
const quiet = () => { const lines = []; return { lines, log: (m) => lines.push(m), warn: (m) => lines.push(m) }; };
const WIN_TARGET = (appOutDir) => ({ electronPlatformName: 'win32', arch: 1, appOutDir });

test('reads the machine type out of a PE header, and rejects non-PE files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-'));
  writePe(path.join(dir, 'x64.dll'), X64);
  writePe(path.join(dir, 'x86.dll'), IA32);
  fs.writeFileSync(path.join(dir, 'text.dll'), 'not a dll');
  assert.equal(readPeMachine(path.join(dir, 'x64.dll')), X64);
  assert.equal(readPeMachine(path.join(dir, 'x86.dll')), IA32);
  assert.equal(readPeMachine(path.join(dir, 'text.dll')), null);
  assert.equal(readPeMachine(path.join(dir, 'missing.dll')), null);
});

test('Windows target on a Windows host: the four DLLs land next to the binding', async () => {
  const f = fixture();
  const log = quiet();
  const r = await bundleVcRuntimeForAfterPack(WIN_TARGET(f.appOutDir), {
    env: { NATIVELY_VC_RUNTIME_DIR: f.source }, hostPlatform: 'win32', log,
  });
  assert.deepEqual([...r.bundled].sort(), [...VC_RUNTIME_DLLS].sort());
  for (const dll of VC_RUNTIME_DLLS) {
    assert.equal(readPeMachine(path.join(f.target, dll)), X64, `${dll} must be in the binding's own folder`);
  }
});

// node-llama-cpp's Windows runtimes (llama-addon.node, llama.dll, ggml*.dll)
// import the same DLLs and are tested in a child process where onnxruntime's
// copies are not loaded: each bins/<name>/ folder gets its own.
test('the DLLs also land beside every node-llama-cpp runtime of the target arch', async () => {
  const f = fixture();
  const scope = path.join(f.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', '@node-llama-cpp');
  const bin = (pkg, name, file = 'llama-addon.node') => {
    const dir = path.join(scope, pkg, 'bins', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), 'x');
    return dir;
  };
  const cpu = bin('win-x64', 'win-x64');
  // node-llama-cpp ships three of the four itself; those stay as shipped.
  fs.writeFileSync(path.join(cpu, 'vcruntime140.dll'), 'SHIPPED');
  const vulkan = bin('win-x64-vulkan', 'win-x64-vulkan');
  const cuda = bin('win-x64-cuda', 'win-x64-cuda', 'ggml-cuda.dll');
  const arm = bin('win-arm64', 'win-arm64');
  const mac = bin('mac-x64', 'mac-x64');
  fs.mkdirSync(path.join(scope, 'win-x64', 'bins', 'empty'), { recursive: true });
  assert.deepEqual(llamaRuntimeBinDirs(f.appOutDir, 'x64').sort(), [cpu, cuda, vulkan].sort());

  const r = await bundleVcRuntimeForAfterPack(WIN_TARGET(f.appOutDir), {
    env: { NATIVELY_VC_RUNTIME_DIR: f.source }, hostPlatform: 'win32', log: quiet(),
  });
  assert.deepEqual([...r.targetDirs].sort(), [f.target, cpu, cuda, vulkan].sort());
  for (const dir of [f.target, cpu, vulkan, cuda]) {
    for (const dll of VC_RUNTIME_DLLS) {
      if (dir === cpu && dll === 'vcruntime140.dll') continue;
      assert.equal(readPeMachine(path.join(dir, dll)), X64, `${dll} in ${dir}`);
    }
  }
  assert.equal(fs.readFileSync(path.join(cpu, 'vcruntime140.dll'), 'utf8'), 'SHIPPED', "the package's own copy is never overwritten");
  for (const dir of [arm, mac]) {
    assert.equal(fs.readdirSync(dir).some((n) => /^(msvcp|vcruntime)/i.test(n)), false, `nothing copied into ${dir}`);
  }
});

test('a package with only llama.cpp runtimes still gets them (no onnxruntime folder)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-llama-only-'));
  const appOutDir = path.join(root, 'win-unpacked');
  const dir = path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', '@node-llama-cpp', 'win-x64', 'bins', 'win-x64');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'llama-addon.node'), 'x');
  const source = path.join(root, 'redist');
  for (const dll of VC_RUNTIME_DLLS) writePe(path.join(source, dll), X64);
  const r = await bundleVcRuntimeForAfterPack(WIN_TARGET(appOutDir), { env: { NATIVELY_VC_RUNTIME_DIR: source }, hostPlatform: 'win32', log: quiet() });
  assert.deepEqual(r.targetDirs, [dir]);
});

test('Windows host, System32 is the fallback source', async () => {
  const f = fixture();
  const systemRoot = path.join(f.root, 'Windows');
  for (const dll of VC_RUNTIME_DLLS) writePe(path.join(systemRoot, 'System32', dll), X64);
  const r = await bundleVcRuntimeForAfterPack(WIN_TARGET(f.appOutDir), {
    env: { SystemRoot: systemRoot }, hostPlatform: 'win32', log: quiet(),
  });
  assert.equal(r.bundled.length, 4);
});

test('wrong-architecture DLLs are never shipped', async () => {
  // A 32-bit host process sees the 32-bit copies under "System32".
  const f = fixture({ machine: IA32 });
  await assert.rejects(
    bundleVcRuntimeForAfterPack(WIN_TARGET(f.appOutDir), { env: { NATIVELY_VC_RUNTIME_DIR: f.source }, hostPlatform: 'win32', log: quiet() }),
    /Visual C\+\+ runtime DLLs not found for x64/,
  );
  assert.deepEqual(fs.readdirSync(f.target), [], 'nothing of the wrong architecture was copied');
});

test('Windows host with a DLL missing: the build fails, naming it and how to fix it', async () => {
  const f = fixture({ dlls: ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'] });
  await assert.rejects(
    bundleVcRuntimeForAfterPack(WIN_TARGET(f.appOutDir), { env: { NATIVELY_VC_RUNTIME_DIR: f.source }, hostPlatform: 'win32', log: quiet() }),
    (err) => /msvcp140_1\.dll/.test(err.message) && /NATIVELY_VC_RUNTIME_DIR/.test(err.message),
  );
});

test('Windows target cross-built on macOS: warns loudly and lets the build continue', async () => {
  const f = fixture();
  const log = quiet();
  const r = await bundleVcRuntimeForAfterPack(WIN_TARGET(f.appOutDir), { env: {}, hostPlatform: 'darwin', log });
  assert.equal(r.skipped, 'runtime not available on this host');
  assert.equal(r.missing.length, 4);
  assert.match(log.lines.join('\n'), /WARNING[\s\S]*will NOT run local models/);
  assert.deepEqual(fs.readdirSync(f.target), []);
});

test('...and bundles them on macOS too when a source folder is supplied', async () => {
  const f = fixture();
  const r = await bundleVcRuntimeForAfterPack(WIN_TARGET(f.appOutDir), {
    env: { NATIVELY_VC_RUNTIME_DIR: f.source }, hostPlatform: 'darwin', log: quiet(),
  });
  assert.equal(r.bundled.length, 4);
});

test('macOS target: the step does nothing at all', async () => {
  const f = fixture();
  const r = await bundleVcRuntimeForAfterPack(
    { electronPlatformName: 'darwin', arch: 3, appOutDir: f.appOutDir },
    { env: { NATIVELY_VC_RUNTIME_DIR: f.source }, hostPlatform: 'darwin', log: quiet() },
  );
  assert.equal(r.skipped, 'not a Windows target');
  assert.deepEqual(fs.readdirSync(f.target), []);
});

test('a package with no binding directory is left to the asset verifier', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-nobinding-'));
  const r = await bundleVcRuntimeForAfterPack(WIN_TARGET(path.join(root, 'win-unpacked')), { env: {}, hostPlatform: 'win32', log: quiet() });
  assert.equal(r.skipped, 'no binding directory');
});

test('the composite afterPack hook runs it between the helper build and signing', async () => {
  const events = [];
  const context = { arch: 1, electronPlatformName: 'win32' };
  await runAfterPack(context, {
    buildHelper: async () => { events.push('build'); },
    buildParakeetAne: async () => { events.push('parakeet-ane'); },
    bundleVcRuntime: async (received) => { assert.equal(received, context); events.push('vc-runtime'); },
    signApp: async () => { events.push('sign'); },
  });
  assert.deepEqual(events, ['build', 'parakeet-ane', 'vc-runtime', 'sign'], 'nothing may be added to the app after it is signed');
});

test('the packaged-asset verifier requires the four DLLs on Windows', () => {
  const src = fs.readFileSync(new URL('../verify-packaged-local-assets.mjs', import.meta.url), 'utf8');
  const win = src.slice(src.indexOf('const REQUIRED_UNPACKED_NATIVE_WIN32 = ['), src.indexOf('const REQUIRED_UNPACKED_NATIVE_WIN32_ANY'));
  for (const dll of VC_RUNTIME_DLLS) {
    assert.ok(win.includes(`node_modules/onnxruntime-node/bin/napi-v6/win32/x64/${dll}`), dll);
  }
  const mac = src.slice(src.indexOf('const REQUIRED_UNPACKED_NATIVE_DARWIN = ['), src.indexOf('const REQUIRED_UNPACKED_NATIVE_WIN32 = ['));
  assert.doesNotMatch(mac, /msvcp140|vcruntime140/, 'a macOS package must not be asked for Windows DLLs');
});
