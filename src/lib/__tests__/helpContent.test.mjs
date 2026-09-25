// Both platform branches of Settings → Setup & Help.
//
// The pane used to pick its copy with `isMac` inline, so a test could only see
// the branch it ran on, and "not macOS" quietly meant "Windows": Windows users
// got the macOS Zoom walkthrough, and the macOS Quick Start named Accessibility,
// which shortcuts never needed. `platform` is an argument here, so darwin and
// win32 are both asserted on either OS, and process.platform is never mutated.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  HELP_PLATFORMS,
  isHelpPlatform,
  getPermissions,
  getRowCopy,
  getPlatformFacts,
} from '../helpContent.mjs';

describe('supported platforms', () => {
  test('exactly macOS and Windows', () => {
    assert.deepEqual([...HELP_PLATFORMS], ['darwin', 'win32']);
    assert.equal(isHelpPlatform('darwin'), true);
    assert.equal(isHelpPlatform('win32'), true);
  });

  for (const unsupported of ['linux', 'freebsd', '', undefined, null]) {
    test(`${String(unsupported) || '(empty)'} is refused rather than routed through another platform`, () => {
      assert.equal(isHelpPlatform(unsupported), false);
      assert.throws(() => getPermissions(unsupported), /Unsupported platform/);
      assert.throws(() => getRowCopy(unsupported), /Unsupported platform/);
      assert.throws(() => getPlatformFacts(unsupported), /Unsupported platform/);
    });
  }
});

describe('permissions — darwin', () => {
  const perms = getPermissions('darwin');

  test('Screen Recording and Microphone, and not Accessibility', () => {
    assert.deepEqual(perms.map((p) => p.id), ['screen', 'microphone']);
    assert.ok(!perms.some((p) => /accessibility/i.test(p.title)));
  });

  test('each opens its own System Settings pane through an allowed x-apple URL', () => {
    const urls = perms.map((p) => (p.open.kind === 'url' ? p.open.url : null));
    assert.deepEqual(urls, [
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    ]);
  });

  test('the screen pane carries its pre-macOS-15 name too', () => {
    assert.equal(perms[0].title, 'Screen & System Audio Recording');
    assert.equal(perms[0].olderTitle, 'Screen Recording');
  });

  test('paths are macOS System Settings paths', () => {
    for (const p of perms) assert.equal(p.path[0], 'System Settings');
  });
});

describe('permissions — win32', () => {
  const perms = getPermissions('win32');

  test('only the microphone: Windows asks nothing for screen capture', () => {
    assert.deepEqual(perms.map((p) => p.id), ['microphone']);
  });

  test('never an x-apple URL — open-external refuses it on Windows (issue #252)', () => {
    for (const p of perms) {
      assert.equal(p.open.kind, 'mic-settings');
      assert.doesNotMatch(JSON.stringify(p), /x-apple/);
    }
  });

  test('the Windows Settings path, not a macOS one', () => {
    assert.deepEqual(perms[0].path, ['Settings', 'Privacy & security', 'Microphone']);
    assert.doesNotMatch(JSON.stringify(perms), /System Settings|Privacy & Security/);
  });
});

describe('platform facts', () => {
  const mac = getPlatformFacts('darwin');
  const win = getPlatformFacts('win32');

  test('the Zoom walkthrough (a macOS Zoom screenshot) is macOS-only', () => {
    assert.equal(mac.zoomGuide, true);
    assert.equal(win.zoomGuide, false);
  });

  test('Apple Speech is offered on macOS only', () => {
    assert.ok(mac.onDeviceSpeech.includes('Apple Speech'));
    assert.ok(!win.onDeviceSpeech.includes('Apple Speech'));
    assert.ok(win.onDeviceSpeech.includes('Local Models'));
  });

  test('the ScreenCaptureKit switch is named on macOS only', () => {
    assert.match(mac.systemAudio.fix, /ScreenCaptureKit/);
    assert.doesNotMatch(JSON.stringify(win.systemAudio), /ScreenCaptureKit|Core Audio/);
  });

  test('Protect Natively shortcuts is a Windows-only setting', () => {
    assert.equal(mac.shortcutGuard, false);
    assert.equal(win.shortcutGuard, true);
  });

  test('Stealth Typing needs Accessibility on macOS only', () => {
    assert.equal(mac.stealthTypingNeedsAccessibility, true);
    assert.equal(win.stealthTypingNeedsAccessibility, false);
  });

  test('each platform names its own tools', () => {
    assert.equal(mac.terminal, 'Terminal');
    assert.equal(win.terminal, 'PowerShell');
    assert.deepEqual(win.disguises, ['Command Prompt', 'Settings', 'Task Manager']);
    assert.deepEqual(mac.disguises, ['Terminal', 'System Settings', 'Activity Monitor']);
  });

  test('the modifier key matches the platform', () => {
    assert.equal(mac.modifierKey, '⌘');
    assert.equal(win.modifierKey, 'Ctrl');
  });

  test('only macOS needs a restart after granting screen permission', () => {
    assert.equal(mac.restartAfterGrant, true);
    assert.equal(win.restartAfterGrant, false);
  });

  test('recordings made on macOS show on Windows only when nothing in them is macOS-specific', () => {
    assert.deepEqual(mac.recordings, { overlay: true, speechProviders: true, activeModel: true });
    // The overlay clip shows ⌘ keycaps and the provider list shows Apple Speech.
    assert.equal(win.recordings.overlay, false);
    assert.equal(win.recordings.speechProviders, false);
    // The Active Model menu has nothing platform-specific in it.
    assert.equal(win.recordings.activeModel, true);
  });

  test('both platforms return the same shape (contract drift guard)', () => {
    assert.deepEqual(Object.keys(mac).sort(), Object.keys(win).sort());
    assert.deepEqual(Object.keys(getRowCopy('darwin')).sort(), Object.keys(getRowCopy('win32')).sort());
  });
});

describe('row copy', () => {
  // A Settings row description is one short line (Evin's 75-character rule).
  for (const platform of ['darwin', 'win32']) {
    test(`${platform}: every row description fits one line`, () => {
      for (const [key, text] of Object.entries(getRowCopy(platform))) {
        assert.ok(text.length <= 75, `${key} is ${text.length} characters: ${text}`);
      }
    });
  }

  test('each platform names its own settings app', () => {
    assert.match(getRowCopy('darwin').permissionsStep, /System Settings/);
    assert.match(getRowCopy('win32').permissionsStep, /Windows Settings/);
  });
});
