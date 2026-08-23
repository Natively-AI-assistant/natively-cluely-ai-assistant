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
//
// CONTRACT CORRECTED 2026-08-18 (audit R-15). F-703's read-only latch was the
// wrong mechanism: a file that cannot be PARSED will never parse, so "read-only
// for this session" was read-only on EVERY session, forever, with nothing to
// clear the flag and no caller of isDegraded(). A 0-byte / whitespace-only /
// "null" / BOM-prefixed settings.json permanently bricked the settings store —
// and saveSettings' missing fsync is one of the ways such a file is created.
//
// The requirement is unchanged: NEVER destroy a recoverable file. It is now met
// by QUARANTINE — the original bytes are moved aside under a timestamped name
// and the store continues writable, so the app self-heals. Measured three ways
// on the same input: baseline OVERWROTE the file (data lost), F-703 refused
// every write (store bricked), the fix preserves the bytes AND persists.
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

test('a corrupt settings.json is quarantined intact, and the store keeps working', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f703-test-'));
  const file = path.join(tmp, 'settings.json');
  const CORRUPT = '{"interfaceTheme":"dark","meetingRetention":"forev';
  fs.writeFileSync(file, CORRUPT);

  withUserData(tmp, () => {
    delete globalThis.__nativelySettingsManagerV1__;
    delete require_.cache[require_.resolve(dist)];
    const { SettingsManager } = require_(dist);
    const sm = SettingsManager.getInstance();
    // Quarantine succeeded, so the store is NOT degraded — that is the point.
    assert.notEqual(sm.isDegraded?.(), true,
      'a quarantined file must leave the store writable so the app self-heals');
    sm.set('interfaceTheme', 'light');

    // The recoverable bytes must still exist somewhere, byte-for-byte.
    const quarantined = fs.readdirSync(tmp).filter((f) => f.includes('.corrupt-'));
    assert.equal(quarantined.length, 1, 'the unreadable file must be moved aside, not deleted');
    assert.equal(fs.readFileSync(path.join(tmp, quarantined[0]), 'utf8'), CORRUPT,
      'the quarantined file must be byte-identical to the original (R-15)');

    // And the write must actually have landed.
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).interfaceTheme, 'light',
      'the store must accept writes after quarantine');
  });
});

test('a settings file that cannot be quarantined falls back to refusing writes', () => {
  // If the rename fails we cannot move the file, so we must not overwrite it
  // either — F-703's conservative stance is still correct in that corner.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f703-noquar-'));
  const file = path.join(tmp, 'settings.json');
  const CORRUPT = '{"interfaceTheme":"dark","meetingRetention":"forev';
  fs.writeFileSync(file, CORRUPT);

  const realRename = fs.renameSync;
  fs.renameSync = () => { throw new Error('EPERM: simulated rename failure'); };
  try {
    withUserData(tmp, () => {
      delete globalThis.__nativelySettingsManagerV1__;
      delete require_.cache[require_.resolve(dist)];
      const { SettingsManager } = require_(dist);
      const sm = SettingsManager.getInstance();
      assert.equal(sm.isDegraded?.(), true, 'an un-quarantinable file must latch degraded mode');
      sm.set('interfaceTheme', 'light');
      assert.equal(fs.readFileSync(file, 'utf8'), CORRUPT,
        'the un-quarantinable file must be left intact for repair');
      assert.notEqual(sm.get('interfaceTheme'), 'light',
        'a refused write must NOT be applied in memory either, or memory diverges from disk (R-15)');
    });
  } finally {
    fs.renameSync = realRename;
  }
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
