// macOS 27's dyld rejects a native module whose string table is not 8-byte
// aligned, and Xcode 27's linker leaves it 4 bytes off whenever the indirect
// symbol count is odd (found 2026-10-18: the rebuilt module would not load, so
// Apple Calendar read "Needs a newer version of Natively"). These tests build
// small Mach-O images by hand, so they run on macOS and Windows alike.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { alignStringTable, alignMachOStringTableFile } = require('../lib/macho-align-strtab.cjs');

const LC_SEGMENT_64 = 0x19;
const LC_SYMTAB = 0x2;
const LC_CODE_SIGNATURE = 0x1d;
const STRINGS = Buffer.from('\0 _napi_register_module_v1\0_calendarAuthorizationStatus\0\0\0\0\0\0', 'latin1');

/** Header + __LINKEDIT + LC_SYMTAB (+ optional signature command), string table last. */
function machO({ stroff, withSignature = false, trailing = 0 }) {
  const cmds = [];
  const seg = Buffer.alloc(72);
  seg.writeUInt32LE(LC_SEGMENT_64, 0);
  seg.writeUInt32LE(72, 4);
  seg.write('__LINKEDIT', 8, 'latin1');
  cmds.push(seg);
  const symtab = Buffer.alloc(24);
  symtab.writeUInt32LE(LC_SYMTAB, 0);
  symtab.writeUInt32LE(24, 4);
  symtab.writeUInt32LE(stroff, 16);
  symtab.writeUInt32LE(STRINGS.length, 20);
  cmds.push(symtab);
  if (withSignature) {
    const sig = Buffer.alloc(16);
    sig.writeUInt32LE(LC_CODE_SIGNATURE, 0);
    sig.writeUInt32LE(16, 4);
    cmds.push(sig);
  }
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(cmds.length, 16);
  header.writeUInt32LE(cmds.reduce((n, c) => n + c.length, 0), 20);
  const head = Buffer.concat([header, ...cmds]);
  assert.ok(stroff >= head.length + 8, 'test image: string table must follow the commands');
  const file = Buffer.concat([head, Buffer.alloc(stroff - head.length, 0xab), STRINGS, Buffer.alloc(trailing)]);
  // __LINKEDIT covers everything after the commands.
  file.writeBigUInt64LE(BigInt(head.length), 32 + 40);
  file.writeBigUInt64LE(BigInt(file.length - head.length), 32 + 48);
  file.writeBigUInt64LE(BigInt(file.length - head.length), 32 + 32);
  return file;
}

const read = (buf) => ({
  stroff: buf.readUInt32LE(32 + 72 + 16),
  strsize: buf.readUInt32LE(32 + 72 + 20),
  fileoff: Number(buf.readBigUInt64LE(32 + 40)),
  filesize: Number(buf.readBigUInt64LE(32 + 48)),
  vmsize: Number(buf.readBigUInt64LE(32 + 32)),
});

test('a string table 4 bytes off is moved to the next 8-byte boundary, strings intact', () => {
  const before = machO({ stroff: 4 + 8 * 40 });
  assert.equal(read(before).stroff % 8, 4);
  assert.equal(alignStringTable.isMisaligned(before), true);

  const { buf, pad } = alignStringTable(before);
  const after = read(buf);
  assert.equal(pad, 4);
  assert.equal(after.stroff % 8, 0);
  assert.equal(after.stroff, read(before).stroff + 4);
  assert.deepEqual(buf.subarray(after.stroff, after.stroff + after.strsize), STRINGS);
  assert.equal(after.fileoff + after.filesize, buf.length, '__LINKEDIT still ends at the end of the file');
  assert.ok(after.vmsize >= after.filesize);
  const commandsEnd = after.fileoff;
  assert.deepEqual(buf.subarray(commandsEnd, read(before).stroff), before.subarray(commandsEnd, read(before).stroff), 'the data before the table does not move');
  assert.equal(alignStringTable.isMisaligned(buf), false);
});

test('an aligned string table is left alone', () => {
  const buf = machO({ stroff: 8 * 41 });
  assert.equal(alignStringTable(buf), null);
  assert.equal(alignStringTable.isMisaligned(buf), false);
});

test('a signed image is refused: the signature has to come off first', () => {
  assert.throws(() => alignStringTable(machO({ stroff: 4 + 8 * 40, withSignature: true })), /code signature/);
});

test('an image with data after the string table is refused rather than corrupted', () => {
  assert.throws(() => alignStringTable(machO({ stroff: 4 + 8 * 40, trailing: 16 })), /not the last thing/);
});

test('anything but a thin 64-bit Mach-O is refused, and never reads as misaligned', () => {
  const fat = Buffer.alloc(64);
  fat.writeUInt32BE(0xcafebabe, 0);
  assert.throws(() => alignStringTable(fat), /Mach-O/);
  assert.equal(alignStringTable.isMisaligned(fat), false);
});

test('the file step aligns and signs a copy, then puts it in place; an aligned file runs nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-macho-align-test-'));
  const file = path.join(dir, 'index.darwin-arm64.node');
  const calls = [];
  const run = (cmd, args) => calls.push([cmd, ...args]);

  fs.writeFileSync(file, machO({ stroff: 4 + 8 * 40 }));
  assert.equal(alignMachOStringTableFile(file, run), 4);
  const staged = calls[0][2];
  assert.notEqual(staged, file, 'the module itself is never left unsigned');
  assert.equal(path.basename(staged), path.basename(file), 'same name, so the ad-hoc identifier does not change');
  assert.deepEqual(calls, [
    ['codesign', '--remove-signature', staged],
    ['codesign', '--force', '--sign', '-', staged],
  ]);
  assert.equal(read(fs.readFileSync(file)).stroff % 8, 0);
  assert.equal(fs.existsSync(path.dirname(staged)), false, 'the staging copy is removed');
  assert.deepEqual(fs.readdirSync(dir), ['index.darwin-arm64.node'], 'nothing is left next to the module');

  calls.length = 0;
  assert.equal(alignMachOStringTableFile(file, run), 0);
  assert.deepEqual(calls, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

// #791: the signature used to come off the module itself before the steps that
// can fail, so a failure left it unsigned, and a failed re-sign left it aligned
// too, which made the next run return 0 without signing.

test('a layout the aligner refuses leaves the module exactly as it was', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-macho-align-test-'));
  const file = path.join(dir, 'index.darwin-arm64.node');
  const original = machO({ stroff: 4 + 8 * 40, trailing: 16 });
  fs.writeFileSync(file, original);
  const calls = [];
  const run = (cmd, args) => calls.push([cmd, ...args]);

  assert.throws(() => alignMachOStringTableFile(file, run), /not the last thing/);
  assert.deepEqual(fs.readFileSync(file), original);
  assert.ok(calls.every((call) => !call.includes(file)), 'codesign never touched the module');
  assert.equal(fs.existsSync(path.dirname(calls[0][2])), false, 'the staging copy is removed');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a failed re-sign leaves the module as it was, and the next run still aligns and signs it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-macho-align-test-'));
  const file = path.join(dir, 'index.darwin-arm64.node');
  const original = machO({ stroff: 4 + 8 * 40 });
  fs.writeFileSync(file, original);
  const calls = [];
  const failingSign = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args.includes('--force')) throw new Error('codesign: the codesign_allocate helper tool cannot be found');
  };

  assert.throws(() => alignMachOStringTableFile(file, failingSign), /codesign_allocate/);
  assert.deepEqual(fs.readFileSync(file), original);
  assert.equal(alignStringTable.isMisaligned(fs.readFileSync(file)), true);
  assert.equal(fs.existsSync(path.dirname(calls[0][2])), false, 'the staging copy is removed');

  calls.length = 0;
  const run = (cmd, args) => calls.push([cmd, ...args]);
  assert.equal(alignMachOStringTableFile(file, run), 4);
  assert.deepEqual(calls.map((call) => call[1]), ['--remove-signature', '--force']);
  assert.equal(read(fs.readFileSync(file)).stroff % 8, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// Read-only directories need POSIX permissions, and root ignores them.
test('a module that cannot be replaced is left whole, with nothing left beside it', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-macho-align-test-'));
  const file = path.join(dir, 'index.darwin-arm64.node');
  const original = machO({ stroff: 4 + 8 * 40 });
  fs.writeFileSync(file, original);
  const run = () => {};

  fs.chmodSync(dir, 0o555);
  try {
    assert.throws(() => alignMachOStringTableFile(file, run), /EACCES|EPERM/);
  } finally {
    fs.chmodSync(dir, 0o755);
  }
  assert.deepEqual(fs.readFileSync(file), original);
  assert.deepEqual(fs.readdirSync(dir), ['index.darwin-arm64.node']);
  fs.rmSync(dir, { recursive: true, force: true });
});

// The pid of a process that has exited, so a swap file named for it is a leftover.
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;

test('a swap file left by a killed run is deleted on the next run, even when nothing needs aligning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-macho-align-test-'));
  const file = path.join(dir, 'index.darwin-arm64.node');
  fs.writeFileSync(file, machO({ stroff: 8 * 41 }));
  const dead = deadPid();
  fs.writeFileSync(`${file}.stale-align-${dead}`, 'half-written');
  fs.writeFileSync(path.join(dir, `index.darwin-x64.node.stale-align-${dead}`), 'the other module');
  const calls = [];

  assert.equal(alignMachOStringTableFile(file, (cmd, args) => calls.push([cmd, ...args])), 0);
  assert.deepEqual(calls, []);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['index.darwin-arm64.node', `index.darwin-x64.node.stale-align-${dead}`]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a swap file of a build that is still running is left alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-macho-align-test-'));
  const file = path.join(dir, 'index.darwin-arm64.node');
  fs.writeFileSync(file, machO({ stroff: 8 * 41 }));
  const live = `index.darwin-arm64.node.stale-align-${process.ppid}`;
  fs.writeFileSync(path.join(dir, live), 'mid-swap');

  assert.equal(alignMachOStringTableFile(file, () => {}), 0);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['index.darwin-arm64.node', live]);
  fs.rmSync(dir, { recursive: true, force: true });
});

// Creating a symlink on Windows needs Developer Mode or admin rights.
test('through a symlink, the module it points to is aligned and the link stays a link', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-macho-align-test-'));
  const real = path.join(dir, 'build', 'index.darwin-arm64.node');
  fs.mkdirSync(path.dirname(real));
  fs.writeFileSync(real, machO({ stroff: 4 + 8 * 40 }));
  const link = path.join(dir, 'index.darwin-arm64.node');
  fs.symlinkSync(real, link);
  const calls = [];

  assert.equal(alignMachOStringTableFile(link, (cmd, args) => calls.push([cmd, ...args])), 4);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(read(fs.readFileSync(real)).stroff % 8, 0);
  assert.equal(path.basename(calls[0][2]), 'index.darwin-arm64.node');
  assert.deepEqual(fs.readdirSync(path.dirname(real)), ['index.darwin-arm64.node'], 'no swap file left by the module');
  fs.rmSync(dir, { recursive: true, force: true });
});
