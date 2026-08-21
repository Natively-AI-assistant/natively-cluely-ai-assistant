// CR-03 (code-review HIGH, 2026-08-21): F-706 made win32 report the REAL mic
// status, but nothing on win32 could ACT on a non-granted result —
// permissions:request-mic returned true without doing anything off darwin, the
// onboarding offered no settings link off darwin, and allGranted demanded a
// literal 'granted'. A Windows user with the mic toggle off got a control that
// could never turn green and no way forward.
//
// Both platform branches are exercised here WITHOUT mutating process.platform:
// the policy takes platform as an argument (CLAUDE.md).
import { test, describe } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { classifyMicStatus, micSettingsUri } = await import(
  pathToFileURL(path.resolve(here, '../../..', 'src/lib/micPermissionPolicy.mjs')).href
);

describe('win32 — no per-app grant API exists, so every remedy must be reachable', () => {
  test("denied → NOT usable, and the remedy is the settings panel (was: a dead button)", () => {
    const p = classifyMicStatus('win32', 'denied');
    assert.equal(p.usable, false);
    assert.equal(p.remedy, 'settings',
      'win32 cannot prompt; without a settings remedy the user has no way forward');
  });

  test("not-determined → settings, NOT 'request' (askForMediaAccess is macOS-only)", () => {
    assert.equal(classifyMicStatus('win32', 'not-determined').remedy, 'settings');
  });

  test("'unknown' is a query failure, not a denial — must stay usable", () => {
    // Electron 43 declares 'unknown' in the return union. Older Windows returns
    // 'granted', so 'unknown' on Win10/11 means GetDeviceAccessStatus could not
    // resolve. F-706's own rationale: a query failure must never LOCK a working
    // machine out of capture.
    const p = classifyMicStatus('win32', 'unknown');
    assert.equal(p.usable, true, "'unknown' must not strand a working machine in onboarding");
    assert.equal(p.remedy, 'none');
  });

  test("restricted → policy, and NOT the settings panel (it cannot help)", () => {
    const p = classifyMicStatus('win32', 'restricted');
    assert.equal(p.usable, false);
    assert.equal(p.remedy, 'policy',
      'administrator policy is not user-fixable; offering Settings would be a dead end');
  });

  test('granted → usable, nothing to do', () => {
    assert.deepEqual(classifyMicStatus('win32', 'granted'), { usable: true, remedy: 'none' });
  });

  test('the win32 privacy panel URI is the Windows 10/11 one', () => {
    assert.equal(micSettingsUri('win32'), 'ms-settings:privacy-microphone');
  });
});

describe('darwin — unchanged behaviour, so the fix cannot regress macOS', () => {
  test('not-determined → request (the OS can still prompt)', () => {
    assert.equal(classifyMicStatus('darwin', 'not-determined').remedy, 'request');
  });

  test('denied → settings (the prompt is suppressed once denied)', () => {
    assert.equal(classifyMicStatus('darwin', 'denied').remedy, 'settings');
  });

  test('granted → usable', () => {
    assert.equal(classifyMicStatus('darwin', 'granted').usable, true);
  });

  test('the darwin panel URI targets the Microphone pane', () => {
    assert.match(micSettingsUri('darwin'), /^x-apple\.systempreferences:.*Privacy_Microphone$/);
  });
});

describe('platforms with no queryable model', () => {
  test('linux has no panel to open, so the caller must not offer one', () => {
    assert.equal(micSettingsUri('linux'), null);
  });

  test('an unrecognised status is treated as blocked, not silently usable', () => {
    assert.equal(classifyMicStatus('win32', 'wat').usable, false);
  });
});
