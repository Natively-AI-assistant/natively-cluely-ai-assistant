// scripts/__tests__/native-link-checks.test.mjs
//
// The audio module must load on every OS the app supports, or the microphone
// and system audio are both gone. scripts/lib/native-link-checks.cjs fails the
// native build when:
//   - macOS: CoreAudio / ScreenCaptureKit are linked strong (the process-tap
//     symbols exist only from macOS 14.2, ScreenCaptureKit only from 12.3);
//   - Windows: the module imports VCRUNTIME140.dll / MSVCP140.dll, which no PC
//     without the Visual C++ Redistributable has.
// Both checks are exercised here on synthetic otool output and synthetic PE
// images, so the Windows branch runs on a macOS host and vice versa.
//
// Run: node --test scripts/__tests__/native-link-checks.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const {
  parseOtoolLoadCommands,
  macWeakLinkProblems,
  macNewerRuntimeImports,
  assertMacWeakLinks,
  peImportedDlls,
  assertNoDynamicVcRuntime,
} = require('../lib/native-link-checks.cjs');

const loadCommand = (cmd, dylib) =>
  `Load command 9\n          cmd ${cmd}\n      cmdsize 88\n         name ${dylib} (offset 24)\n   time stamp 2 Thu Jan  1 01:00:02 1970\n`;
const CA = '/System/Library/Frameworks/CoreAudio.framework/Versions/A/CoreAudio';
const SCK = '/System/Library/Frameworks/ScreenCaptureKit.framework/Versions/A/ScreenCaptureKit';
const FOUNDATION = '/System/Library/Frameworks/Foundation.framework/Versions/C/Foundation';

test('macOS: the module as built before the fix is rejected (both frameworks strong)', () => {
  const out = loadCommand('LC_LOAD_DYLIB', FOUNDATION) + loadCommand('LC_LOAD_DYLIB', CA) + loadCommand('LC_LOAD_DYLIB', SCK);
  const problems = macWeakLinkProblems(out);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /CoreAudio is linked strong/);
  assert.match(problems[1], /ScreenCaptureKit is linked strong/);
});

test('macOS: weak CoreAudio and ScreenCaptureKit pass; other strong links are fine', () => {
  const out = loadCommand('LC_LOAD_DYLIB', FOUNDATION) + loadCommand('LC_LOAD_WEAK_DYLIB', CA) + loadCommand('LC_LOAD_WEAK_DYLIB', SCK);
  assert.deepEqual(parseOtoolLoadCommands(out), { strong: [FOUNDATION], weak: [CA, SCK] });
  assert.deepEqual(macWeakLinkProblems(out), []);
  assert.doesNotThrow(() => assertMacWeakLinks('x.node', { run: () => out }));
});

test('macOS: a framework that vanished from the link is reported, not passed', () => {
  const out = loadCommand('LC_LOAD_WEAK_DYLIB', CA);
  assert.deepEqual(macWeakLinkProblems(out), ['ScreenCaptureKit is not linked at all; expected a weak link']);
  assert.throws(() => assertMacWeakLinks('x.node', { run: () => out }), /would not load on every macOS the app supports/);
});

const MOBILE_DEVICE = '/System/Library/PrivateFrameworks/MobileDevice.framework/Versions/A/MobileDevice';
const okFrameworks = loadCommand('LC_LOAD_WEAK_DYLIB', CA) + loadCommand('LC_LOAD_WEAK_DYLIB', SCK);

test('macOS: a strongly linked private framework is rejected; weak passes', () => {
  const strong = okFrameworks + loadCommand('LC_LOAD_DYLIB', MOBILE_DEVICE);
  assert.deepEqual(macWeakLinkProblems(strong), ['private framework MobileDevice is linked strong; it must be weak (-weak_framework MobileDevice)']);
  assert.deepEqual(macWeakLinkProblems(okFrameworks + loadCommand('LC_LOAD_WEAK_DYLIB', MOBILE_DEVICE)), []);
});

test("macOS: libobjc's macOS 13 register variants (cidre on arm64) are rejected", () => {
  const nm = '_objc_msgSend\n_objc_release_x19\n_objc_retain_x1\n_objc_retain\n_objc_retainAutoreleasedReturnValue\n';
  assert.deepEqual(macNewerRuntimeImports(nm), ['_objc_release_x19', '_objc_retain_x1']);
  const run = (cmd) => (cmd === 'otool' ? okFrameworks : nm);
  assert.throws(() => assertMacWeakLinks('x.node', { run }), /_objc_release_x19, _objc_retain_x1 \(libobjc, macOS 13\+\); enable cidre's classic-objc-retain-release/);
  const classic = (cmd) => (cmd === 'otool' ? okFrameworks : '_objc_retain\n_objc_release\n');
  assert.doesNotThrow(() => assertMacWeakLinks('x.node', { run: classic }));
});

test('macOS: the rebuilt modules pass with the real otool and nm (when present on a Mac)', { skip: process.platform !== 'darwin' }, (t) => {
  const built = ['aarch64-apple-darwin', 'x86_64-apple-darwin']
    .map((triple) => path.join(root, 'native-module', 'target', triple, 'release', 'libnatively_audio.dylib'))
    .filter((f) => fs.existsSync(f));
  if (built.length === 0) return t.skip('no native-module build in target/');
  for (const file of built) assert.doesNotThrow(() => assertMacWeakLinks(file), file);
});

/** A minimal PE32+ image whose import directory names `dlls`. */
function fakePe(dlls) {
  const buf = Buffer.alloc(0x400);
  buf.writeUInt16LE(0x5a4d, 0); // MZ
  buf.writeUInt32LE(0x40, 0x3c); // e_lfanew
  buf.writeUInt32LE(0x00004550, 0x40); // PE\0\0
  buf.writeUInt16LE(0x8664, 0x44); // x64
  buf.writeUInt16LE(1, 0x46); // one section
  buf.writeUInt16LE(240, 0x54); // SizeOfOptionalHeader
  const opt = 0x58;
  buf.writeUInt16LE(0x20b, opt); // PE32+
  buf.writeUInt32LE(16, opt + 108); // NumberOfRvaAndSizes
  buf.writeUInt32LE(0x1000, opt + 112 + 8); // import directory RVA
  buf.writeUInt32LE((dlls.length + 1) * 20, opt + 112 + 12);
  const sec = opt + 240;
  buf.write('.idata', sec, 'latin1');
  buf.writeUInt32LE(0x200, sec + 8); // VirtualSize
  buf.writeUInt32LE(0x1000, sec + 12); // VirtualAddress
  buf.writeUInt32LE(0x200, sec + 16); // SizeOfRawData
  buf.writeUInt32LE(0x200, sec + 20); // PointerToRawData
  let nameOff = 0x200 + (dlls.length + 1) * 20;
  dlls.forEach((dll, i) => {
    buf.writeUInt32LE(0x1000 + (nameOff - 0x200), 0x200 + i * 20 + 12);
    buf.write(`${dll}\0`, nameOff, 'latin1');
    nameOff += dll.length + 1;
  });
  return buf;
}

test('Windows: import names are read from a PE32+ image', () => {
  assert.deepEqual(peImportedDlls(fakePe(['KERNEL32.dll', 'ole32.dll'])), ['KERNEL32.dll', 'ole32.dll']);
  assert.equal(peImportedDlls(Buffer.from('not a pe file at all, just text, long enough to have a header....')), null);
});

test('Windows: a module importing the dynamic VC runtime is rejected', () => {
  const pe = fakePe(['KERNEL32.dll', 'VCRUNTIME140.dll', 'api-ms-win-crt-runtime-l1-1-0.dll']);
  assert.throws(
    () => assertNoDynamicVcRuntime('index.win32-x64-msvc.node', { fsImpl: { readFileSync: () => pe } }),
    /imports VCRUNTIME140\.dll: .*Visual C\+\+ Redistributable/,
  );
  const cpp = fakePe(['MSVCP140.dll', 'vcruntime140_1.dll']);
  assert.throws(() => assertNoDynamicVcRuntime('x.node', { fsImpl: { readFileSync: () => cpp } }), /MSVCP140\.dll, vcruntime140_1\.dll/);
});

test('Windows: every Visual C++ Redistributable DLL is caught, release and debug', () => {
  const runtime = [
    'vcruntime140.dll', 'VCRUNTIME140_1.dll', 'msvcp140.dll', 'msvcp140_2.dll',
    'msvcp140_atomic_wait.dll', 'msvcp140_codecvt_ids.dll', 'concrt140.dll',
    'vccorlib140.dll', 'vcomp140.dll', 'vcruntime140d.dll', 'msvcp140d.dll', 'ucrtbased.dll',
  ];
  for (const dll of runtime) {
    const pe = fakePe(['KERNEL32.dll', dll]);
    assert.throws(() => assertNoDynamicVcRuntime('x.node', { fsImpl: { readFileSync: () => pe } }), new RegExp(dll.replace('.', '\\.')), dll);
  }
  // System DLLs that merely look similar are not the redistributable.
  const system = fakePe(['msvcrt.dll', 'ucrtbase.dll', 'api-ms-win-crt-runtime-l1-1-0.dll', 'VERSION.dll']);
  assert.doesNotThrow(() => assertNoDynamicVcRuntime('x.node', { fsImpl: { readFileSync: () => system } }));
});

test('Windows: a truncated or odd PE is "not a PE image", never a RangeError', () => {
  const full = fakePe(['VCRUNTIME140.dll']);
  for (const len of [0x60, 0x80, 0x150]) {
    assert.equal(peImportedDlls(full.subarray(0, len)), null, `truncated at ${len}`);
  }
  const noImportDir = Buffer.from(full);
  noImportDir.writeUInt32LE(1, 0x58 + 108); // NumberOfRvaAndSizes = 1: no import directory entry
  assert.deepEqual(peImportedDlls(noImportDir), []);
  // An import RVA that lands past the section's raw data maps to nothing,
  // instead of into whatever bytes follow in the file.
  const pastRaw = Buffer.from(full);
  pastRaw.writeUInt32LE(0x1000 + 0x300, 0x58 + 112 + 8);
  pastRaw.writeUInt32LE(0x400, 0x58 + 240 + 8); // VirtualSize larger than SizeOfRawData
  assert.deepEqual(peImportedDlls(pastRaw), []);
});

test('Windows: a statically linked CRT passes (UCRT api sets are part of Windows 10+)', () => {
  const pe = fakePe(['KERNEL32.dll', 'ole32.dll', 'api-ms-win-crt-heap-l1-1-0.dll']);
  assert.doesNotThrow(() => assertNoDynamicVcRuntime('x.node', { fsImpl: { readFileSync: () => pe } }));
});

test('the cargo config carries both fixes and build-native.js runs both checks', () => {
  const config = fs.readFileSync(path.join(root, 'native-module', '.cargo', 'config.toml'), 'utf8');
  for (const triple of ['x86_64-apple-darwin', 'aarch64-apple-darwin']) {
    const section = config.split(`[target.${triple}]`)[1].split('[target.')[0];
    assert.match(section, /"link-arg=-weak_framework", "-C", "link-arg=CoreAudio"/, triple);
    assert.match(section, /"link-arg=-weak_framework", "-C", "link-arg=ScreenCaptureKit"/, triple);
  }
  for (const triple of ['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc', 'i686-pc-windows-msvc']) {
    const section = config.split(`[target.${triple}]`)[1].split('[target.')[0];
    assert.match(section, /target-feature=\+crt-static/, triple);
  }
  const cargo = fs.readFileSync(path.join(root, 'native-module', 'Cargo.toml'), 'utf8');
  assert.match(cargo, /cidre = \{[^}]*"classic-objc-retain-release"/, 'cidre must use the classic retain/release on arm64');
  const build = fs.readFileSync(path.join(root, 'scripts', 'build-native.js'), 'utf8');
  assert.match(build, /checkOrReject\(artifactPath, assertMacWeakLinks\)/);
  assert.match(build, /checkOrReject\(path\.join\(nativeModulePath, artifact\), assertNoDynamicVcRuntime\)/);
});
