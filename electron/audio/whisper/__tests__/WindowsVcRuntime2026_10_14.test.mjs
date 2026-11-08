// electron/audio/whisper/__tests__/WindowsVcRuntime2026_10_14.test.mjs
//
// onnxruntime-node's Windows binaries import MSVCP140.dll, MSVCP140_1.dll,
// VCRUNTIME140.dll and VCRUNTIME140_1.dll (read from their import tables).
// On a PC without the Visual C++ Redistributable the binding fails to load and
// every local model fails with "The specified module could not be found".
//
// This probe is what lets the app say "install the Visual C++ runtime" only
// when that is true. Platform, directories and the file check are injected, so
// the Windows branch and the non-Windows branch both run here, on any OS.
// Not executed on a real Windows machine.
//
// Run: npm run build:electron && node --test electron/audio/whisper/__tests__/WindowsVcRuntime2026_10_14.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { listMissingVcRuntimeDlls, VC_RUNTIME_DLLS, VC_REDIST_DOWNLOAD_URL } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../../dist-electron/electron/audio/whisper/windowsVcRuntime.js')).href
);

const SYSTEM32 = 'C:\\Windows\\System32';
const BINDING = 'C:\\Program Files\\Natively\\resources\\app.asar.unpacked\\node_modules\\onnxruntime-node\\bin\\napi-v6\\win32\\x64';
const has = (...files) => (file) => files.includes(file);
const inDir = (dir, dlls = VC_RUNTIME_DLLS) => dlls.map((d) => `${dir}\\${d}`);

test('the four DLLs are exactly what the bundled binaries import', () => {
  assert.deepEqual([...VC_RUNTIME_DLLS].sort(), ['MSVCP140.dll', 'MSVCP140_1.dll', 'VCRUNTIME140.dll', 'VCRUNTIME140_1.dll']);
  assert.match(VC_REDIST_DOWNLOAD_URL, /^https:\/\/aka\.ms\/vs\/17\/release\/vc_redist\.x64\.exe$/);
});

test('macOS: nothing is ever reported missing', () => {
  assert.deepEqual(listMissingVcRuntimeDlls({ platform: 'darwin', systemRoot: 'C:\\Windows', exists: () => false }), []);
  assert.deepEqual(listMissingVcRuntimeDlls({ platform: 'linux', exists: () => false }), []);
});

test('Windows, redistributable installed: found in System32', () => {
  assert.deepEqual(
    listMissingVcRuntimeDlls({ platform: 'win32', systemRoot: 'C:\\Windows', exists: has(...inDir(SYSTEM32)) }),
    [],
  );
});

test('Windows, brand new PC: all four are missing', () => {
  assert.deepEqual(
    listMissingVcRuntimeDlls({ platform: 'win32', systemRoot: 'C:\\Windows', extraDirs: [BINDING], exists: () => false }),
    [...VC_RUNTIME_DLLS],
  );
});

test('Windows, packaged app: the copies next to the binding count', () => {
  assert.deepEqual(
    listMissingVcRuntimeDlls({ platform: 'win32', systemRoot: 'C:\\Windows', extraDirs: [BINDING], exists: has(...inDir(BINDING)) }),
    [],
  );
});

test('Windows, older redistributable: only the DLL it lacks is reported', () => {
  const present = inDir(SYSTEM32, ['MSVCP140.dll', 'VCRUNTIME140.dll']);
  assert.deepEqual(
    listMissingVcRuntimeDlls({ platform: 'win32', systemRoot: 'C:\\Windows', exists: has(...present) }),
    ['MSVCP140_1.dll', 'VCRUNTIME140_1.dll'],
  );
});

test('Windows with nowhere to look claims nothing', () => {
  // No evidence either way must never become "install the runtime".
  const saved = { SystemRoot: process.env.SystemRoot, windir: process.env.windir };
  delete process.env.SystemRoot; delete process.env.windir;
  try {
    assert.deepEqual(listMissingVcRuntimeDlls({ platform: 'win32', exists: () => false }), []);
  } finally {
    if (saved.SystemRoot !== undefined) process.env.SystemRoot = saved.SystemRoot;
    if (saved.windir !== undefined) process.env.windir = saved.windir;
  }
});
