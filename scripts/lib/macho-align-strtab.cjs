'use strict';

/*
 * Pads a macOS native module's string table to an 8-byte boundary.
 *
 * macOS 27's dyld refuses to load a dylib whose __LINKEDIT string pool is not
 * pointer-aligned ("mis-aligned LINKEDIT string pool, fileOffset=0x…"). Xcode
 * 27's linker (ld-27037) writes the string table straight after the indirect
 * symbol table, whose entries are 4 bytes each, without padding. So whether a
 * build loads depends on whether the indirect symbol count happens to be even:
 * the 2026-10-05 build had 564 and loaded, the 2026-10-18 build had 591 and
 * did not, from the same toolchain. `-ld_classic` is gone in Xcode 27.
 *
 * The string table is the last thing in __LINKEDIT once the signature is
 * removed, so moving it later in the file by the missing bytes changes nothing
 * else: symbols address strings relative to stroff. The caller re-signs.
 *
 * macOS only. The Windows and Linux builds never call this.
 */

const fs = require('fs');
const { execFileSync } = require('child_process');

const MH_MAGIC_64 = 0xfeedfacf;
const LC_SEGMENT_64 = 0x19;
const LC_SYMTAB = 0x2;
const LC_CODE_SIGNATURE = 0x1d;
const PAGE = 0x4000;

/**
 * Returns a copy of an unsigned, thin 64-bit Mach-O with its string table moved
 * to `align`, or null when it is already aligned. Throws on any layout it does
 * not expect rather than guessing.
 */
function alignStringTable(buf, align = 8) {
  if (buf.length < 32 || buf.readUInt32LE(0) !== MH_MAGIC_64) {
    throw new Error('not a thin 64-bit little-endian Mach-O');
  }
  const ncmds = buf.readUInt32LE(16);
  let linkedit = null;
  let symtab = null;
  let at = 32;
  for (let i = 0; i < ncmds; i++) {
    const cmd = buf.readUInt32LE(at);
    const cmdsize = buf.readUInt32LE(at + 4);
    if (cmd === LC_CODE_SIGNATURE) throw new Error('remove the code signature before aligning');
    if (cmd === LC_SEGMENT_64 && buf.toString('latin1', at + 8, at + 24).replace(/\0+$/, '') === '__LINKEDIT') {
      linkedit = {
        at,
        vmsize: Number(buf.readBigUInt64LE(at + 32)),
        fileoff: Number(buf.readBigUInt64LE(at + 40)),
        filesize: Number(buf.readBigUInt64LE(at + 48)),
      };
    }
    if (cmd === LC_SYMTAB) {
      symtab = { at, stroff: buf.readUInt32LE(at + 16), strsize: buf.readUInt32LE(at + 20) };
    }
    at += cmdsize;
  }
  if (!linkedit || !symtab) throw new Error('no __LINKEDIT segment or LC_SYMTAB');

  const pad = (align - (symtab.stroff % align)) % align;
  if (pad === 0) return null;

  const linkeditEnd = linkedit.fileoff + linkedit.filesize;
  if (symtab.stroff + symtab.strsize !== linkeditEnd || linkeditEnd !== buf.length) {
    throw new Error('string table is not the last thing in the file');
  }

  const out = Buffer.concat([buf.subarray(0, symtab.stroff), Buffer.alloc(pad), buf.subarray(symtab.stroff)]);
  out.writeUInt32LE(symtab.stroff + pad, symtab.at + 16);
  const filesize = linkedit.filesize + pad;
  out.writeBigUInt64LE(BigInt(filesize), linkedit.at + 48);
  if (filesize > linkedit.vmsize) {
    out.writeBigUInt64LE(BigInt(Math.ceil(filesize / PAGE) * PAGE), linkedit.at + 32);
  }
  return { buf: out, pad };
}

/** Aligns a built .node in place and ad-hoc re-signs it. Returns the bytes added (0 when it was fine). */
function alignMachOStringTableFile(file, run = execFileSync) {
  if (!alignStringTable.isMisaligned(fs.readFileSync(file))) return 0;
  run('codesign', ['--remove-signature', file]);
  const result = alignStringTable(fs.readFileSync(file));
  if (result) fs.writeFileSync(file, result.buf);
  run('codesign', ['--force', '--sign', '-', file]);
  return result ? result.pad : 0;
}

/** True when the string table offset is not on an `align` boundary. Reads only the header. */
alignStringTable.isMisaligned = function isMisaligned(buf, align = 8) {
  if (buf.length < 32 || buf.readUInt32LE(0) !== MH_MAGIC_64) return false;
  const ncmds = buf.readUInt32LE(16);
  let at = 32;
  for (let i = 0; i < ncmds; i++) {
    if (buf.readUInt32LE(at) === LC_SYMTAB) return buf.readUInt32LE(at + 16) % align !== 0;
    at += buf.readUInt32LE(at + 4);
  }
  return false;
};

module.exports = { alignStringTable, alignMachOStringTableFile };
