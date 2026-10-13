// Maps native system-audio error codes to Linux user-facing copy (no keyword routing).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function loadPermissionMessages() {
  const modPath = path.join(root, 'dist-electron/electron/platform/permissionMessages.js');
  return import(pathToFileURL(modPath).href);
}

test('mapLinuxSystemAudioError maps PULSE_NOT_AVAILABLE by code', async () => {
  const {
    mapLinuxSystemAudioError,
    LINUX_SYSTEM_AUDIO_ERROR_CODES,
    formatPermissionMessage,
  } = await loadPermissionMessages();

  const mapped = mapLinuxSystemAudioError(
    LINUX_SYSTEM_AUDIO_ERROR_CODES.PULSE_NOT_AVAILABLE,
  );
  assert.equal(mapped, formatPermissionMessage('linux-audio-server-missing'));
});

test('mapLinuxSystemAudioError maps INIT_TIMEOUT by code', async () => {
  const { mapLinuxSystemAudioError, LINUX_SYSTEM_AUDIO_ERROR_CODES } =
    await loadPermissionMessages();

  const mapped = mapLinuxSystemAudioError(
    LINUX_SYSTEM_AUDIO_ERROR_CODES.INIT_TIMEOUT,
  );
  assert.match(mapped, /PulseAudio|PipeWire/);
});

test('surfaceLinuxSystemAudioError reads native Error.message code', async () => {
  const {
    surfaceLinuxSystemAudioError,
    LINUX_SYSTEM_AUDIO_ERROR_CODES,
    formatPermissionMessage,
  } = await loadPermissionMessages();

  const nativeErr = new Error(LINUX_SYSTEM_AUDIO_ERROR_CODES.STREAM_CONNECT_FAILED);
  const surfaced = surfaceLinuxSystemAudioError(nativeErr);
  assert.equal(
    surfaced.message,
    formatPermissionMessage('linux-audio-server-missing'),
  );
});

test('surfaceLinuxSystemAudioError does not keyword-match free-form strings', async () => {
  const { surfaceLinuxSystemAudioError } = await loadPermissionMessages();

  const vague = new Error('PulseAudio server unavailable');
  const surfaced = surfaceLinuxSystemAudioError(vague);
  assert.equal(surfaced.message, vague.message);
});

test('permissionMessages.ts has no keyword substring routing', () => {
  const src = fs.readFileSync(
    path.join(root, 'electron/platform/permissionMessages.ts'),
    'utf8',
  );
  assert.doesNotMatch(src, /\.includes\s*\(/);
  assert.doesNotMatch(src, /\.toLowerCase\s*\(/);
});

test('resolveLinuxSystemAudioErrorCode returns null for non-code Error (negative)', async () => {
  const modPath = path.join(root, 'dist-electron/electron/platform/linuxSystemAudioErrors.js');
  const { resolveLinuxSystemAudioErrorCode } = await import(pathToFileURL(modPath).href);
  assert.equal(resolveLinuxSystemAudioErrorCode(new Error('PulseAudio server unavailable')), null);
  assert.equal(resolveLinuxSystemAudioErrorCode('not-a-real-code'), null);
  assert.equal(resolveLinuxSystemAudioErrorCode(null), null);
});
