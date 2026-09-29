// PE machine-type probe — the Windows half of the native-arch guard.
//
// Why this exists: `verifyAll` used to return `{ skipped: true }` on anything
// that wasn't darwin. A Windows rebuild that loses `/p:Platform=x64` emits a
// 32-bit DLL, Electron then fails with "is not a valid Win32 application"
// (ERROR_BAD_EXE_FORMAT), and the guard whose entire job is to catch a
// wrong-arch addon reported success. Observed in the wild with BOTH
// better_sqlite3.node and keytar.node at PE machine 0x014c.
//
// Every case below builds a synthetic PE header in a temp file, so the whole
// suite runs identically on macOS and Windows — the container format is a
// property of the FILE, not of the host reading it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { pePlatformArch, binaryArch, verifyAll, buildFixCommand } from '../nativeArch.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-arch-pe-'));

/**
 * Write a minimal but structurally valid PE image with the given machine type.
 * Only the fields the probe walks need to be real.
 */
function writePe(name, machine, { peOffset = 0x80, truncateAt = null, dosSig = 'MZ', peSig = 'PE\0\0' } = {}) {
  const buf = Buffer.alloc(peOffset + 24);
  buf.write(dosSig, 0, 'latin1');
  buf.writeInt32LE(peOffset, 0x3c);
  buf.write(peSig, peOffset, 'latin1');
  buf.writeUInt16LE(machine, peOffset + 4);

  const file = path.join(tmp, name);
  fs.writeFileSync(file, truncateAt === null ? buf : buf.subarray(0, truncateAt));
  return file;
}

test('recognises the three architectures Electron ships', () => {
  assert.equal(pePlatformArch(writePe('x64.node', 0x8664)), 'x64');
  assert.equal(pePlatformArch(writePe('arm64.node', 0xaa64)), 'arm64');
  // 0x014c is the value that caused the real failure — a 32-bit build.
  assert.equal(pePlatformArch(writePe('x86.node', 0x014c)), 'ia32');
});

test('an unrecognised machine type is reported, not guessed', () => {
  const result = pePlatformArch(writePe('itanium.node', 0x0200));
  assert.match(result, /^unknown \(PE machine 0x0200\)$/);
});

test('malformed images fail open rather than asserting a wrong arch', () => {
  // Fail-open matters: a probe that cannot classify a file must not block
  // every app launch with a native-arch dialog. Same policy as the Mach-O side.
  assert.match(pePlatformArch(writePe('notpe.node', 0x8664, { dosSig: 'ZZ' })), /missing MZ signature/);
  assert.match(pePlatformArch(writePe('badsig.node', 0x8664, { peSig: 'XX\0\0' })), /missing PE signature/);
  assert.match(pePlatformArch(writePe('short.node', 0x8664, { truncateAt: 0x10 })), /truncated DOS header/);
  assert.match(pePlatformArch(writePe('cut.node', 0x8664, { truncateAt: 0x82 })), /truncated PE header/);
  assert.match(pePlatformArch(path.join(tmp, 'does-not-exist.node')), /^unknown \(/);
});

test('a negative PE offset is rejected instead of throwing', () => {
  const file = path.join(tmp, 'negoffset.node');
  const buf = Buffer.alloc(0x100);
  buf.write('MZ', 0, 'latin1');
  buf.writeInt32LE(-1, 0x3c);
  fs.writeFileSync(file, buf);

  assert.match(pePlatformArch(file), /bad PE offset -1/);
});

test('binaryArch dispatches on the injected platform, not the host', () => {
  const file = writePe('dispatch.node', 0x014c);

  // Explicit win32 must use the PE reader on any host.
  assert.equal(binaryArch(file, 'win32'), 'ia32');
});

// ---------------------------------------------------------------------------
// verifyAll — the behavior that actually regressed.
// ---------------------------------------------------------------------------

/** Lay out a fake repo root containing both TARGETS at a given machine type. */
function fakeRepo(name, machine) {
  const root = path.join(tmp, name);
  for (const rel of [
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    'node_modules/keytar/build/Release/keytar.node',
  ]) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const buf = Buffer.alloc(0x100);
    buf.write('MZ', 0, 'latin1');
    buf.writeInt32LE(0x80, 0x3c);
    buf.write('PE\0\0', 0x80, 'latin1');
    buf.writeUInt16LE(machine, 0x84);
    fs.writeFileSync(abs, buf);
  }
  return root;
}

test('verifyAll no longer skips win32 — a 32-bit addon is a mismatch', () => {
  const result = verifyAll(fakeRepo('repo-x86', 0x014c), { platform: 'win32' });

  assert.equal(result.skipped, undefined, 'win32 must be checked, not skipped');
  assert.equal(result.ok, false);
  assert.equal(result.mismatches.length, 2, 'both better-sqlite3 and keytar must be reported');
  for (const m of result.mismatches) {
    assert.equal(m.actual, 'ia32');
    assert.match(m.path, /better_sqlite3\.node|keytar\.node/);
  }
});

test('verifyAll passes when the Windows addons match the host arch', { skip: process.arch !== 'x64' }, () => {
  const result = verifyAll(fakeRepo('repo-x64', 0x8664), { platform: 'win32' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});

test('Linux stays skipped — not a supported target', () => {
  const result = verifyAll(fakeRepo('repo-linux', 0x014c), { platform: 'linux' });

  assert.equal(result.skipped, true);
  assert.equal(result.ok, true);
});

test('the Windows fix message does not talk about Macs or DMGs', () => {
  const dev = buildFixCommand({ platform: 'win32' });
  assert.equal(dev, 'npm run rebuild:native', 'a developer can rebuild in place');

  const packaged = buildFixCommand({ platform: 'win32', packaged: true });
  assert.doesNotMatch(packaged, /Mac|DMG|Apple Silicon/, 'macOS wording must not leak into the Windows dialog');
  assert.match(packaged, /installer/);
});
