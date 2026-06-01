import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

function extractMethod(methodName) {
  const methodRe = new RegExp(`(?:private|public)\\s+${methodName}\\b`);
  const match = methodRe.exec(mainSource);
  assert.ok(match, `could not locate ${methodName}`);
  let openBrace = -1;
  let parenDepth = 0;
  for (let i = match.index; i < mainSource.length; i++) {
    const ch = mainSource[i];
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    else if (ch === '{' && parenDepth === 0) {
      openBrace = i;
      break;
    }
  }
  assert.ok(openBrace >= 0, `could not locate opening brace for ${methodName}`);
  let i = openBrace + 1;
  let depth = 1;
  const start = i;
  while (i < mainSource.length && depth > 0) {
    const ch = mainSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces while extracting ${methodName}`);
  return mainSource.slice(start, i - 1);
}

test('audio and STT status channels target meeting surfaces', () => {
  const meetingBody = extractMethod('sendToMeetingSurfaces');
  assert.ok(/getLauncherWindow\s*\(\s*\)/.test(meetingBody), 'BUG: meeting-surface sender must include the launcher window.');
  assert.ok(/getOverlayWindow\s*\(\s*\)/.test(meetingBody), 'BUG: meeting-surface sender must include the overlay window.');
  assert.ok(/new\s+Set\s*<\s*number\s*>\s*\(/.test(meetingBody), 'BUG: meeting-surface sender must dedupe target windows.');

  const sttBody = extractMethod('sendSttStatus');
  const audioBody = extractMethod('sendAudioCaptureFailed');
  const permissionBody = extractMethod('sendSystemAudioPermissionDenied');

  assert.ok(/sendToMeetingSurfaces\s*\(\s*['"]stt-status['"]\s*,\s*payload\s*\)/.test(sttBody), 'BUG: stt-status must be sent to meeting surfaces (launcher+overlay).');
  assert.ok(/sendToMeetingSurfaces\s*\(\s*['"]audio-capture-failed['"]\s*,\s*payload\s*\)/.test(audioBody), 'BUG: audio-capture-failed must be sent to meeting surfaces (launcher+overlay).');
  assert.ok(/sendToMeetingSurfaces\s*\(\s*['"]system-audio-permission-denied['"]\s*,\s*message\s*\)/.test(permissionBody), 'BUG: system-audio-permission-denied must be sent to meeting surfaces (launcher+overlay).');

  for (const channel of ['stt-status', 'audio-capture-failed', 'system-audio-permission-denied']) {
    assert.ok(!new RegExp(`sendToOverlay\\s*\\(\\s*['"]${channel}['"]`).test(mainSource), `BUG: ${channel} must not use overlay-only routing.`);
    assert.ok(!new RegExp(`this\\.broadcast\\s*\\(\\s*['"]${channel}['"]`).test(mainSource), `BUG: ${channel} must not use all-window broadcast.`);
    assert.ok(!new RegExp(`BrowserWindow\\.getAllWindows\\s*\\(\\s*\\)[\\s\\S]{0,500}['"]${channel}['"]`).test(mainSource), `BUG: ${channel} must not be sent from direct all-window loops.`);
  }
});

test('device-selection-applied targets settings surfaces only', () => {
  const settingsBody = extractMethod('sendToSettingsSurfaces');
  const deviceBody = extractMethod('broadcastDeviceSelection');

  assert.ok(/getSettingsWindow\s*\(\s*\)/.test(settingsBody), 'BUG: settings-surface sender must include the settings window.');
  assert.ok(/getLauncherWindow\s*\(\s*\)/.test(settingsBody), 'BUG: settings-surface sender must include launcher for in-launcher settings overlays.');
  assert.ok(/new\s+Set\s*<\s*number\s*>\s*\(/.test(settingsBody), 'BUG: settings-surface sender must dedupe target windows.');
  assert.ok(/sendToSettingsSurfaces\s*\(\s*['"]device-selection-applied['"]\s*,\s*payload\s*\)/.test(deviceBody), 'BUG: device-selection-applied must be sent to settings surfaces.');
  assert.ok(!/this\.broadcast\s*\(\s*['"]device-selection-applied['"]/.test(mainSource), 'BUG: device-selection-applied must not use all-window broadcast.');
});
