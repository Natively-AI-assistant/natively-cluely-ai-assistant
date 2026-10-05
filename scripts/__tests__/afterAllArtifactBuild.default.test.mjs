// Tests for scripts/afterAllArtifactBuild.default.cjs — the DEFAULT (`npm run dist`)
// build hook that verifies every packaged artifact still has its Electron runtime.
//
// THE BUG THIS GUARDS (v2.9.1): electron-builder 26.8.1's DMG step shipped an app
// whose Electron Framework binary was missing (electron-builder#9706), so every
// launch died at dyld ("Library not loaded: @rpath/Electron Framework…") → "cannot
// be opened". electron-builder 26.14.0+ builds the DMG correctly; the hook mounts
// each DMG it reports and fails the build if the binary is absent.
//
// Pure helpers run against real temp-dir fixtures (both platform branches from any
// host); the hook orchestration runs against injected fakes (no real hdiutil), so
// nothing here needs macOS, network, or a real build. process.platform is never
// mutated — the branch under test is the injected `platform`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const hook = require('../afterAllArtifactBuild.default.cjs');
const { macAppProblems, winUnpackedProblems, fsView, runHook, dmgArtifacts, dmgLayoutProblems, WIN_REQUIRED_FILES } = hook;

// Fake absolute paths are built with path.join, never written with '/': the hook
// joins with the host's separator, so a hand-written '/out/x' key would not match
// what it looks up on Windows and these tests would fail on that CI leg.
const abs = (...parts) => path.join(path.sep, ...parts);

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function mkFrameworkApp(root, { binaryBytes = 1024, danglingSymlink = false, noMacOS = false } = {}) {
  const app = path.join(root, 'corespeechd.app');
  if (!noMacOS) {
    fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'corespeechd'), 'bin');
  } else {
    fs.mkdirSync(path.join(app, 'Contents'), { recursive: true });
  }
  const fw = path.join(app, 'Contents', 'Frameworks', 'Electron Framework.framework');
  const vA = path.join(fw, 'Versions', 'A');
  fs.mkdirSync(vA, { recursive: true });
  if (binaryBytes !== null) {
    fs.writeFileSync(path.join(vA, 'Electron Framework'), Buffer.alloc(binaryBytes, 1));
  }
  // Versions/Current -> A (or a dangling target to simulate a broken chain)
  fs.symlinkSync(danglingSymlink ? 'DOES_NOT_EXIST' : 'A', path.join(fw, 'Versions', 'Current'));
  // top-level symlink dyld resolves via @rpath
  fs.symlinkSync('Versions/Current/Electron Framework', path.join(fw, 'Electron Framework'));
  return app;
}

function mkWinUnpacked(root, { omit = [], noExe = false } = {}) {
  const dir = path.join(root, 'win-unpacked');
  fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
  if (!noExe) fs.writeFileSync(path.join(dir, 'audiodg.exe'), 'exe');
  for (const rel of WIN_REQUIRED_FILES) {
    if (omit.includes(rel)) continue;
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x');
  }
  return dir;
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'natively-hook-test-'));
}

// ---------------------------------------------------------------------------
// macAppProblems (pure, real fixtures)
// ---------------------------------------------------------------------------

test('macAppProblems: healthy app has no problems', () => {
  const root = tmp();
  const app = mkFrameworkApp(root);
  assert.deepEqual(macAppProblems(app, fsView(fs)), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('macAppProblems: MISSING framework binary is reported (the v2.9.1 bug)', () => {
  const root = tmp();
  const app = mkFrameworkApp(root, { binaryBytes: null });
  const problems = macAppProblems(app, fsView(fs));
  assert.ok(problems.some((p) => /missing Electron Framework binary/.test(p)), problems.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('macAppProblems: 0-byte framework binary is reported', () => {
  const root = tmp();
  const app = mkFrameworkApp(root, { binaryBytes: 0 });
  const problems = macAppProblems(app, fsView(fs));
  assert.ok(problems.some((p) => /0 bytes/.test(p)), problems.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('macAppProblems: dangling Versions/Current symlink is reported', () => {
  const root = tmp();
  const app = mkFrameworkApp(root, { danglingSymlink: true });
  const problems = macAppProblems(app, fsView(fs));
  assert.ok(problems.some((p) => /symlink does not resolve/.test(p)), problems.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('macAppProblems: missing Contents/MacOS is reported', () => {
  const root = tmp();
  const app = mkFrameworkApp(root, { noMacOS: true });
  const problems = macAppProblems(app, fsView(fs));
  assert.ok(problems.some((p) => /Contents\/MacOS/.test(p)), problems.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// winUnpackedProblems (pure, real fixtures)
// ---------------------------------------------------------------------------

test('winUnpackedProblems: healthy unpacked dir has no problems', () => {
  const root = tmp();
  const dir = mkWinUnpacked(root);
  assert.deepEqual(winUnpackedProblems(dir, fsView(fs)), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('winUnpackedProblems: a missing core DLL is reported', () => {
  const root = tmp();
  const dir = mkWinUnpacked(root, { omit: ['ffmpeg.dll'] });
  const problems = winUnpackedProblems(dir, fsView(fs));
  assert.ok(problems.some((p) => /ffmpeg\.dll/.test(p)), problems.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('winUnpackedProblems: no .exe is reported', () => {
  const root = tmp();
  const dir = mkWinUnpacked(root, { noExe: true });
  const problems = winUnpackedProblems(dir, fsView(fs));
  assert.ok(problems.some((p) => /no \.exe/.test(p)), problems.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// dmgArtifacts
// ---------------------------------------------------------------------------

test('dmgArtifacts picks only the DMGs out of the build result', () => {
  assert.deepEqual(
    dmgArtifacts({
      artifactPaths: [
        '/out/Natively-2.9.1-arm64.zip',
        '/out/corespeechd-2.9.1-arm64.dmg',
        '/out/corespeechd-2.9.1-arm64.dmg.blockmap',
        '/out/corespeechd-2.9.1-x64.DMG',
        '/out/latest-mac.yml',
      ],
    }),
    ['/out/corespeechd-2.9.1-arm64.dmg', '/out/corespeechd-2.9.1-x64.DMG']
  );
  assert.deepEqual(dmgArtifacts({ artifactPaths: ['/out/audiodg-Setup-2.9.1.exe'] }), []);
  assert.deepEqual(dmgArtifacts(undefined), []);
});

// ---------------------------------------------------------------------------
// dmgLayoutProblems (pure, real fixtures)
// ---------------------------------------------------------------------------

function mkDmgRoot(root, { dsStore = true, background = '.background.tiff', appsLink = true } = {}) {
  const mount = path.join(root, 'mount');
  fs.mkdirSync(path.join(mount, 'corespeechd.app'), { recursive: true });
  if (dsStore) fs.writeFileSync(path.join(mount, '.DS_Store'), 'x');
  if (background === '.background') fs.mkdirSync(path.join(mount, '.background'));
  else if (background) fs.writeFileSync(path.join(mount, background), 'x');
  if (appsLink) fs.symlinkSync(os.tmpdir(), path.join(mount, 'Applications'));
  return mount;
}

test('dmgLayoutProblems: a DMG with its install window has no problems', () => {
  const root = tmp();
  assert.deepEqual(dmgLayoutProblems(mkDmgRoot(root), fsView(fs)), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('dmgLayoutProblems: a custom picture in a .background folder counts', () => {
  const root = tmp();
  assert.deepEqual(dmgLayoutProblems(mkDmgRoot(root, { background: '.background' }), fsView(fs)), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('dmgLayoutProblems: a bare hdiutil DMG (no layout, no picture) is reported', () => {
  const root = tmp();
  const problems = dmgLayoutProblems(mkDmgRoot(root, { dsStore: false, background: null }), fsView(fs));
  assert.ok(problems.some((p) => /\.DS_Store/.test(p)), problems.join('; '));
  assert.ok(problems.some((p) => /background/.test(p)), problems.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('dmgLayoutProblems: a missing Applications link is reported', () => {
  const root = tmp();
  const problems = dmgLayoutProblems(mkDmgRoot(root, { appsLink: false }), fsView(fs));
  assert.ok(problems.some((p) => /Applications link/.test(p)), problems.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// runHook orchestration (injected fakes — no real hdiutil)
// ---------------------------------------------------------------------------

// A tiny virtual filesystem view for the hook: paths that exist, their sizes, and
// directory entries. Lets the darwin branch run end-to-end without touching disk.
function vfs({ existing = [], sizes = {}, dirs = {} }) {
  const set = new Set(existing);
  return {
    exists: (p) => set.has(p),
    sizeOf: (p) => sizes[p] ?? 0,
    listDir: (p) => dirs[p] ?? [],
  };
}

const OUT = abs('out');
const MOUNT = abs('mnt', 'corespeechd');
const ARM_ZIP = path.join(OUT, 'Natively-2.9.1-arm64.zip');
const ARM_DMG = path.join(OUT, 'corespeechd-2.9.1-arm64.dmg');
const X64_DMG = path.join(OUT, 'corespeechd-2.9.1-x64.dmg');

function healthyMountView(mount, { layout = true } = {}) {
  const app = path.join(mount, 'corespeechd.app');
  const fwBin = path.join(app, hook.MAC_FRAMEWORK_BINARY);
  const fwLink = path.join(app, hook.MAC_FRAMEWORK_SYMLINK);
  const macos = path.join(app, 'Contents', 'MacOS');
  return vfs({
    existing: [fwBin, fwLink, macos, ...(layout ? [path.join(mount, '.DS_Store')] : [])],
    sizes: { [fwBin]: 191000000 },
    dirs: {
      [mount]: layout
        ? ['.DS_Store', '.background.tiff', 'Applications', 'corespeechd.app']
        : ['Applications', 'corespeechd.app'],
      [macos]: ['corespeechd'],
    },
  });
}

function darwinDeps(view, { mount = MOUNT, codesignOk = true, attached = [], warnings = [] } = {}) {
  return {
    platform: 'darwin',
    view,
    outDir: OUT,
    attach: (dmg) => { attached.push(dmg); return mount; },
    detach: () => {},
    verifyCodesign: () => ({ ok: codesignOk, message: codesignOk ? '' : 'a sealed resource is missing or invalid' }),
    log: () => {},
    warn: (m) => warnings.push(m),
  };
}

test('runHook(darwin): healthy DMGs → each one mounted + verified, no throw, no warning', async () => {
  const attached = [];
  const warnings = [];
  const view = healthyMountView(MOUNT);
  const result = await runHook(
    { artifactPaths: [ARM_ZIP, ARM_DMG, `${ARM_DMG}.blockmap`, X64_DMG] },
    darwinDeps(view, { attached, warnings })
  );
  assert.deepEqual(attached, [ARM_DMG, X64_DMG]);
  assert.deepEqual(result, [ARM_DMG, X64_DMG]);
  assert.deepEqual(warnings, []);
});

test('runHook(darwin): DMG missing the framework binary → throws (build fails)', async () => {
  const mount = MOUNT;
  const macos = path.join(mount, 'corespeechd.app', 'Contents', 'MacOS');
  // Mounted app has Contents/MacOS but NO framework binary and NO resolving symlink.
  const view = vfs({
    existing: [macos, path.join(mount, '.DS_Store')],
    dirs: {
      [mount]: ['.DS_Store', '.background.tiff', 'Applications', 'corespeechd.app'],
      [macos]: ['corespeechd'],
    },
  });
  await assert.rejects(
    () => runHook({ artifactPaths: [ARM_DMG] }, darwinDeps(view, { mount })),
    /missing Electron Framework binary/
  );
});

test('runHook(darwin): codesign --verify failure is FATAL (invalid sig SIGTRAPs on macOS 27)', async () => {
  const view = healthyMountView(MOUNT);
  const deps = darwinDeps(view, { codesignOk: false });
  await assert.rejects(() => runHook({ artifactPaths: [ARM_DMG] }, deps), /codesign --verify failed/);
});

test('runHook(darwin): a DMG that cannot be mounted → throws', async () => {
  const view = healthyMountView(MOUNT);
  const deps = darwinDeps(view);
  deps.attach = () => { throw new Error('hdiutil: attach failed - image not recognized'); };
  await assert.rejects(() => runHook({ artifactPaths: [ARM_DMG] }, deps), /could not mount for verification/);
});

test('runHook(darwin): detach runs after verification (cleanup)', async () => {
  let detached = false;
  const view = healthyMountView(MOUNT);
  const deps = darwinDeps(view);
  deps.detach = () => { detached = true; };
  await runHook({ artifactPaths: [ARM_DMG] }, deps);
  assert.equal(detached, true);
});

test('runHook(darwin): DMG without its install window → warns, does not fail the build', async () => {
  const warnings = [];
  const view = healthyMountView(MOUNT, { layout: false });
  const result = await runHook({ artifactPaths: [ARM_DMG] }, darwinDeps(view, { warnings }));
  assert.deepEqual(result, [ARM_DMG]);
  assert.ok(warnings.some((w) => /install window/.test(w) && /\.DS_Store/.test(w)), warnings.join('; '));
  assert.ok(warnings.some((w) => /install window/.test(w) && /background/.test(w)), warnings.join('; '));
});

test('runHook(darwin): no DMG in the build result (e.g. a zip-only run) → warns, nothing mounted', async () => {
  const attached = [];
  const warnings = [];
  const view = healthyMountView(MOUNT);
  const result = await runHook(
    { artifactPaths: [ARM_ZIP] },
    darwinDeps(view, { attached, warnings })
  );
  assert.deepEqual(result, []);
  assert.deepEqual(attached, []);
  assert.ok(warnings.some((w) => /no macOS DMG/.test(w)), warnings.join('; '));
});

test('runHook(win32): healthy unpacked → no throw', async () => {
  const dir = path.join(OUT, 'win-unpacked');
  const existing = [OUT, dir];
  const sizes = {};
  for (const rel of WIN_REQUIRED_FILES) existing.push(path.join(dir, rel));
  const view = vfs({
    existing,
    dirs: { [OUT]: ['win-unpacked'], [dir]: ['audiodg.exe', 'ffmpeg.dll'] },
  });
  const res = await runHook({ artifactPaths: [path.join(OUT, 'Setup.exe')] }, {
    platform: 'win32', view, outDir: OUT, log: () => {}, warn: () => {},
  });
  assert.deepEqual(res, []);
});

test('runHook(win32): missing runtime DLL → throws', async () => {
  const dir = path.join(OUT, 'win-unpacked');
  const view = vfs({
    existing: [OUT, dir, path.join(dir, 'ffmpeg.dll')], // most required files absent
    dirs: { [OUT]: ['win-unpacked'], [dir]: ['audiodg.exe'] },
  });
  await assert.rejects(
    () => runHook({ artifactPaths: [path.join(OUT, 'Setup.exe')] }, {
      platform: 'win32', view, outDir: OUT, log: () => {}, warn: () => {},
    }),
    /missing Electron runtime file|FATAL/
  );
});

test('runHook(linux/other): no-op', async () => {
  const res = await runHook({ artifactPaths: [] }, {
    platform: 'linux', view: vfs({}), outDir: OUT, log: () => {}, warn: () => {},
  });
  assert.deepEqual(res, []);
});
