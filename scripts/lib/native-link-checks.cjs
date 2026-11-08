/**
 * Link-time checks on the built audio module (native-module/index.*.node), run
 * by scripts/build-native.js right after napi builds it. Both guard failures
 * where the module is fine on the build machine and does not load at all on a
 * user's: then the microphone, system audio and every other native export are
 * gone together.
 *
 * macOS — CoreAudio and ScreenCaptureKit must be linked WEAK
 *   (native-module/.cargo/config.toml). AudioHardwareCreateProcessTap exists
 *   only from macOS 14.2 and ScreenCaptureKit only from 12.3; linked strong,
 *   dyld refuses the module on anything older than that. So must every PRIVATE
 *   framework (cidre links MobileDevice): Apple can drop or move one in any
 *   release. And the module must not import objc_retain_x<N> /
 *   objc_release_x<N>, register variants libobjc gained in macOS 13 that cidre
 *   calls on arm64 unless its classic-objc-retain-release feature is on: with
 *   them an Apple Silicon Mac on macOS 12 could not load the module.
 *   (2026-10-21: every other symbol the module imports was checked against the
 *   SDK headers' availability annotations and is available on macOS 12.)
 *
 * Windows — the module must not import the Visual C++ runtime DLLs
 *   (VCRUNTIME140.dll, MSVCP140.dll, ...). Nothing beside it provides them, so
 *   on a PC without the redistributable it fails with "The specified module
 *   could not be found". `+crt-static` in the same config.toml removes them.
 */
const fs = require('fs');
const { execFileSync } = require('child_process');

const MAC_WEAK_FRAMEWORKS = Object.freeze(['CoreAudio', 'ScreenCaptureKit']);
// Every DLL of the Visual C++ Redistributable, release and debug: vcruntime140,
// vcruntime140_1, msvcp140, msvcp140_1/_2, msvcp140_atomic_wait,
// msvcp140_codecvt_ids, concrt140, vccorlib140, vcomp140, and the debug *d
// variants plus ucrtbased. (The release UCRT, ucrtbase / api-ms-win-crt-*, is
// part of Windows 10 and later, so importing it is fine.)
const VC_RUNTIME_DLL = /^((vcruntime|msvcp|concrt|vccorlib|vcomp)\d+(_[a-z0-9_]+)?d?|ucrtbased)\.dll$/i;

/**
 * Dylibs from `otool -l` output, split by load command.
 * @returns {{ strong: string[], weak: string[] }}
 */
function parseOtoolLoadCommands(output) {
  const strong = [];
  const weak = [];
  let current = null;
  for (const line of String(output).split('\n')) {
    const cmd = line.match(/^\s*cmd (LC_\w+)/);
    if (cmd) {
      current = cmd[1];
      continue;
    }
    const name = line.match(/^\s*name (\S+) \(offset/);
    if (!name) continue;
    if (current === 'LC_LOAD_DYLIB') strong.push(name[1]);
    else if (current === 'LC_LOAD_WEAK_DYLIB') weak.push(name[1]);
  }
  return { strong, weak };
}

function frameworkName(dylibPath) {
  const m = dylibPath.match(/\/([^/]+)\.framework\//);
  return m ? m[1] : null;
}

/** Problems with a module's macOS load commands, or [] when it is fine. */
function macWeakLinkProblems(otoolOutput) {
  const { strong, weak } = parseOtoolLoadCommands(otoolOutput);
  const problems = [];
  for (const p of strong) {
    if (p.startsWith('/System/Library/PrivateFrameworks/')) {
      problems.push(`private framework ${frameworkName(p) ?? p} is linked strong; it must be weak (-weak_framework ${frameworkName(p) ?? ''})`);
    }
  }
  for (const fw of MAC_WEAK_FRAMEWORKS) {
    if (strong.some((p) => frameworkName(p) === fw)) {
      problems.push(`${fw} is linked strong; it must be weak (-weak_framework ${fw})`);
    } else if (!weak.some((p) => frameworkName(p) === fw)) {
      problems.push(`${fw} is not linked at all; expected a weak link`);
    }
  }
  return problems;
}

// libobjc's register-specific entry points, macOS 13 and later only.
const OBJC_REGISTER_VARIANT = /^_objc_(retain|release)_x\d+$/;

/** Imports from `nm -u` output that need a newer macOS than 12, or []. */
function macNewerRuntimeImports(nmUndefinedOutput) {
  return String(nmUndefinedOutput)
    .split('\n')
    .map((l) => l.trim())
    .filter((sym) => OBJC_REGISTER_VARIANT.test(sym));
}

function assertMacWeakLinks(file, { run = execFileSync } = {}) {
  const output = run('otool', ['-l', file], { encoding: 'utf8' });
  const problems = macWeakLinkProblems(output);
  const newer = macNewerRuntimeImports(run('nm', ['-u', file], { encoding: 'utf8' }));
  if (newer.length) {
    problems.push(
      `imports ${newer.slice(0, 3).join(', ')}${newer.length > 3 ? ` and ${newer.length - 3} more` : ''} ` +
        '(libobjc, macOS 13+); enable cidre\'s classic-objc-retain-release feature (native-module/Cargo.toml)'
    );
  }
  if (problems.length) {
    throw new Error(
      `${file} would not load on every macOS the app supports:\n  ${problems.join('\n  ')}\n` +
        '  See native-module/.cargo/config.toml.'
    );
  }
}

/**
 * Names of the DLLs a PE file imports (its import directory), or null when the
 * buffer is not a PE image.
 */
function peImportedDlls(buf) {
  try {
    return readPeImports(buf);
  } catch {
    // A truncated or malformed image: report it as "not a PE image" rather than
    // a RangeError from deep inside the walk.
    return null;
  }
}

function readPeImports(buf) {
  if (buf.length < 64 || buf.readUInt16LE(0) !== 0x5a4d) return null; // "MZ"
  const pe = buf.readUInt32LE(0x3c);
  if (pe + 24 > buf.length || buf.readUInt32LE(pe) !== 0x00004550) return null; // "PE\0\0"
  const sectionCount = buf.readUInt16LE(pe + 6);
  const optionalSize = buf.readUInt16LE(pe + 20);
  const optional = pe + 24;
  const magic = buf.readUInt16LE(optional);
  if (magic !== 0x10b && magic !== 0x20b) return null;
  // NumberOfRvaAndSizes sits just before the data directories, which start at
  // 96 (PE32) or 112 (PE32+); entry 1 is the import table.
  const dirs = optional + (magic === 0x20b ? 112 : 96);
  if (buf.readUInt32LE(dirs - 4) < 2) return [];
  const importRva = buf.readUInt32LE(dirs + 8);
  if (importRva === 0) return [];

  const sections = [];
  const table = optional + optionalSize;
  for (let i = 0; i < sectionCount; i++) {
    const s = table + i * 40;
    sections.push({
      va: buf.readUInt32LE(s + 12),
      virtualSize: buf.readUInt32LE(s + 8),
      rawSize: buf.readUInt32LE(s + 16),
      raw: buf.readUInt32LE(s + 20),
    });
  }
  // Only bytes actually stored in the file map to an offset: past a section's
  // raw data the rest is zero-fill, not the next section's bytes.
  const offsetOf = (rva) => {
    const s = sections.find((x) => rva >= x.va && rva < x.va + Math.max(x.virtualSize, x.rawSize));
    if (!s || rva - s.va >= s.rawSize) return -1;
    const off = rva - s.va + s.raw;
    return off < buf.length ? off : -1;
  };
  const cString = (off) => {
    const end = buf.indexOf(0, off);
    return buf.toString('latin1', off, end < 0 ? buf.length : end);
  };

  const names = [];
  for (let d = offsetOf(importRva); d >= 0 && d + 20 <= buf.length; d += 20) {
    const nameRva = buf.readUInt32LE(d + 12);
    if (nameRva === 0) break; // the all-zero descriptor ends the table
    const off = offsetOf(nameRva);
    if (off >= 0) names.push(cString(off));
  }
  return names;
}

function assertNoDynamicVcRuntime(file, { fsImpl = fs } = {}) {
  const dlls = peImportedDlls(fsImpl.readFileSync(file));
  if (dlls === null) throw new Error(`${file} is not a PE image`);
  const runtime = dlls.filter((d) => VC_RUNTIME_DLL.test(d));
  if (runtime.length) {
    throw new Error(
      `${file} imports ${runtime.join(', ')}: it would not load on a PC without the ` +
        'Visual C++ Redistributable. Build with -C target-feature=+crt-static ' +
        '(native-module/.cargo/config.toml).'
    );
  }
}

module.exports = {
  MAC_WEAK_FRAMEWORKS,
  parseOtoolLoadCommands,
  macWeakLinkProblems,
  macNewerRuntimeImports,
  assertMacWeakLinks,
  peImportedDlls,
  assertNoDynamicVcRuntime,
};
