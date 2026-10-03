// Profile-dir migration (utils/migrateUserData): the packaged profile moves
// off the brand name exactly once, atomically, and never breaks startup.
// Contract tests over the pure decide() matrix plus the runner with a fake fs.
// Imports COMPILED output from dist-electron (npm run build:electron first),
// like the other utils suites.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => path.join(here, '../../../dist-electron/electron/utils', p);
const m = require(dist('migrateUserData.js'));
const {
  decideProfileMigration,
  isLegacyMainProcessName,
  profileDirNameForPlatform,
  runProfileMigration,
  PROFILE_MIGRATION_RECEIPT,
  legacyMainExeNames,
  defaultScanLegacyInstance,
} = m;

// --- mapping ---------------------------------------------------------------

test('target dir names track the per-platform disguise (mirrors disguise-name.cjs)', () => {
  assert.equal(profileDirNameForPlatform('darwin'), 'corespeechd');
  assert.equal(profileDirNameForPlatform('win32'), 'audiodg');
  assert.equal(profileDirNameForPlatform('linux'), 'Natively');
  const disguise = createRequire(import.meta.url)('../../../scripts/disguise-name.cjs');
  assert.equal(profileDirNameForPlatform('darwin'), disguise.darwin);
  assert.equal(profileDirNameForPlatform('win32'), disguise.win32);
});

test('legacy main-exe names: main only, never helpers', () => {
  assert.deepEqual(legacyMainExeNames('darwin'), ['Natively']);
  assert.deepEqual(legacyMainExeNames('win32'), ['natively.exe']);
  assert.ok(isLegacyMainProcessName('Natively', 'darwin'));
  assert.ok(!isLegacyMainProcessName('Natively Helper', 'darwin'));
  assert.ok(!isLegacyMainProcessName('Natively Helper (GPU)', 'darwin'));
  assert.ok(!isLegacyMainProcessName('corespeechd', 'darwin'));
  assert.ok(!isLegacyMainProcessName('', 'darwin'));
  assert.ok(isLegacyMainProcessName('natively.exe', 'win32'));
  assert.ok(isLegacyMainProcessName('NATIVELY.EXE', 'win32'));
  assert.ok(!isLegacyMainProcessName('Natively Helper.exe', 'win32'));
  assert.ok(!isLegacyMainProcessName('audiodg.exe', 'win32'));
  assert.ok(!isLegacyMainProcessName('', 'win32'));
});

test('ps comm lines print full paths on macOS — basename first', () => {
  const { psLineBasename } = m;
  assert.equal(psLineBasename('/Applications/Natively.app/Contents/MacOS/Natively'), 'Natively');
  assert.equal(psLineBasename('/sbin/launchd'), 'launchd');
  assert.equal(psLineBasename('corespeechd'), 'corespeechd');
  assert.equal(psLineBasename(''), '');
  assert.ok(isLegacyMainProcessName(psLineBasename('/Applications/Natively.app/Contents/MacOS/Natively'), 'darwin'));
  assert.ok(!isLegacyMainProcessName(psLineBasename('/sbin/launchd'), 'darwin'));
});

// --- decide() matrix --------------------------------------------------------

const base = (over = {}) => ({
  packaged: true,
  sameName: false,
  legacyExists: true,
  legacyEmpty: false,
  newExists: false,
  newEmpty: true,
  receiptPresent: false,
  liveOldInstance: false,
  ...over,
});

test('unpackaged builds never touch anything', () => {
  const d = decideProfileMigration({ packaged: false });
  assert.equal(d.kind, 'skipped-dev');
  assert.equal(d.setPath, false);
  assert.equal(d.doRename, false);
});

test('platforms without an alias keep the explicit legacy pin', () => {
  const d = decideProfileMigration(base({ sameName: true }));
  assert.equal(d.kind, 'pinned-legacy-name');
  assert.equal(d.setPath, true);
  assert.equal(d.doRename, false);
});

test('receipt present: already migrated, no fs writes', () => {
  const d = decideProfileMigration(base({ receiptPresent: true }));
  assert.equal(d.kind, 'already-migrated');
  assert.equal(d.doRename, false);
  assert.equal(d.writeReceipt, false);
});

test('populated new dir without receipt: adopt it, never merge or delete', () => {
  const d = decideProfileMigration(base({ newExists: true, newEmpty: false }));
  assert.equal(d.kind, 'adopted-existing');
  assert.equal(d.doRename, false);
  assert.equal(d.writeReceipt, true);
});

test('no legacy dir: fresh install goes straight to the new dir', () => {
  const d = decideProfileMigration(base({ legacyExists: false }));
  assert.equal(d.kind, 'fresh');
  assert.equal(d.doRename, false);
});

test('empty legacy husk: use new dir, leave the husk in place', () => {
  const d = decideProfileMigration(base({ legacyEmpty: true }));
  assert.equal(d.kind, 'empty-legacy');
  assert.equal(d.doRename, false);
});

test('live old instance: defer to legacy this launch (its lock still governs)', () => {
  const d = decideProfileMigration(base({ liveOldInstance: true }));
  assert.equal(d.kind, 'deferred-live-instance');
  assert.equal(d.doRename, false);
});

test('scan failure: conservative defer, never migrate blind', () => {
  const d = decideProfileMigration(base({ liveOldInstance: null }));
  assert.equal(d.kind, 'deferred-unknown');
  assert.equal(d.doRename, false);
});

test('clean legacy, no new dir, no live instance: the one true migration', () => {
  const d = decideProfileMigration(base({}));
  assert.equal(d.kind, 'migrated');
  assert.equal(d.doRename, true);
  assert.equal(d.writeReceipt, true);
});

// --- runner with fake fs -----------------------------------------------------

function fakeFs(initial = {}) {
  // initial: { path: 'dir' | 'file:<content>' | 'empty-dir' }
  const files = new Map(Object.entries(initial));
  const calls = [];
  const isDir = (v) => v === 'dir' || v === 'empty-dir';
  return {
    calls,
    existsSync: (p) => files.has(p),
    readdirSync: (p) => {
      if (!files.has(p) || !isDir(files.get(p))) throw new Error(`ENOENT ${p}`);
      return files.get(p) === 'empty-dir' ? [] : ['settings.json'];
    },
    renameSync: (o, n) => {
      calls.push(['rename', o, n]);
      if (!files.has(o)) throw new Error(`ENOENT ${o}`);
      if (files.has(n)) throw new Error(`EEXIST ${n}`);
      files.set(n, files.get(o));
      files.delete(o);
    },
    rmdirSync: (p) => {
      calls.push(['rmdir', p]);
      if (!files.has(p)) throw new Error(`ENOENT ${p}`);
      if (!isDir(files.get(p)) || files.get(p) !== 'empty-dir') throw new Error(`ENOTEMPTY ${p}`);
      files.delete(p);
    },
    writeFileSync: (p, d) => {
      calls.push(['write', p]);
      files.set(p, `file:${d}`);
    },
    has: (p) => files.has(p),
  };
}

const posixJoin = (...parts) => parts.join('/');
const deps = (over = {}) => ({
  platform: 'darwin',
  isPackaged: true,
  appDataDir: '/Users/u/Library/Application Support',
  join: posixJoin,
  fs: fakeFs(),
  scanLegacyInstance: () => false,
  log: () => {},
  ...over,
});

test('runner: dev never touches setPath', () => {
  const d = deps({ isPackaged: false });
  const { action, dir } = runProfileMigration(d);
  assert.equal(action.kind, 'skipped-dev');
  assert.equal(dir, null);
});

test('runner: full migration renames, writes receipt, returns new dir', () => {
  const fsp = fakeFs({ '/Users/u/Library/Application Support/Natively': 'dir' });
  const d = deps({ fs: fsp });
  const { action, dir } = runProfileMigration(d);
  assert.equal(action.kind, 'migrated');
  assert.equal(dir, '/Users/u/Library/Application Support/corespeechd');
  assert.deepEqual(fsp.calls[0], ['rename',
    '/Users/u/Library/Application Support/Natively',
    '/Users/u/Library/Application Support/corespeechd']);
  assert.ok(fsp.calls.some((c) => c[0] === 'write' && c[1].endsWith(PROFILE_MIGRATION_RECEIPT)));
  assert.ok(!fsp.has('/Users/u/Library/Application Support/Natively'));
  assert.ok(fsp.has('/Users/u/Library/Application Support/corespeechd'));
});

test('runner: live old instance → legacy dir, zero writes', () => {
  const fsp = fakeFs({ '/Users/u/Library/Application Support/Natively': 'dir' });
  const d = deps({ fs: fsp, scanLegacyInstance: () => true });
  const { action, dir } = runProfileMigration(d);
  assert.equal(action.kind, 'deferred-live-instance');
  assert.equal(dir, '/Users/u/Library/Application Support/Natively');
  assert.deepEqual(fsp.calls, []);
  assert.ok(fsp.has('/Users/u/Library/Application Support/Natively'));
});

test('runner: scan failure → legacy dir, zero writes', () => {
  const fsp = fakeFs({ '/Users/u/Library/Application Support/Natively': 'dir' });
  const d = deps({ fs: fsp, scanLegacyInstance: () => null });
  const { action, dir } = runProfileMigration(d);
  assert.equal(action.kind, 'deferred-unknown');
  assert.equal(dir, '/Users/u/Library/Application Support/Natively');
  assert.deepEqual(fsp.calls, []);
});

test('runner: rename failure aborts to legacy (status quo)', () => {
  const fsp = fakeFs({ '/Users/u/Library/Application Support/Natively': 'dir' });
  fsp.renameSync = () => { throw new Error('EPERM'); };
  const d = deps({ fs: fsp });
  const { action, dir } = runProfileMigration(d);
  assert.equal(action.kind, 'aborted');
  assert.equal(dir, '/Users/u/Library/Application Support/Natively');
  assert.ok(fsp.has('/Users/u/Library/Application Support/Natively'));
});

test('runner: receipt failures still land on the new dir', () => {
  const fsp = fakeFs({ '/Users/u/Library/Application Support/Natively': 'dir' });
  fsp.writeFileSync = () => { throw new Error('ENOSPC'); };
  const d = deps({ fs: fsp });
  const { action, dir } = runProfileMigration(d);
  assert.equal(action.kind, 'migrated');
  assert.equal(dir, '/Users/u/Library/Application Support/corespeechd');
});

test('runner: empty new-dir husk is removed before rename', () => {
  const app = '/Users/u/Library/Application Support';
  const fsp = fakeFs({ [`${app}/Natively`]: 'dir', [`${app}/corespeechd`]: 'empty-dir' });
  const d = deps({ fs: fsp });
  const { action, dir } = runProfileMigration(d);
  assert.equal(action.kind, 'migrated');
  assert.equal(dir, `${app}/corespeechd`);
  assert.deepEqual(fsp.calls[0], ['rmdir', `${app}/corespeechd`]);
});

test('runner: windows target is audiodg', () => {
  const app = 'C:/Users/u/AppData/Roaming';
  const fsp = fakeFs({ [`${app}/Natively`]: 'dir' });
  const d = deps({ platform: 'win32', appDataDir: app, fs: fsp });
  const { action, dir } = runProfileMigration(d);
  assert.equal(action.kind, 'migrated');
  assert.equal(dir, `${app}/audiodg`);
});

test('live default scanner runs against real ps without throwing', () => {
  const r = defaultScanLegacyInstance(process.platform);
  assert.ok(r === true || r === false || r === null);
});

test('runner: unexpected join throw → aborted, dir null, never throws out', () => {
  const d = deps({ join: () => { throw new Error('boom'); } });
  let out;
  assert.doesNotThrow(() => { out = runProfileMigration(d); });
  assert.equal(out.action.kind, 'aborted');
  assert.equal(out.dir, null);
});
