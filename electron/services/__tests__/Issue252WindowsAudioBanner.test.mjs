// Regression test for issue #252: on Windows the audio-capture-failed
// banner used the macOS "Screen Recording Permission Denied" title and
// fired an x-apple.systempreferences URL on the "Open Settings" button,
// which Windows shell cannot resolve.
//
// The two IPC events that feed this banner are semantically distinct:
//   - system-audio-permission-denied : macOS screen-recording denial
//   - audio-capture-failed           : cross-platform capture failure
//                                       (no-chunks watchdog, TCC zerofill,
//                                       terminal STT init failure, etc.)
//
// The renderer must branch on the kind of warning so that the
// audio-capture-failure case shows a platform-neutral title and an
// in-app settings action.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const ui = read('src/components/NativelyInterface.tsx');

test('issue #252: audio-capture-failed handler does not reuse the screen-recording banner kind', () => {
  // The audio-capture-failed listener should set a warning of kind
  // 'audio-capture-failure', not the same shape used by the macOS
  // screen-recording event.
  const audioFailedHandler = ui.match(
    /onAudioCaptureFailed[\s\S]*?return\s*\(\)\s*=>\s*unsub\?\.\(\);/
  );
  assert.ok(audioFailedHandler, 'audio-capture-failed listener should still exist');
  assert.match(
    audioFailedHandler[0],
    /kind:\s*['"]audio-capture-failure['"]/,
    'audio-capture-failed must set warning kind="audio-capture-failure"'
  );
});

test('issue #252: system-audio-permission-denied handler tags its banner as screen-recording-permission', () => {
  const permissionHandler = ui.match(
    /onSystemAudioPermissionDenied[\s\S]*?return\s*\(\)\s*=>\s*unsub\?\.\(\);/
  );
  assert.ok(permissionHandler, 'system-audio-permission-denied listener should still exist');
  // The renderer may set the kind inline OR delegate to a helper. Accept
  // either (a) `kind: 'screen-recording-permission'` literal in the listener
  // body, or (b) a call to a helper whose body sets that kind. The current
  // implementation factored out `showPermissionWarning(message)` which sets
  // the kind itself — refusing to recognise that path would force inlining
  // for a stylistic reason rather than a correctness one.
  const inline = /kind:\s*['"]screen-recording-permission['"]/.test(permissionHandler[0]);
  let helperSets = false;
  const helperCall = permissionHandler[0].match(/(\w*PermissionWarning)\s*\(/);
  if (helperCall) {
    const helperBody = ui.match(
      new RegExp(`(const|function)\\s+${helperCall[1]}\\b[\\s\\S]*?\\{[\\s\\S]*?\\}`),
    );
    if (helperBody) {
      helperSets = /kind:\s*['"]screen-recording-permission['"]/.test(helperBody[0]);
    }
  }
  assert.ok(
    inline || helperSets,
    'screen-recording event must set warning kind="screen-recording-permission" (directly or via a helper)',
  );
});

test('issue #252: banner title is not hardcoded to "Screen Recording Permission Denied"', () => {
  // The unconditional <span>Screen Recording Permission Denied</span>
  // is the bug. The title must be conditional on the warning kind.
  const offending = '<span>Screen Recording Permission Denied</span>';
  const stripped = ui.replace(/\s+/g, ' ');
  const occurrences = stripped.split(offending).length - 1;
  assert.equal(
    occurrences,
    0,
    'banner must not unconditionally render "Screen Recording Permission Denied" — it should branch on the warning kind'
  );
});

test('issue #252: Open Settings button does not unconditionally fire x-apple.systempreferences', async () => {
  // The macOS-only URL is correct ONLY on darwin. The invariant is that NO
  // x-apple URL can be reached off darwin.
  //
  // 2026-09-26: the pane choice moved into src/lib/audioWarningAction.mjs so
  // Windows gets its own destinations (Windows mic privacy settings, Natively
  // Settings → Audio). The banner JSX no longer holds any x-apple literal, and
  // the helper is EXECUTED here for every warning shape off darwin, which is
  // stronger than checking where the literals sit in the source.
  const stripped = ui.replace(/\s+/g, ' ');
  assert.equal((stripped.match(/'x-apple\.systempreferences:/g) || []).length, 0,
    'the banner JSX must not hold an x-apple URL literal; the routing helper owns them');

  const { audioWarningAction } = await import(
    new URL('../../../src/lib/audioWarningAction.mjs', import.meta.url).href
  );
  const kinds = ['audio-capture-failure', 'screen-recording-permission'];
  const channels = ['mic', 'system', undefined];
  const titles = [undefined, 'Microphone Is Silent', 'Microphone Blocked', 'Screen Recording Blocked',
    'Input and Output Are the Same Device', 'System Audio Unavailable'];
  for (const platform of ['win32', 'linux']) {
    for (const kind of kinds) for (const channel of channels) for (const titleKey of titles) {
      const action = audioWarningAction({ platform, kind, channel, titleKey, message: '' });
      assert.notEqual(action.type, 'external', `${platform}/${kind}/${channel}/${titleKey} must not open a macOS pane`);
    }
  }

  // The banner JSX must include a JSX-level conditional keyed on the
  // warning kind so that the audio-capture-failure case renders an
  // in-app settings action instead of the macOS URL.
  // The block runs to the end of its own fold. It used to be bounded by the
  // next dismiss ✕ in the file, which belonged to the hand-rolled STT banner
  // below it; that banner now draws its ✕ inside OverlayBanner.
  const bannerJsx = ui.match(
    /\{systemAudioWarning && \([\s\S]*?<\/ChromeFold>/
  );
  assert.ok(bannerJsx, 'banner JSX block should be present');
  assert.match(
    bannerJsx[0],
    /systemAudioWarning\.kind === ['"]screen-recording-permission['"]/,
    'banner must branch on systemAudioWarning.kind'
  );
  assert.match(
    bannerJsx[0],
    /openSettingsTab/,
    'non-deep-link warnings must open in-app settings (Settings → Audio), not an OS URL'
  );
  assert.match(
    bannerJsx[0],
    /openMicSettings/,
    'Windows microphone warnings must open Windows mic privacy settings via openMicSettings'
  );
});

test('Windows: a keyboard hook that will not start shows its own banner, in its own fold', () => {
  // stealth-tap-state {active:false, reason:'permission'} also fires on
  // Windows when tap.start() fails (StealthKeyboardManager), but the
  // Accessibility banner is macOS-only, so the failure was silent.
  const fold = ui.match(/<ChromeFold show=\{isWindows && stealthPermissionMissing\}[\s\S]*?<\/ChromeFold>/);
  assert.ok(fold, 'the Windows stealth banner must sit in a ChromeFold gated on isWindows');
  assert.match(fold[0], /stealthTapStart/, 'Try Again must re-engage stealth typing');
  assert.doesNotMatch(fold[0], /stealthTapOpenSettings|Accessibility/, 'no macOS permission advice on Windows');
});

test('page capture banner: the Companion button keys on the text main actually sends', () => {
  // The button shows when the detail names Settings → Companion. If
  // pageCaptureFallback.ts renames the tab again, the button would silently
  // never show (the PR first keyed on "Settings → Sync", renamed since).
  const fallback = read('electron/services/pageCaptureFallback.ts');
  assert.ok(fallback.includes('Settings → Companion'), 'pageCaptureFallback.ts must still name Settings → Companion');
  const banner = ui.match(/testId="fold-capture-fallback"[\s\S]*?<\/ChromeFold>/);
  assert.ok(banner, 'capture fallback fold should be present');
  assert.match(banner[0], /detail\.includes\('Settings → Companion'\)/);
  assert.match(banner[0], /openSettingsTab\?\.\('phone-mirror'\)/);
});
