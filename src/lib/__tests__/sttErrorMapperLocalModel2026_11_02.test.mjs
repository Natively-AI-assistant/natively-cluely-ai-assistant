// src/lib/__tests__/sttErrorMapperLocalModel2026_11_02.test.mjs
//
// Issue #707: a Windows user's local model was refused for memory. The
// overlay's banner then said "Check your transcription provider and its key in
// Settings" (a local model has neither), and the chat said "STT Provider
// Error: The transcription service encountered an unexpected issue." Every
// local-model failure fell through to that generic provider error.
//
// The mapper now reads them as 'local_model' with advice that fits: the memory
// figures the gate measured, a download that has not finished, or a model that
// stopped. The messages are written on the platform that raised them (the
// Visual C++ runtime on Windows, a macOS update on a Mac), so the one that
// names what to install is shown as written.
//
// The phrases the mapper keys on are checked against the files that raise
// them, so rewording a local error there cannot silently fall back to
// "unexpected issue" again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { categorizeSttError, sttConnectionCause, sttLocalModelCause } from '../sttErrorMapper.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// As LocalWhisperSTT / loadFailure.ts / onnxMacSupport.ts / onnxThreadConfig.ts word them.
const LOCAL = {
  memory: 'Local STT could not start: insufficient available memory (0.61GB available, this model needs 0.62GB). Close other apps to free memory, choose a smaller local model, or use a cloud STT provider.',
  memoryV292: 'Local STT could not start: insufficient available memory (under 2GB free, app heap 0.0GB). Close other apps to free memory, choose a smaller local model, or use a cloud STT provider.',
  outOfMemory: 'The local model could not be loaded because this computer ran out of memory. Close other apps, or choose a smaller local model.',
  downloading: 'Local STT model onnx-community/moonshine-base-ONNX is still downloading (40%) and has made no progress for 120s — nothing on the system channel was transcribed. Check the internet connection, or choose a cloud STT provider for this meeting.',
  downloadFailed: 'The local model could not be downloaded. Check the internet connection, then install it again in Settings → Audio. (getaddrinfo ENOTFOUND huggingface.co)',
  notReady: 'Local STT model istupakov/parakeet-tdt-0.6b-v3-onnx did not finish loading within 120s on the system channel — nothing from this channel was transcribed. Choose a smaller local model or a cloud STT provider.',
  crashed: 'The local STT engine stopped unexpectedly on the system channel (worker exited unexpectedly, code=1) — nothing further will be transcribed on it. End and restart the meeting; if it keeps happening, choose a smaller local model or use a cloud STT provider.',
  noSlot: 'LocalWhisperSTT/system: no ONNX session slot became free within 20000ms — 2/2 background ONNX sessions in use. Raise NATIVELY_ONNX_HIGH_PRIORITY_SESSIONS (STT channels), or use a cloud STT provider.',
  damaged: 'The downloaded model files are damaged. Install the model again in Settings → Audio to download a fresh copy.',
  vcRuntime: 'Local speech models need the Microsoft Visual C++ runtime, and this PC does not have it. Install the "Microsoft Visual C++ Redistributable (x64)" from https://aka.ms/vs/17/release/vc_redist.x64.exe, restart Natively, and try again. ',
  oldMac: 'Local speech models need macOS 13.3 or later. Update macOS in System Settings › General › Software Update, or use a cloud STT provider.',
};

test('a memory refusal shows the figures the gate measured', () => {
  const c = categorizeSttError(LOCAL.memory);
  assert.equal(c.category, 'local_model');
  assert.equal(c.title, 'Not Enough Memory');
  assert.equal(c.body, 'This computer has 0.61GB available and the local model needs 0.62GB. Close other apps, or choose a smaller local model in Settings → Audio.');
  // The wording that shipped in 2.9.2 has no figures to show.
  const old = categorizeSttError(LOCAL.memoryV292);
  assert.equal(old.title, 'Not Enough Memory');
  assert.match(old.body, /^There is not enough free memory for the local model\./);
  assert.equal(categorizeSttError(LOCAL.outOfMemory).title, 'Not Enough Memory');
});

test('a model that never arrived is a download, not a lost provider connection', () => {
  for (const raw of [LOCAL.downloading, LOCAL.downloadFailed]) {
    const c = categorizeSttError(raw);
    assert.equal(c.category, 'local_model', raw);
    assert.equal(c.title, 'Local Model Not Downloaded');
  }
  // ENOTFOUND used to read as "Connection Lost: unable to reach the STT service".
  assert.equal(sttConnectionCause([LOCAL.downloadFailed]), null);
});

test('any other local failure says the model stopped, with no key or provider advice', () => {
  for (const raw of [LOCAL.notReady, LOCAL.crashed, LOCAL.noSlot, LOCAL.damaged]) {
    const c = categorizeSttError(raw);
    assert.equal(c.category, 'local_model', raw);
    assert.equal(c.title, 'Local Model Stopped');
    assert.doesNotMatch(c.body, /\bkey\b|unexpected issue/i);
  }
});

test('a missing runtime or OS is shown as written, for the platform that raised it', () => {
  for (const raw of [LOCAL.vcRuntime, LOCAL.oldMac]) {
    const c = categorizeSttError(raw);
    assert.equal(c.category, 'local_model');
    assert.equal(c.title, 'Local Model Cannot Run');
    assert.equal(c.body, raw.trim());
  }
});

test('cloud provider errors keep their categories', () => {
  assert.equal(categorizeSttError('401 Unauthorized').category, 'auth');
  assert.equal(categorizeSttError('503 Service Unavailable').category, 'service_unavailable');
  assert.equal(categorizeSttError('read ECONNRESET (ECONNRESET)').category, 'connection_lost');
  assert.equal(categorizeSttError('connect ETIMEDOUT 1.2.3.4:443 (ETIMEDOUT)').category, 'timed_out');
  assert.equal(categorizeSttError('transcription_quota_exceeded').category, 'quota');
  assert.equal(categorizeSttError('insufficient_quota: You have no credits remaining.').category, 'quota');
  assert.equal(categorizeSttError('Something odd happened').category, 'provider_error');
});

test('the banner cause: memory before download before any other local failure; null for cloud', () => {
  assert.equal(sttLocalModelCause([LOCAL.crashed, LOCAL.memory]), 'memory');
  assert.equal(sttLocalModelCause(['', LOCAL.downloading]), 'download');
  assert.equal(sttLocalModelCause([LOCAL.notReady, '']), 'model');
  assert.equal(sttLocalModelCause(['401 Unauthorized', 'read ECONNRESET']), null);
  assert.equal(sttLocalModelCause(['', '']), null);
});

test('the phrases the mapper keys on still exist where the errors are raised', () => {
  const sources = {
    'electron/audio/LocalWhisperSTT.ts': ['Local STT could not start: insufficient available memory', 'is still downloading', 'did not finish loading', 'The local STT engine stopped'],
    'electron/utils/onnxThreadConfig.ts': ['GB available, this model needs ', 'no ONNX session slot became free'],
    'electron/audio/whisper/loadFailure.ts': ['The local model could not be loaded because this computer ran out of memory', 'The local model could not be downloaded', 'The downloaded model files are damaged', 'Local speech models need the Microsoft Visual C++ runtime'],
    'electron/audio/whisper/onnxMacSupport.ts': ['Local speech models need macOS'],
  };
  for (const [file, phrases] of Object.entries(sources)) {
    const src = read(file);
    for (const phrase of phrases) assert.ok(src.includes(phrase), `${file} no longer says: ${phrase}`);
  }
});
