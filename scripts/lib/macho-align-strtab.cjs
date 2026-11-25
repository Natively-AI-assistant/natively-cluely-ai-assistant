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
 * else: symbols address strings relative to stroff. The file step re-signs.
 *
 * macOS only. The Windows and Linux builds never call this.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
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

/**
 * Aligns a built .node and ad-hoc re-signs it. Returns the bytes added (0 when
 * it was fine).
 *
 * The signature comes off a copy, never the module: the copy is aligned and
 * signed, then written over the module. If any step fails, the module keeps its
 * original bytes and signature and is still misaligned, so the next run tries
 * again. Changing the module itself first used to leave it unsigned on failure,
 * and aligned but unsigned when the re-sign failed, which the next run then
 * skipped as done (#791). A kill (power loss, kill -9) can leave the temp
 * staging folder behind; the OS clears it.
 */
function alignMachOStringTableFile(modulePath, run = execFileSync) {
  // Through a symlink, align the module it points to, as writing in place did.
  const file = fs.realpathSync(modulePath);
  removeLeftoverSwaps(file);
  if (!alignStringTable.isMisaligned(fs.readFileSync(file))) return 0;
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-macho-align-'));
  // Same file name: the ad-hoc signature's identifier is taken from it.
  const staged = path.join(stagingDir, path.basename(file));
  // Next to the module, so the rename below stays on one volume and swaps the
  // file in one step: a failed copy (a full disk) only ever leaves this one
  // half-written. '.stale-' matches the native-module/*.node.stale-* ignore rule.
  const swap = `${file}.stale-align-${process.pid}`;
  try {
    fs.copyFileSync(file, staged);
    run('codesign', ['--remove-signature', staged]);
    const result = alignStringTable(fs.readFileSync(staged));
    if (!result) return 0;
    fs.writeFileSync(staged, result.buf);
    run('codesign', ['--force', '--sign', '-', staged]);
    fs.copyFileSync(staged, swap);
    fs.renameSync(swap, file);
    return result.pad;
  } finally {
    fs.rmSync(swap, { force: true });
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

/**
 * Deletes swap files a killed run left beside the module (power loss or kill -9
 * between the copy and the rename). A swap whose process is still running
 * belongs to another build and is left alone. Packaging also leaves them out
 * (the native-module .node.stale-* rule in package.json build.files).
 */
function removeLeftoverSwaps(file) {
  const prefix = `${path.basename(file)}.stale-align-`;
  for (const name of fs.readdirSync(path.dirname(file))) {
    if (!name.startsWith(prefix)) continue;
    const pid = Number(name.slice(prefix.length));
    if (pid !== process.pid && isRunning(pid)) continue;
    fs.rmSync(path.join(path.dirname(file), name), { force: true });
  }
}

function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // running, but owned by another user
  }
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
