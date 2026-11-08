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

test('the file step removes the signature, pads, and re-signs ad hoc; an aligned file runs nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-macho-align-'));
  const file = path.join(dir, 'index.darwin-arm64.node');
  const calls = [];
  const run = (cmd, args) => calls.push([cmd, ...args]);

  fs.writeFileSync(file, machO({ stroff: 4 + 8 * 40 }));
  assert.equal(alignMachOStringTableFile(file, run), 4);
  assert.deepEqual(calls, [
    ['codesign', '--remove-signature', file],
    ['codesign', '--force', '--sign', '-', file],
  ]);
  assert.equal(read(fs.readFileSync(file)).stroff % 8, 0);

  calls.length = 0;
  assert.equal(alignMachOStringTableFile(file, run), 0);
  assert.deepEqual(calls, []);
  fs.rmSync(dir, { recursive: true, force: true });
});
