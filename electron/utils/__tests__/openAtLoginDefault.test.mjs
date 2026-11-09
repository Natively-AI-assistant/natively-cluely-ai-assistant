// "Open Natively when you log in" defaults on for fresh installs, written to the
// OS once. Platform is injected, so the macOS and Windows branches run on either OS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { decideOpenAtLoginDefault } = require(path.join(repoRoot, 'dist-electron/electron/utils/openAtLoginDefault.js'));

const base = { state: undefined, freshInstall: true, isPackaged: true, inApplicationsFolder: true, isPortable: false };

test('fresh macOS install in /Applications: turned on once', () => {
  assert.deepEqual(decideOpenAtLoginDefault({ ...base, platform: 'darwin' }), { enable: true, nextState: 'done' });
});

test('fresh Windows NSIS install: turned on once', () => {
  assert.deepEqual(decideOpenAtLoginDefault({ ...base, platform: 'win32', inApplicationsFolder: false }), { enable: true, nextState: 'done' });
});

test('done never re-enables (the user turned it off afterwards)', () => {
  for (const platform of ['darwin', 'win32']) {
    assert.deepEqual(decideOpenAtLoginDefault({ ...base, platform, state: 'done', freshInstall: true }), { enable: false, nextState: null });
  }
});

test('an upgraded install is left alone and marked done', () => {
  for (const platform of ['darwin', 'win32']) {
    assert.deepEqual(decideOpenAtLoginDefault({ ...base, platform, freshInstall: false }), { enable: false, nextState: 'done' });
  }
});

test('macOS launched from the DMG / translocated: waits, then applies from /Applications', () => {
  const first = decideOpenAtLoginDefault({ ...base, platform: 'darwin', inApplicationsFolder: false });
  assert.deepEqual(first, { enable: false, nextState: 'pending' });
  // Second launch, still outside: no rewrite.
  assert.deepEqual(decideOpenAtLoginDefault({ ...base, platform: 'darwin', state: 'pending', freshInstall: false, inApplicationsFolder: false }),
    { enable: false, nextState: null });
  // Moved to /Applications: settings.json now exists, but pending still applies.
  assert.deepEqual(decideOpenAtLoginDefault({ ...base, platform: 'darwin', state: 'pending', freshInstall: false }),
    { enable: true, nextState: 'done' });
});

test('Windows portable exe: never registered (its exe path is a temp extraction)', () => {
  assert.deepEqual(decideOpenAtLoginDefault({ ...base, platform: 'win32', isPortable: true }), { enable: false, nextState: 'done' });
});

test('dev builds: nothing written, nothing marked', () => {
  for (const platform of ['darwin', 'win32']) {
    assert.deepEqual(decideOpenAtLoginDefault({ ...base, platform, isPackaged: false }), { enable: false, nextState: null });
  }
});

test('unsupported platform: no login item guessed', () => {
  assert.deepEqual(decideOpenAtLoginDefault({ ...base, platform: 'linux' }), { enable: false, nextState: 'done' });
});
