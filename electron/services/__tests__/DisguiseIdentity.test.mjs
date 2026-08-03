// Disguise identity contract — asserts BOTH platform branches.
//
// These mappings used to live in three places (WindowHelper's launcher icon,
// _applyDisguise's dock/process identity, the tray image). They had already
// drifted on the unpackaged path. The risk is silent: a tray whose icon or
// tooltip disagrees with the window identity is a stealth leak that raises no
// error, so only a test comparing the branches catches it.
//
// disguise.ts takes platform as a parameter precisely so this file can assert
// 'darwin' and 'win32' from a single run, without mutating process.platform.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Module from 'node:module';

// disguise.ts imports electron for app.isPackaged / app.getAppPath(). Stub it
// so this stays a pure unit test with no Electron runtime.
const APP_PATH = '/fake/app';
const originalResolve = Module._resolveFilename;
const stubPath = path.resolve('electron/services/__tests__/__electron_stub.mjs');
Module._resolveFilename = function (request, ...rest) {
  if (request === 'electron') return stubPath;
  return originalResolve.call(this, request, ...rest);
};

const {
  normalizeDisguiseMode,
  disguiseAppName,
  disguiseIconFile,
  disguiseIconPath,
  appIconPath,
  VALID_DISGUISE_MODES,
} = await import('../../../dist-electron/electron/disguise.js');

const DISGUISED = ['terminal', 'settings', 'activity'];

describe('normalizeDisguiseMode', () => {
  test('passes through every valid mode', () => {
    for (const mode of VALID_DISGUISE_MODES) {
      assert.equal(normalizeDisguiseMode(mode), mode);
    }
  });

  test('coerces junk to none — an unknown mode must never paint a fake icon', () => {
    for (const junk of ['Terminal', 'TERMINAL', 'chrome', '', null, undefined, 42, {}, []]) {
      assert.equal(normalizeDisguiseMode(junk), 'none');
    }
  });
});

describe('disguiseAppName', () => {
  test('darwin and win32 give DIFFERENT names for every disguised mode', () => {
    // The whole point of the disguise is to imitate the host OS's own process.
    // If a branch ever returned the macOS name on Windows, the disguise would
    // name a process that does not exist on that OS — an obvious tell.
    for (const mode of DISGUISED) {
      const mac = disguiseAppName(mode, 'darwin');
      const win = disguiseAppName(mode, 'win32');
      assert.notEqual(mac, win, `${mode} should differ per platform`);
    }
  });

  test('imitates real OS process names', () => {
    assert.equal(disguiseAppName('terminal', 'darwin').trim(), 'Terminal');
    assert.equal(disguiseAppName('terminal', 'win32').trim(), 'Command Prompt');
    assert.equal(disguiseAppName('settings', 'darwin').trim(), 'System Settings');
    assert.equal(disguiseAppName('settings', 'win32').trim(), 'Settings');
    assert.equal(disguiseAppName('activity', 'darwin').trim(), 'Activity Monitor');
    assert.equal(disguiseAppName('activity', 'win32').trim(), 'Task Manager');
  });

  test('every disguised name carries the deliberate trailing space', () => {
    // Load-bearing: keeps the disguised process identity from colliding
    // byte-for-byte with the real OS process it imitates. Tooltips trim it;
    // process.title / app.setName() must not.
    for (const mode of DISGUISED) {
      for (const platform of ['darwin', 'win32']) {
        const name = disguiseAppName(mode, platform);
        assert.ok(name.endsWith(' '), `${mode}/${platform} lost its trailing space`);
        assert.equal(name.trim().length > 0, true);
      }
    }
  });

  test("'none' is the real app name on both platforms, with NO trailing space", () => {
    assert.equal(disguiseAppName('none', 'darwin'), 'Natively');
    assert.equal(disguiseAppName('none', 'win32'), 'Natively');
  });
});

describe('disguiseIconFile', () => {
  test('every disguised mode maps to a distinct asset; none maps to null', () => {
    const files = DISGUISED.map(disguiseIconFile);
    assert.equal(new Set(files).size, files.length, 'two modes share an icon');
    assert.equal(disguiseIconFile('none'), null);
  });
});

describe('disguiseIconPath', () => {
  test('routes to the platform asset directory', () => {
    for (const mode of DISGUISED) {
      assert.match(disguiseIconPath(mode, 'win32').replaceAll('\\', '/'), /assets\/fakeicon\/win\//);
      assert.match(disguiseIconPath(mode, 'darwin').replaceAll('\\', '/'), /assets\/fakeicon\/mac\//);
    }
  });

  test("returns null for 'none' so callers fall back to the real app icon", () => {
    assert.equal(disguiseIconPath('none', 'win32'), null);
    assert.equal(disguiseIconPath('none', 'darwin'), null);
  });

  test('unpackaged paths are rooted at getAppPath(), not a bundle-depth guess', () => {
    // The old WindowHelper copy used path.resolve(__dirname, '../../assets/..'),
    // which only worked because the esbuild output happened to sit exactly two
    // levels below the repo root. Anchoring on getAppPath() removes that
    // coupling to the bundle layout.
    const p = disguiseIconPath('terminal', 'win32').replaceAll('\\', '/');
    assert.ok(p.startsWith(APP_PATH), `expected ${APP_PATH} prefix, got ${p}`);
  });
});

describe('appIconPath', () => {
  test('each platform gets its own real-icon format', () => {
    assert.match(appIconPath('darwin').replaceAll('\\', '/'), /natively\.icns$/);
    assert.match(appIconPath('win32').replaceAll('\\', '/'), /icon\.ico$/);
  });
});

describe('cross-branch consistency', () => {
  test('every mode resolves BOTH a name and an icon on BOTH platforms', () => {
    // Guards the actual failure mode of adding a disguise mode: a mapping that
    // covers one lookup but not another ships a tray whose icon disagrees with
    // the window identity, with no error anywhere.
    for (const mode of VALID_DISGUISE_MODES) {
      for (const platform of ['darwin', 'win32']) {
        const name = disguiseAppName(mode, platform);
        assert.ok(typeof name === 'string' && name.trim().length > 0, `${mode}/${platform} name`);

        const icon = disguiseIconPath(mode, platform) ?? appIconPath(platform);
        assert.ok(typeof icon === 'string' && icon.length > 0, `${mode}/${platform} icon`);
      }
    }
  });
});
