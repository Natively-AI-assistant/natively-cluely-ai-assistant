import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const platformDir = path.resolve(__dirname, '../../../dist-electron/electron/platform');

async function loadPermissionMessages() {
  return import(pathToFileURL(path.join(platformDir, 'permissionMessages.js')).href);
}

describe('formatPermissionMessage on Linux', () => {
  test('Linux screen-recording-denied avoids macOS System Settings copy', async () => {
    if (process.platform !== 'linux') {
      return;
    }
    const { formatPermissionMessage } = await loadPermissionMessages();
    const message = formatPermissionMessage('screen-recording-denied');
    assert.match(message, /PulseAudio|PipeWire/i);
    assert.doesNotMatch(message, /System Settings/);
  });

  test('linux-audio-server-missing mentions install guidance', async () => {
    const { formatPermissionMessage } = await loadPermissionMessages();
    const message = formatPermissionMessage('linux-audio-server-missing');
    assert.match(message, /PulseAudio|PipeWire/i);
    assert.match(message, /pipewire-pulse|pulseaudio/i);
    assert.doesNotMatch(message, /System Settings/);
  });

  test('linux-shortcut-conflict includes accelerator when provided', async () => {
    const { formatPermissionMessage } = await loadPermissionMessages();
    const message = formatPermissionMessage('linux-shortcut-conflict', {
      accelerator: 'CommandOrControl+Shift+S',
    });
    assert.match(message, /CommandOrControl\+Shift\+S/);
    assert.doesNotMatch(message, /System Settings/);
  });

  test('mic-denied and mic-zero-fill use Linux desktop wording', async () => {
    if (process.platform !== 'linux') {
      return;
    }
    const { formatPermissionMessage } = await loadPermissionMessages();
    for (const reason of ['mic-denied', 'mic-zero-fill']) {
      const message = formatPermissionMessage(reason);
      assert.doesNotMatch(message, /System Settings/);
      assert.match(message, /microphone|Microphone/i);
    }
  });
});

describe('mapLinuxSystemAudioError', () => {
  test('maps server-missing codes to linux-audio-server-missing copy', async () => {
    const {
      mapLinuxSystemAudioError,
      formatPermissionMessage,
      LINUX_SYSTEM_AUDIO_ERROR_CODES,
    } = await loadPermissionMessages();
    const expected = formatPermissionMessage('linux-audio-server-missing');

    for (const code of [
      LINUX_SYSTEM_AUDIO_ERROR_CODES.PULSE_NOT_AVAILABLE,
      LINUX_SYSTEM_AUDIO_ERROR_CODES.INIT_TIMEOUT,
      LINUX_SYSTEM_AUDIO_ERROR_CODES.STREAM_CONNECT_FAILED,
      LINUX_SYSTEM_AUDIO_ERROR_CODES.UNSUPPORTED_PLATFORM,
      LINUX_SYSTEM_AUDIO_ERROR_CODES.NATIVE_MODULE_NOT_LOADED,
    ]) {
      assert.equal(mapLinuxSystemAudioError(code), expected, `expected mapping for: ${code}`);
    }
  });

  test('maps CAPTURE_ALREADY_RUNNING to dedicated internal-error copy', async () => {
    const { mapLinuxSystemAudioError, LINUX_SYSTEM_AUDIO_ERROR_CODES } =
      await loadPermissionMessages();
    const message = mapLinuxSystemAudioError(
      LINUX_SYSTEM_AUDIO_ERROR_CODES.CAPTURE_ALREADY_RUNNING,
    );
    assert.match(message, /internal error/i);
    assert.match(message, /stop and restart the meeting/i);
  });

  test('maps other capture runtime codes to system-audio-stuck copy', async () => {
    const {
      mapLinuxSystemAudioError,
      formatPermissionMessage,
      LINUX_SYSTEM_AUDIO_ERROR_CODES,
    } = await loadPermissionMessages();
    const expected = formatPermissionMessage('system-audio-stuck');

    for (const code of [
      LINUX_SYSTEM_AUDIO_ERROR_CODES.CONSUMER_MISSING,
      LINUX_SYSTEM_AUDIO_ERROR_CODES.CAPTURE_THREAD_FAILED,
    ]) {
      assert.equal(mapLinuxSystemAudioError(code), expected, `expected mapping for: ${code}`);
    }
  });
});

describe('surfaceLinuxSystemAudioError', () => {
  test('resolves structured codes from Error.message', async () => {
    const {
      surfaceLinuxSystemAudioError,
      formatPermissionMessage,
      LINUX_SYSTEM_AUDIO_ERROR_CODES,
    } = await loadPermissionMessages();
    const surfaced = surfaceLinuxSystemAudioError(
      new Error(LINUX_SYSTEM_AUDIO_ERROR_CODES.PULSE_NOT_AVAILABLE),
    );
    assert.equal(surfaced.message, formatPermissionMessage('linux-audio-server-missing'));
  });

  test('passes through unrelated errors unchanged', async () => {
    const { surfaceLinuxSystemAudioError } = await loadPermissionMessages();
    const raw = new Error('Device monitor source disconnected unexpectedly');
    const surfaced = surfaceLinuxSystemAudioError(raw);
    assert.equal(surfaced.message, raw.message);
    assert.equal(surfaced, raw);
  });
});

describe('Linux renderer copy — no macOS System Settings strings (AC-C1)', () => {
  function nonMacBranch(source) {
    const macIdx = source.indexOf('isMac ?');
    if (macIdx < 0) return source;
    const elseIdx = source.indexOf(') : (', macIdx);
    if (elseIdx < 0) return source;
    return source.slice(elseIdx + 5);
  }

  test('changed settings/onboarding components avoid macOS-only permission copy in non-mac branches', () => {
    if (process.platform !== 'linux') return;
    const root = path.resolve(__dirname, '../../..');
    const files = [
      'src/components/settings/HelpSettings.tsx',
      'src/components/onboarding/PermissionsToaster.tsx',
      'src/components/settings/ModesSettings.tsx',
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      const branch = nonMacBranch(src);
      assert.doesNotMatch(
        branch,
        /System Settings/,
        `${rel} non-mac branch must not reference macOS System Settings`,
      );
    }
  });
});
