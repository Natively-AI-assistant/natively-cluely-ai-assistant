#!/usr/bin/env node
/**
 * R-15 repro — F-703 turned a recoverable settings.json into a permanent brick.
 *
 * F-703's concern was right: never overwrite a recoverable settings.json with an
 * empty object. Its mechanism was not. A file that cannot be PARSED will never
 * parse — the content is deterministic — so "read-only for this session" was
 * read-only on EVERY session, forever. Nothing cleared the flag and isDegraded()
 * had no callers, so a 0-byte / whitespace-only / "null" / BOM-prefixed
 * settings.json meant every user setting was permanently unwritable, silently:
 * set() mutated memory first and ~15 IPC handlers reported success while disk
 * never changed.
 *
 * saveSettings() also had no fsync, so a power loss between rename and flush
 * produces exactly the 0-byte file that triggers the brick.
 *
 * The fix quarantines the unreadable file ONCE (preserving the bytes under a
 * timestamped name) and continues on a writable store, so the app self-heals.
 *
 * Drives the REAL built SettingsManager against a temp userData dir, and
 * simulates relaunches by clearing the module cache + the global singleton.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/audit/R-15-repro.cjs
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const REPO = path.resolve(__dirname, '..', '..');
const SM_PATH = path.join(REPO, 'dist-electron', 'electron', 'services', 'SettingsManager.js');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'r15-settings-'));
const settingsPath = path.join(userData, 'settings.json');

// Stub electron's app.getPath so the real manager writes into our temp dir.
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        getPath: () => userData,
        getVersion: () => '0.0.0-test',
        isPackaged: false,
        isReady: () => true,
        whenReady: () => Promise.resolve(),
        on: () => {},
      },
      ipcMain: { on: () => {}, handle: () => {} },
    };
  }
  return realLoad.apply(this, arguments);
};

function relaunch() {
  // Fresh module instance + drop the global singleton, as a real restart would.
  delete require.cache[require.resolve(SM_PATH)];
  for (const k of Object.keys(globalThis)) {
    if (k.startsWith('__nativelySettingsManager')) delete globalThis[k];
  }
  const { SettingsManager } = require(SM_PATH);
  return SettingsManager.getInstance();
}

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`[R-15] ${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
};

const CORRUPT = {
  'zero-byte': '',
  'whitespace-only': '   \n\t ',
  'literal null': 'null',
  'BOM-prefixed': '﻿{"theme":"dark"}',
  'truncated json': '{"theme":"da',
};

for (const [name, content] of Object.entries(CORRUPT)) {
  for (const f of fs.readdirSync(userData)) fs.rmSync(path.join(userData, f), { force: true });
  fs.writeFileSync(settingsPath, content);

  const mgr = relaunch();
  mgr.set('theme', 'light');

  // A relaunch must see the value that was just written.
  const after = relaunch();
  const persisted = after.get('theme');
  const quarantined = fs.readdirSync(userData).filter((f) => f.includes('.corrupt-'));

  const ok = persisted === 'light' && quarantined.length === 1;
  if (!ok) failures++;
  console.log(`[R-15] ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(16)} -> persisted=${JSON.stringify(persisted)} quarantined=${quarantined.length} (expected "light", 1)`);
  if (quarantined.length === 1) {
    check(`  original bytes preserved (${name})`.padEnd(46),
      fs.readFileSync(path.join(userData, quarantined[0]), 'utf8'), content);
  }
}

// A VALID settings.json must be left completely alone.
for (const f of fs.readdirSync(userData)) fs.rmSync(path.join(userData, f), { force: true });
fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'dark', autoUpdate: false }, null, 2));
let mgr = relaunch();
check('valid file: value preserved       ', mgr.get('theme'), 'dark');
check('valid file: NOT quarantined       ', fs.readdirSync(userData).filter((f) => f.includes('.corrupt-')).length, 0);
mgr.set('theme', 'light');
check('valid file: write persists        ', relaunch().get('theme'), 'light');
check('valid file: other keys survive    ', relaunch().get('autoUpdate'), false);

// First run (no file at all) must stay writable — never regressed by any of this.
for (const f of fs.readdirSync(userData)) fs.rmSync(path.join(userData, f), { force: true });
mgr = relaunch();
mgr.set('theme', 'system');
check('first run: write persists         ', relaunch().get('theme'), 'system');

// The durability hole that CREATES a 0-byte file must be closed.
const smSrc = fs.readFileSync(path.join(REPO, 'electron', 'services', 'SettingsManager.ts'), 'utf8');
check('saveSettings fsyncs before rename ', /fs\.fsyncSync\(fd\)[\s\S]{0,200}renameSync/.test(smSrc), true);

Module._load = realLoad;
fs.rmSync(userData, { recursive: true, force: true });

if (failures) {
  console.error(`[R-15] FAIL: ${failures} assertion(s) failed — the settings store is not self-healing.`);
  process.exit(1);
}
console.log('[R-15] PASS: an unreadable settings.json is quarantined once and the store keeps working.');
