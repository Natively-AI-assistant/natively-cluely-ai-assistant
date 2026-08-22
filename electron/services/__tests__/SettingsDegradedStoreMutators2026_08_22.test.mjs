// CR-04 (code-review, 2026-08-21): R-15 added the degraded-store refusal to the
// generic set(), but setContextDebugLevel and setScreenUnderstandingMode mutated
// this.settings DIRECTLY and then called saveSettings(), which refuses. So
// memory and disk diverged, the IPC handler reported success, and the setting
// silently reverted on restart. For screenUnderstandingMode it was worse: the
// handler also broadcast screen-understanding-mode-changed to every window, so
// the whole UI switched mode over an unchanged disk.
//
// This uses a REAL settings.json made REALLY unreadable (mode 000 → EACCES),
// which is the reachable path the review named: a plain read error, common on
// Windows with AV or a locked profile. No stubbing of the failure.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cr04-settings-'));
const settingsPath = path.join(userData, 'settings.json');

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => userData, getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};
const { SettingsManager } = require(dist('services/SettingsManager.js'));
const SLOT = '__nativelySettingsManagerV1__';

// The user's real, populated settings file.
const ORIGINAL = { screenUnderstandingMode: 'vision_first', contextDebugLevel: 'off', someUserKey: 'keep-me' };

const freshManager = () => {
  delete globalThis[SLOT];
  SettingsManager.instance = undefined;
  return SettingsManager.getInstance();
};
const diskNow = () => {
  fs.chmodSync(settingsPath, 0o600);
  const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  return raw;
};

after(() => { try { fs.chmodSync(settingsPath, 0o600); fs.rmSync(userData, { recursive: true, force: true }); } catch {} });

describe('a degraded settings store must refuse the TYPED setters too', () => {
  let sm;
  before(() => {
    fs.writeFileSync(settingsPath, JSON.stringify(ORIGINAL, null, 2));
    fs.chmodSync(settingsPath, 0o000);   // real EACCES on read
    sm = freshManager();
  });

  test('the store really is degraded (the read genuinely failed)', () => {
    assert.equal(sm.isDegraded(), true,
      'precondition: an unreadable settings.json must put the manager in degraded mode');
  });

  test('setScreenUnderstandingMode reports refusal instead of false success', () => {
    assert.equal(sm.setScreenUnderstandingMode('vision_only'), false,
      'a refused write must be reported, or the IPC handler broadcasts a mode change over an unchanged disk');
  });

  test('setContextDebugLevel reports refusal instead of false success', () => {
    assert.equal(sm.setContextDebugLevel('verbose'), false);
  });

  test("the user's real settings file is untouched on disk", () => {
    assert.deepEqual(diskNow(), ORIGINAL,
      'the whole point of the degraded guard: a file we could not read must never be overwritten');
    fs.chmodSync(settingsPath, 0o000);
  });

  test('memory did not diverge from disk', () => {
    // Pre-fix, memory said 'vision_only'/'verbose' while disk said otherwise.
    assert.notEqual(sm.getScreenUnderstandingMode(), 'vision_only',
      'memory must not hold a value that was never persisted');
    assert.notEqual(sm.getContextDebugLevel(), 'verbose');
  });
});

describe('a HEALTHY store still persists through the same setters', () => {
  let sm;
  before(() => {
    fs.chmodSync(settingsPath, 0o600);
    fs.writeFileSync(settingsPath, JSON.stringify(ORIGINAL, null, 2));
    sm = freshManager();
  });

  test('not degraded when the file is readable', () => {
    assert.equal(sm.isDegraded(), false);
  });

  test('setScreenUnderstandingMode persists and reports success', () => {
    assert.equal(sm.setScreenUnderstandingMode('vision_only'), true);
    assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).screenUnderstandingMode, 'vision_only',
      'the fix must not break the ordinary write path');
  });

  test('setContextDebugLevel persists and reports success', () => {
    assert.equal(sm.setContextDebugLevel('verbose'), true);
    assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).contextDebugLevel, 'verbose');
  });

  test('unrelated user keys survive the write', () => {
    assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).someUserKey, 'keep-me');
  });
});
