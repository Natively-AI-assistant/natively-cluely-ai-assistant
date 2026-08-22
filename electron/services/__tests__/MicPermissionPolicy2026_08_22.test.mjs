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

  test("'unknown' must stay usable (the API fails OPEN, so it is not a denial)", () => {
    // Corrected 2026-08-22: 'unknown' is NOT a query failure. Electron's win32
    // GetDeviceAccessStatus returns DeviceAccessStatus_Allowed ('granted') when
    // GetActivationFactory or CreateFromDeviceClass fail, and leaves Unspecified
    // ('not-determined') when get_CurrentStatus fails. 'unknown' is only the
    // `default:` arm for an enum value outside the four named ones — effectively
    // unreachable. Treating it as usable matches an API that already fails open.
    const p = classifyMicStatus('win32', 'unknown');
    assert.equal(p.usable, true, "'unknown' must not strand a working machine in onboarding");
    assert.equal(p.remedy, 'none');
  });

  test("restricted → settings, NOT policy (it is the DEVICE switch, not an admin)", () => {
    // Electron maps win32 DeviceAccessStatus_DeniedBySystem to 'restricted'
    // (shell/browser/api/electron_api_system_preferences_win.cc,
    // ConvertDeviceAccessStatus). That is the "Microphone access for this device"
    // switch being off — the most common Windows mic denial, and precisely what
    // ms-settings:privacy-microphone fixes.
    //
    // The first version of this fix returned 'policy' here and the FIRST version
    // of this test pinned that, so the test encoded the bug: the user was told
    // their organization blocked the mic and handed a disabled button.
    const p = classifyMicStatus('win32', 'restricted');
    assert.equal(p.usable, false);
    assert.equal(p.remedy, 'settings',
      'win32 restricted is the device-level switch — the privacy panel DOES fix it');
  });

  test('every non-granted win32 status has a reachable remedy', () => {
    for (const status of ['denied', 'not-determined', 'restricted']) {
      const p = classifyMicStatus('win32', status);
      assert.equal(p.remedy, 'settings',
        `win32/${status} must route to the privacy panel — it is the only remedy on Windows`);
    }
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

  test('restricted IS policy on darwin (AVAuthorizationStatusRestricted = MDM)', () => {
    // Unlike win32, macOS 'restricted' really is MDM/parental controls and the
    // Settings pane cannot change it — so the platform split is load-bearing.
    const p = classifyMicStatus('darwin', 'restricted');
    assert.equal(p.usable, false);
    assert.equal(p.remedy, 'policy');
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
