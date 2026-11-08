// Ambient AI Chat is turned off once when this version is installed over an
// older one (2026-10-27).
//
// With Ambient AI Chat on, a meeting never starts capture or STT, and the
// builds before the overlay's "Ambient" chip showed nothing about it: the
// overlay read "Listening..." while nothing was transcribed. Two users filed
// that as a transcription bug in one week (#679, #696). The setting is reset to
// off the first time this version loads an older settings.json. The reset runs
// once: a user who turns it back on afterwards keeps it on across restarts.
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

/** A fresh SettingsManager over `dir`, as a new app launch would create it. */
function launch(dir) {
  const origLoad = Module._load;
  Module._load = function patched(request) {
    if (request === 'electron') {
      return { app: { getPath: () => dir, isPackaged: false, getAppPath: () => dir, isReady: () => true, on: () => {} } };
    }
    if (request.endsWith('.node') || request.includes('native-module')) return {};
    return origLoad.apply(this, arguments);
  };
  try {
    delete globalThis.__nativelySettingsManagerV1__;
    delete require_.cache[require_.resolve(dist)];
    return require_(dist).SettingsManager.getInstance();
  } finally {
    Module._load = origLoad;
  }
}

function tempUserData(settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambient-upgrade-'));
  if (settings !== undefined) fs.writeFileSync(path.join(dir, 'settings.json'), settings);
  return dir;
}

const readDisk = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));

test('an older install with Ambient AI Chat on loads with it off, on disk too', () => {
  const dir = tempUserData(JSON.stringify({ ambientChatEnabled: true, interfaceTheme: 'dark' }));
  const sm = launch(dir);
  assert.equal(sm.get('ambientChatEnabled'), false);
  assert.equal(readDisk(dir).ambientChatEnabled, false, 'the reset must be persisted, not only in memory');
  assert.equal(readDisk(dir).interfaceTheme, 'dark', 'other settings are kept');
});

test('the reset runs once: turned back on after the upgrade, it stays on', () => {
  const dir = tempUserData(JSON.stringify({ ambientChatEnabled: true }));
  launch(dir).set('ambientChatEnabled', true);
  assert.equal(launch(dir).get('ambientChatEnabled'), true);
  assert.equal(launch(dir).get('ambientChatEnabled'), true);
});

test('an older install with it off: turning it on later survives a restart', () => {
  // The marker is only in memory after this launch (nothing needed writing),
  // so it must ride along with the set() that turns the setting on.
  const dir = tempUserData(JSON.stringify({ ambientChatEnabled: false, interfaceTheme: 'dark' }));
  const sm = launch(dir);
  assert.equal(sm.get('ambientChatEnabled'), false);
  sm.set('ambientChatEnabled', true);
  assert.equal(launch(dir).get('ambientChatEnabled'), true);
});

test('a fresh install starts with it off, and an opt-in survives a restart', () => {
  const dir = tempUserData();
  const sm = launch(dir);
  assert.equal(sm.get('ambientChatEnabled') ?? false, false);
  assert.equal(fs.existsSync(path.join(dir, 'settings.json')), false,
    'loading must not create settings.json on a fresh install');
  sm.set('ambientChatEnabled', true);
  assert.equal(launch(dir).get('ambientChatEnabled'), true);
});

test('after a corrupt settings.json is quarantined, an opt-in survives a restart', () => {
  const dir = tempUserData('{"ambientChatEnabled":tr');
  const sm = launch(dir);
  assert.equal(sm.get('ambientChatEnabled') ?? false, false);
  sm.set('ambientChatEnabled', true);
  assert.equal(launch(dir).get('ambientChatEnabled'), true);
});
