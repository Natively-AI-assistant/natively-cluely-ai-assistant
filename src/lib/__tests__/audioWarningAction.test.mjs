import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioWarningAction } from '../audioWarningAction.mjs';

const MIC = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
const SCREEN = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
const fail = (o) => ({ kind: 'audio-capture-failure', ...o });

// Windows: every "Open Settings" used to open the quick-settings popover at its
// off-screen parking spot. Live-reproduced 2026-09-26.
test('win32: microphone warnings open Windows mic privacy settings', () => {
  for (const titleKey of ['Microphone Is Silent', 'Microphone Blocked']) {
    assert.deepEqual(audioWarningAction(fail({ platform: 'win32', channel: 'mic', titleKey })), { type: 'mic-privacy' });
  }
});

test('win32: device, watchdog and capture faults open Settings → Audio', () => {
  const cases = [
    fail({ platform: 'win32', channel: 'mic', message: 'No audio detected from your microphone for 12s.' }),
    fail({ platform: 'win32', channel: 'system', message: 'System audio capture failed after 3 attempts.' }),
    fail({ platform: 'win32', channel: 'mic', message: 'No working microphone could be initialized.' }),
  ];
  for (const w of cases) assert.deepEqual(audioWarningAction(w), { type: 'settings-tab', tab: 'audio' }, w.message);
});

test('both platforms: a speech-to-text failure opens Settings → Audio, not a privacy pane', () => {
  const message = 'Speech-to-text provider "none" failed to initialize for the microphone channel. Check your API key and credentials in Settings.';
  for (const platform of ['win32', 'darwin']) {
    assert.deepEqual(audioWarningAction(fail({ platform, channel: 'mic', message })), { type: 'settings-tab', tab: 'audio' }, platform);
  }
});

test('darwin: privacy-pane routing is unchanged', () => {
  assert.deepEqual(audioWarningAction(fail({ platform: 'darwin', channel: 'mic', titleKey: 'Microphone Is Silent' })), { type: 'external', url: MIC, pane: 'microphone' });
  assert.deepEqual(audioWarningAction(fail({ platform: 'darwin', channel: 'mic' })), { type: 'external', url: MIC, pane: 'microphone' }, 'mic channel without a title');
  assert.deepEqual(audioWarningAction({ platform: 'darwin', kind: 'screen-recording-permission', channel: 'system', titleKey: 'Screen Recording Blocked' }), { type: 'external', url: SCREEN, pane: 'screen' });
  assert.deepEqual(audioWarningAction(fail({ platform: 'darwin', channel: 'system' })), { type: 'external', url: SCREEN, pane: 'screen' });
});

test('darwin: device faults and unknown channels open Settings → Audio (no longer the off-screen popover)', () => {
  assert.deepEqual(audioWarningAction(fail({ platform: 'darwin', channel: 'system', titleKey: 'Input and Output Are the Same Device' })), { type: 'settings-tab', tab: 'audio' });
  assert.deepEqual(audioWarningAction(fail({ platform: 'darwin' })), { type: 'settings-tab', tab: 'audio' });
});

test('other platforms never get a macOS or Windows privacy link', () => {
  assert.deepEqual(audioWarningAction(fail({ platform: 'linux', channel: 'mic', titleKey: 'Microphone Is Silent' })), { type: 'settings-tab', tab: 'audio' });
});
