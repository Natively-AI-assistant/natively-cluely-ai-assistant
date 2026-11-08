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
  HELP_CLIP_IDS,
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

  test('every clip is decided on both platforms', () => {
    assert.deepEqual(Object.keys(mac.clips).sort(), [...HELP_CLIP_IDS].sort());
    assert.deepEqual(Object.keys(win.clips).sort(), [...HELP_CLIP_IDS].sort());
  });

  test('macOS shows every recording; they were all made there', () => {
    for (const id of HELP_CLIP_IDS) assert.equal(mac.clips[id], true, id);
  });

  test('Windows never gets a recording with something macOS-only in it', () => {
    // ⌘ keycaps (overlay, Companion's extension row), Apple Speech, macOS disguise
    // names, the Screen Recording permission, Retrieval's "this Mac" cards, and
    // the follow-up send menu naming the Mac's Mail app, and Calendar's Apple
    // Calendar row (Windows has no such source).
    const macOnly = ['answer', 'autoanswer', 'overlay', 'permissions', 'speech', 'retrieval', 'stealth', 'sync', 'followup', 'calendar'];
    for (const id of macOnly) assert.equal(win.clips[id], false, id);
    // Nothing platform-specific in these.
    const both = ['model', 'verify', 'phone', 'modes', 'profile', 'notes', 'search', 'buttons', 'notepad', 'share', 'mcp'];
    for (const id of both) assert.equal(win.clips[id], true, id);
    // Every clip is in exactly one of the two lists, so a new one has to be decided.
    assert.deepEqual([...macOnly, ...both].sort(), [...HELP_CLIP_IDS].sort());
  });

  test('meeting detection states the older-macOS condition, and nothing it cannot back on Windows', () => {
    assert.match(mac.meetingDetection, /macOS 13 and earlier/);
    assert.equal(win.meetingDetection, null);
  });

  test("the meeting app's microphone and Apple Calendar are offered on macOS only", () => {
    assert.equal(mac.followMeetingMic, true);
    assert.equal(win.followMeetingMic, false);
    assert.equal(mac.appleCalendar, true);
    assert.equal(win.appleCalendar, false);
  });

  test('reading the call app needs Accessibility on macOS only', () => {
    assert.equal(mac.callDetailsNeedAccessibility, true);
    assert.equal(win.callDetailsNeedAccessibility, false);
  });

  test('notepad close and word delete use each platform\'s own keys', () => {
    assert.deepEqual(mac.closeNotepadKeys, ['⌘', 'W']);
    assert.deepEqual(win.closeNotepadKeys, ['Alt', 'F4']);
    assert.deepEqual(mac.wordDeleteKeys, ['⌥', 'Backspace']);
    assert.deepEqual(win.wordDeleteKeys, ['Ctrl', 'Backspace']);
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
