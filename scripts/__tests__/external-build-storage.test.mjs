import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const {
  checkoutScope,
  cleanupReleaseSymlink,
  prepareExternalBuildStorage,
  resolveCargoTargetDir,
  resolveExternalBuildRoot,
} = require('../lib/external-build-storage.cjs');

const quiet = { log() {}, warn() {} };
// Stands in for ditto (macOS only) so the suite runs on any OS.
const fakeDitto = (_cmd, [src, dst]) => fs.cpSync(src, dst, { recursive: true });

function sandbox(name) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `natively-ext-build-${name}-`));
  const volume = path.join(tmp, 'ExternalSSD');
  const optIn = path.join(volume, 'natively-build');
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true }); // a main checkout
  fs.mkdirSync(volume, { recursive: true });
  return { tmp, volume, optIn, repoRoot, done: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

test('resolveExternalBuildRoot is strictly macOS-only and returns null on win32/linux even with override', () => {
  assert.equal(resolveExternalBuildRoot({ env: { NATIVELY_EXTERNAL_BUILD_DIR: '/tmp/x' }, platform: 'win32' }), null);
  assert.equal(resolveExternalBuildRoot({ env: { NATIVELY_EXTERNAL_BUILD_DIR: '/tmp/x' }, platform: 'linux' }), null);
  assert.equal(
    resolveExternalBuildRoot({
      env: { NATIVELY_DISABLE_EXTERNAL_BUILD: '1', NATIVELY_EXTERNAL_BUILD_DIR: '/tmp/x' },
      platform: 'darwin',
    }),
    null
  );
  assert.equal(resolveExternalBuildRoot({ env: { CI: 'true' }, platform: 'darwin', candidates: ['/tmp'] }), null);
});

test('opt-in: a drive with the right name but no natively-build folder is never used', () => {
  const s = sandbox('optin');
  try {
    const opts = { env: {}, platform: 'darwin', candidates: [s.volume] };
    assert.equal(resolveExternalBuildRoot(opts), null);
    assert.equal(prepareExternalBuildStorage({ ...opts, repoRoot: s.repoRoot, log: quiet }), null);
    assert.equal(fs.existsSync(s.optIn), false, 'nothing created on the drive');
    fs.mkdirSync(s.optIn);
    assert.equal(resolveExternalBuildRoot(opts), path.join(s.optIn, ''));
  } finally {
    s.done();
  }
});

test('linked worktrees get their own folder; the main checkout keeps the root layout', () => {
  const s = sandbox('scope');
  try {
    fs.mkdirSync(s.optIn);
    const wt = (dir) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n');
      return dir;
    };
    const a = wt(path.join(s.tmp, 'one', 'natively-issue-1'));
    const b = wt(path.join(s.tmp, 'two', 'natively-issue-1')); // same folder name, other place
    const opts = { env: {}, platform: 'darwin', candidates: [s.volume] };
    const main = resolveExternalBuildRoot({ ...opts, repoRoot: s.repoRoot });
    const rootA = resolveExternalBuildRoot({ ...opts, repoRoot: a });
    const rootB = resolveExternalBuildRoot({ ...opts, repoRoot: b });
    assert.equal(main, path.join(s.optIn, ''));
    assert.equal(checkoutScope(s.repoRoot), '');
    assert.match(path.relative(s.optIn, rootA), /^worktrees[\\/]natively-issue-1-[0-9a-f]{8}$/);
    assert.notEqual(rootA, rootB);
    assert.equal(resolveExternalBuildRoot({ ...opts, repoRoot: a }), rootA, 'stable');
    // The explicit override is scoped the same way.
    assert.equal(
      resolveExternalBuildRoot({ env: { NATIVELY_EXTERNAL_BUILD_DIR: s.optIn }, platform: 'darwin', repoRoot: a }),
      rootA
    );
    // Cargo output follows the checkout too.
    assert.equal(resolveCargoTargetDir({ ...opts, repoRoot: a }), path.join(rootA, 'cargo-target'));
    assert.notEqual(resolveCargoTargetDir({ ...opts, repoRoot: a }), resolveCargoTargetDir({ ...opts, repoRoot: s.repoRoot }));
  } finally {
    s.done();
  }
});

test('resolveCargoTargetDir: CARGO_TARGET_DIR wins, then external storage, else null (native-module/target)', () => {
  const s = sandbox('cargo');
  try {
    const opts = { platform: 'darwin', candidates: [s.volume], repoRoot: s.repoRoot };
    assert.equal(resolveCargoTargetDir({ ...opts, env: {} }), null);
    fs.mkdirSync(s.optIn);
    assert.equal(resolveCargoTargetDir({ ...opts, env: {} }), path.join(s.optIn, 'cargo-target'));
    assert.equal(resolveCargoTargetDir({ ...opts, env: { CARGO_TARGET_DIR: '/x/target' } }), path.resolve('/x/target'));
    assert.equal(resolveCargoTargetDir({ ...opts, platform: 'win32', env: {} }), null);
  } finally {
    s.done();
  }
});

test('prepareExternalBuildStorage moves an existing local release folder and links it, on darwin only; unplugged falls back', () => {
  const s = sandbox('migrate');
  try {
    fs.mkdirSync(s.optIn);
    fs.mkdirSync(path.join(s.repoRoot, 'release'), { recursive: true });
    fs.writeFileSync(path.join(s.repoRoot, 'release', 'artifact.txt'), 'signed-dmg-bytes');

    assert.equal(
      prepareExternalBuildStorage({ repoRoot: s.repoRoot, env: { NATIVELY_EXTERNAL_BUILD_DIR: s.optIn }, platform: 'win32', candidates: [s.volume], log: quiet }),
      null,
      'non-darwin is a strict no-op'
    );

    const res = prepareExternalBuildStorage({
      repoRoot: s.repoRoot, env: {}, platform: 'darwin', candidates: [s.volume], execFileSyncImpl: fakeDitto, log: quiet,
    });
    assert.ok(res);
    assert.equal(res.externalRoot, path.join(s.optIn, ''));
    assert.equal(res.releaseDir, path.join(s.optIn, 'release'));
    assert.equal(res.tmpDir, path.join(s.optIn, 'tmp'));
    const localRelease = path.join(s.repoRoot, 'release');
    assert.ok(fs.lstatSync(localRelease).isSymbolicLink());
    assert.equal(fs.readFileSync(path.join(localRelease, 'artifact.txt'), 'utf8'), 'signed-dmg-bytes');

    // Unplugged: the dangling link goes, so electron-builder makes a local folder.
    fs.rmSync(s.volume, { recursive: true, force: true });
    assert.equal(prepareExternalBuildStorage({ repoRoot: s.repoRoot, env: {}, platform: 'darwin', candidates: [s.volume], log: quiet }), null);
    assert.throws(() => fs.lstatSync(localRelease));
  } finally {
    s.done();
  }
});

test('moving a local release over an older external one replaces each entry: no stale files inside the app bundle', () => {
  const s = sandbox('replace');
  try {
    const ext = path.join(s.optIn, 'release');
    fs.mkdirSync(path.join(ext, 'mac-arm64', 'Natively.app', 'Contents'), { recursive: true });
    fs.writeFileSync(path.join(ext, 'mac-arm64', 'Natively.app', 'Contents', 'old-framework'), 'stale');
    fs.writeFileSync(path.join(ext, 'latest-mac.yml'), 'version: 1.0.0');
    fs.writeFileSync(path.join(ext, 'Natively-1.0.0.dmg'), 'old dmg');
    const local = path.join(s.repoRoot, 'release');
    fs.mkdirSync(path.join(local, 'mac-arm64', 'Natively.app', 'Contents'), { recursive: true });
    fs.writeFileSync(path.join(local, 'mac-arm64', 'Natively.app', 'Contents', 'new-framework'), 'fresh');
    fs.writeFileSync(path.join(local, 'latest-mac.yml'), 'version: 2.0.0');

    const res = prepareExternalBuildStorage({
      repoRoot: s.repoRoot, env: {}, platform: 'darwin', candidates: [s.volume], execFileSyncImpl: fakeDitto, log: quiet,
    });
    assert.ok(res);
    const app = path.join(ext, 'mac-arm64', 'Natively.app', 'Contents');
    assert.deepEqual(fs.readdirSync(app), ['new-framework'], 'the older bundle was replaced, not merged');
    assert.equal(fs.readFileSync(path.join(ext, 'latest-mac.yml'), 'utf8'), 'version: 2.0.0');
    assert.equal(fs.readFileSync(path.join(ext, 'Natively-1.0.0.dmg'), 'utf8'), 'old dmg', 'other versions stay');
    assert.ok(fs.lstatSync(local).isSymbolicLink());
  } finally {
    s.done();
  }
});

test('prepareExternalBuildStorage falls back cleanly if the move fails, without deleting the local release', () => {
  const s = sandbox('fail');
  try {
    fs.mkdirSync(s.optIn);
    fs.mkdirSync(path.join(s.repoRoot, 'release'), { recursive: true });
    fs.writeFileSync(path.join(s.repoRoot, 'release', 'keep.txt'), 'preserve-me');
    const res = prepareExternalBuildStorage({
      repoRoot: s.repoRoot, env: {}, platform: 'darwin', candidates: [s.volume],
      execFileSyncImpl: () => { throw new Error('ditto disk full'); },
      log: quiet,
    });
    assert.equal(res, null);
    assert.ok(fs.lstatSync(path.join(s.repoRoot, 'release')).isDirectory());
    assert.equal(fs.readFileSync(path.join(s.repoRoot, 'release', 'keep.txt'), 'utf8'), 'preserve-me');
  } finally {
    s.done();
  }
});

test('NATIVELY_DISABLE_EXTERNAL_BUILD=1 unlinks a live ./release into natively-build; the files on the drive stay', () => {
  const s = sandbox('optout');
  try {
    fs.mkdirSync(path.join(s.optIn, 'release'), { recursive: true });
    fs.writeFileSync(path.join(s.optIn, 'release', 'built.dmg'), 'dmg');
    const localRelease = path.join(s.repoRoot, 'release');
    fs.symlinkSync(path.join(s.optIn, 'release'), localRelease);

    // Without the flag a live link stays.
    assert.equal(cleanupReleaseSymlink(s.repoRoot, { env: {}, log: quiet }), false);
    assert.ok(fs.lstatSync(localRelease).isSymbolicLink());

    const res = prepareExternalBuildStorage({
      repoRoot: s.repoRoot, env: { NATIVELY_DISABLE_EXTERNAL_BUILD: '1' }, platform: 'darwin', candidates: [s.volume], log: quiet,
    });
    assert.equal(res, null);
    assert.throws(() => fs.lstatSync(localRelease), 'link removed: electron-builder writes a local ./release');
    assert.equal(fs.readFileSync(path.join(s.optIn, 'release', 'built.dmg'), 'utf8'), 'dmg');
  } finally {
    s.done();
  }
});

test('NATIVELY_DISABLE_EXTERNAL_BUILD=1 leaves a ./release link the user made elsewhere alone', () => {
  const s = sandbox('optout-other');
  try {
    const elsewhere = path.join(s.tmp, 'my-releases');
    fs.mkdirSync(elsewhere);
    const localRelease = path.join(s.repoRoot, 'release');
    fs.symlinkSync(elsewhere, localRelease);
    assert.equal(cleanupReleaseSymlink(s.repoRoot, { env: { NATIVELY_DISABLE_EXTERNAL_BUILD: '1' }, log: quiet }), false);
    assert.ok(fs.lstatSync(localRelease).isSymbolicLink());
  } finally {
    s.done();
  }
});

test('package-app: on a Mac every target cleans up ./release first, and no output override is passed', () => {
  const src = fs.readFileSync(path.join(here, '..', 'package-app.js'), 'utf8');
  const block = src.slice(src.indexOf("if (process.platform === 'darwin') {\n  const {\n    cleanupReleaseSymlink"), src.indexOf('let builderCode;'));
  assert.ok(block.length > 0, 'the external storage block is there');
  assert.match(block, /if \(targetPlatform === 'darwin'\) \{[\s\S]*prepareExternalBuildStorage\(\{ repoRoot \}\)[\s\S]*\} else \{\s*cleanupReleaseSymlink\(repoRoot\);\s*\}/);
  assert.doesNotMatch(src, /directories\.output=/, 'the ./release symlink routes the output; no override');
  assert.match(src, /run\(resolveElectronBuilderCli\(\), builderArgs\)/);
});
