import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gatePath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/platform/linuxMeetingGate.js',
);

async function loadGate() {
  return import(pathToFileURL(gatePath).href);
}

describe('shouldBlockLinuxSystemAudioAtMeetingStart', () => {
  test('supported X11 session with capture enabled → false', async () => {
    const { shouldBlockLinuxSystemAudioAtMeetingStart } = await loadGate();
    assert.equal(
      shouldBlockLinuxSystemAudioAtMeetingStart(false, {
        sessionType: 'x11',
        isSupported: true,
        reason: 'X11',
      }),
      false,
    );
  });

  test('Wayland unsupported session → true', async () => {
    const { shouldBlockLinuxSystemAudioAtMeetingStart } = await loadGate();
    assert.equal(
      shouldBlockLinuxSystemAudioAtMeetingStart(false, {
        sessionType: 'wayland',
        isSupported: false,
        reason: 'Wayland',
      }),
      true,
    );
  });

  test('linuxCaptureDisabled flag → true even on supported X11', async () => {
    const { shouldBlockLinuxSystemAudioAtMeetingStart } = await loadGate();
    assert.equal(
      shouldBlockLinuxSystemAudioAtMeetingStart(true, {
        sessionType: 'x11',
        isSupported: true,
        reason: 'X11',
      }),
      true,
    );
  });
});

describe('shouldDisableLinuxCaptureOnLimitedContinue', () => {
  test('unsupported session disables capture on limited continue', async () => {
    const { shouldDisableLinuxCaptureOnLimitedContinue } = await loadGate();
    assert.equal(
      shouldDisableLinuxCaptureOnLimitedContinue({
        sessionType: 'wayland',
        isSupported: false,
        reason: 'Wayland',
      }),
      true,
    );
    assert.equal(
      shouldDisableLinuxCaptureOnLimitedContinue({
        sessionType: 'x11',
        isSupported: true,
        reason: 'X11',
      }),
      false,
    );
  });
});
