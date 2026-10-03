// Tests for scripts/afterAllArtifactBuild.default.cjs — the DEFAULT (`npm run dist`)
// build hook that produces the macOS DMG via `hdiutil create` and verifies every
// packaged artifact still has its Electron runtime.
//
// THE BUG THIS GUARDS (v2.9.1): electron-builder's DMG step on macOS 27 shipped an
// app whose Electron Framework binary was missing, so every launch died at dyld
// ("Library not loaded: @rpath/Electron Framework…") → "cannot be opened". The hook
// builds the DMG a different way and fails the build if the binary is absent.
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
const { macAppProblems, winUnpackedProblems, fsView, runHook, dmgNameFor, WIN_REQUIRED_FILES } = hook;

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
// dmgNameFor
// ---------------------------------------------------------------------------

test('dmgNameFor matches electron-builder naming per arch', () => {
  assert.equal(dmgNameFor('mac-arm64', 'corespeechd', '2.9.1'), 'corespeechd-2.9.1-arm64.dmg');
  assert.equal(dmgNameFor('mac', 'corespeechd', '2.9.1'), 'corespeechd-2.9.1.dmg');
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

function healthyMountView(outDir, mount) {
  const app = `${mount}/corespeechd.app`;
  const fwBin = `${app}/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework`;
  const fwLink = `${app}/Contents/Frameworks/Electron Framework.framework/Electron Framework`;
  const macos = `${app}/Contents/MacOS`;
  return vfs({
    existing: [fwBin, fwLink, macos],
    sizes: { [fwBin]: 191000000 },
    dirs: {
      [`${outDir}/mac-arm64`]: ['corespeechd.app'],
      [`${outDir}/mac`]: [],
      [mount]: ['corespeechd.app'],
      [macos]: ['corespeechd'],
    },
  });
}

function darwinDeps(view, { built = [], mount = '/mnt/corespeechd', codesignOk = true } = {}) {
  return {
    platform: 'darwin',
    view,
    outDir: '/out',
    version: '2.9.1',
    volname: 'corespeechd',
    buildDmg: ({ outDmg }) => built.push(outDmg),
    attach: () => mount,
    detach: () => {},
    verifyCodesign: () => ({ ok: codesignOk, message: codesignOk ? '' : 'a sealed resource is missing or invalid' }),
    log: () => {},
    warn: () => {},
  };
}

test('runHook(darwin): healthy staged app → builds + verifies DMG, no throw', async () => {
  const built = [];
  const view = healthyMountView('/out', '/mnt/corespeechd');
  const result = await runHook({ artifactPaths: ['/out/corespeechd-2.9.1-arm64-mac.zip'] }, darwinDeps(view, { built }));
  assert.deepEqual(built, ['/out/corespeechd-2.9.1-arm64.dmg']);
  assert.deepEqual(result, ['/out/corespeechd-2.9.1-arm64.dmg']);
});

test('runHook(darwin): DMG missing the framework binary → throws (build fails)', async () => {
  const mount = '/mnt/corespeechd';
  const app = `${mount}/corespeechd.app`;
  // Mounted app has Contents/MacOS but NO framework binary and NO resolving symlink.
  const view = vfs({
    existing: [`${app}/Contents/MacOS`],
    dirs: {
      '/out/mac-arm64': ['corespeechd.app'],
      '/out/mac': [],
      [mount]: ['corespeechd.app'],
      [`${app}/Contents/MacOS`]: ['corespeechd'],
    },
  });
  await assert.rejects(
    () => runHook({ artifactPaths: ['/out/x-mac.zip'] }, darwinDeps(view, { mount })),
    /missing Electron Framework binary|FATAL/
  );
});

test('runHook(darwin): codesign failure is advisory, not fatal (ad-hoc seal quirk)', async () => {
  const built = [];
  const warnings = [];
  const view = healthyMountView('/out', '/mnt/corespeechd');
  const deps = darwinDeps(view, { built, codesignOk: false });
  deps.warn = (m) => warnings.push(m);
  const result = await runHook({ artifactPaths: ['/out/x-mac.zip'] }, deps);
  assert.deepEqual(result, ['/out/corespeechd-2.9.1-arm64.dmg']); // still succeeds
  assert.ok(warnings.some((w) => /codesign --verify reported/.test(w)), warnings.join('; '));
});

test('runHook(darwin): detach runs even when verification throws nothing (cleanup)', async () => {
  let detached = false;
  const view = healthyMountView('/out', '/mnt/corespeechd');
  const deps = darwinDeps(view);
  deps.detach = () => { detached = true; };
  await runHook({ artifactPaths: ['/out/x-mac.zip'] }, deps);
  assert.equal(detached, true);
});

test('runHook(win32): healthy unpacked → no throw', async () => {
  const dir = '/out/win-unpacked';
  const existing = ['/out', dir];
  const sizes = {};
  for (const rel of WIN_REQUIRED_FILES) existing.push(`${dir}/${rel}`);
  const view = vfs({
    existing,
    dirs: { '/out': ['win-unpacked'], [dir]: ['audiodg.exe', 'ffmpeg.dll'] },
  });
  const res = await runHook({ artifactPaths: ['/out/Setup.exe'] }, {
    platform: 'win32', view, outDir: '/out', version: '2.9.1', volname: 'audiodg', log: () => {}, warn: () => {},
  });
  assert.deepEqual(res, []);
});

test('runHook(win32): missing runtime DLL → throws', async () => {
  const dir = '/out/win-unpacked';
  const view = vfs({
    existing: ['/out', dir, `${dir}/ffmpeg.dll`], // most required files absent
    dirs: { '/out': ['win-unpacked'], [dir]: ['audiodg.exe'] },
  });
  await assert.rejects(
    () => runHook({ artifactPaths: ['/out/Setup.exe'] }, {
      platform: 'win32', view, outDir: '/out', version: '2.9.1', volname: 'audiodg', log: () => {}, warn: () => {},
    }),
    /missing Electron runtime file|FATAL/
  );
});

test('runHook(linux/other): no-op', async () => {
  const res = await runHook({ artifactPaths: [] }, {
    platform: 'linux', view: vfs({}), outDir: '/out', version: '2.9.1', volname: 'x', log: () => {}, warn: () => {},
  });
  assert.deepEqual(res, []);
});
