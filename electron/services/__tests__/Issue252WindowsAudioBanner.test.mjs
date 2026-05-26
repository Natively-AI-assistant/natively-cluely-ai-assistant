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
  assert.match(
    permissionHandler[0],
    /kind:\s*['"]screen-recording-permission['"]/,
    'screen-recording event must set warning kind="screen-recording-permission"'
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

test('issue #252: Open Settings button does not unconditionally fire x-apple.systempreferences', () => {
  // The macOS-only URL is correct ONLY for kind=screen-recording-permission.
  // For kind=audio-capture-failure the action must open Natively's own
  // settings (toggleSettingsWindow / openSettingsTab) — not an OS URL.
  const stripped = ui.replace(/\s+/g, ' ');
  const xAppleCount = (stripped.match(/x-apple\.systempreferences:/g) || []).length;
  assert.ok(
    xAppleCount <= 1,
    'x-apple.systempreferences should appear at most once (only in the screen-recording branch)'
  );

  // The banner JSX must include a JSX-level conditional keyed on the
  // warning kind so that the audio-capture-failure case renders an
  // in-app settings action instead of the macOS URL.
  const bannerJsx = ui.match(
    /\{systemAudioWarning && \([\s\S]*?<X className="w-3 h-3" \/>/
  );
  assert.ok(bannerJsx, 'banner JSX block should be present');
  assert.match(
    bannerJsx[0],
    /systemAudioWarning\.kind === ['"]screen-recording-permission['"]/,
    'banner must branch on systemAudioWarning.kind'
  );
  assert.match(
    bannerJsx[0],
    /toggleSettingsWindow|openSettingsTab/,
    'audio-capture-failure branch must open in-app settings, not an OS URL'
  );
});
