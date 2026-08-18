// F-703 regression test (audit/autopilot-2026-08-18).
//
// loadSettings() caught a parse failure with `this.settings = {}` and no
// degraded flag, leaving the recoverable file on disk. The next set() — which
// ~15 IPC handlers can trigger, so the first toggle after launch — serialized
// that empty-plus-one object over settings.json, destroying every user setting
// (~60 keys incl. API/CLI paths, retention, provider scopes, onboarding state).
// Measured pre-fix: a truncated settings.json became {"interfaceTheme":"light"}.
//
// The same codebase already treats this as unacceptable for credentials:
// CredentialsManager latches keyringUnreadable and refuses every write for the
// session precisely so "saving would overwrite it with an incomplete set".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../../../dist-electron/electron/services/SettingsManager.js');

function withUserData(dir, fn) {
  const origLoad = Module._load;
  Module._load = function patched(request) {
    if (request === 'electron') {
      return { app: { getPath: () => dir, isPackaged: false, getAppPath: () => dir, isReady: () => true, on: () => {} } };
    }
    if (request.endsWith('.node') || request.includes('native-module')) return {};
    return origLoad.apply(this, arguments);
  };
  try { return fn(); } finally { Module._load = origLoad; }
}

test('a corrupt settings.json is preserved, not overwritten by the next set()', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f703-test-'));
  const file = path.join(tmp, 'settings.json');
  const CORRUPT = '{"interfaceTheme":"dark","meetingRetention":"forev';
  fs.writeFileSync(file, CORRUPT);

  withUserData(tmp, () => {
    delete globalThis.__nativelySettingsManagerV1__;
    delete require_.cache[require_.resolve(dist)];
    const { SettingsManager } = require_(dist);
    const sm = SettingsManager.getInstance();
    assert.equal(sm.isDegraded?.(), true, 'an unreadable settings file must latch degraded mode');
    sm.set('interfaceTheme', 'light');
    assert.equal(fs.readFileSync(file, 'utf8'), CORRUPT,
      'the unreadable file must be left intact for repair (F-703)');
  });
});

test('a fresh profile with no settings file still writes normally', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f703-fresh-'));
  const file = path.join(tmp, 'settings.json');

  withUserData(tmp, () => {
    delete globalThis.__nativelySettingsManagerV1__;
    delete require_.cache[require_.resolve(dist)];
    const { SettingsManager } = require_(dist);
    const sm = SettingsManager.getInstance();
    assert.notEqual(sm.isDegraded?.(), true, 'first run must NOT be treated as degraded');
    sm.set('interfaceTheme', 'light');
    assert.ok(fs.existsSync(file), 'a fresh profile must still persist settings');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).interfaceTheme, 'light');
  });
});
