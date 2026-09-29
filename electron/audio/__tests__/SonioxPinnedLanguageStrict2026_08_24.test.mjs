// Regression test: picking an STT language did nothing on Soniox.
//
// Symptom (reported 2026-08-24): a user pins e.g. English (or Spanish) as the
// recognition language, speaks another language, and it is transcribed in that
// other language — i.e. the setting behaves exactly like Auto Detect.
//
// Two causes, both in the config frame this class sends:
//
//   1. `enable_language_identification: true` was set UNCONDITIONALLY — full
//      multilingual auto-detect was switched ON even for a pinned session.
//      (The natively-api relay already got this conditional right; the app's
//      direct-Soniox provider did not.)
//
//   2. `language_hints_strict: true` — Soniox's documented restriction flag
//      (https://soniox.com/docs/stt/concepts/language-restrictions) — appeared
//      NOWHERE in either repo.
//
//      MEASURED against the live stt-rt-v5 endpoint on 2026-08-24: the flag is
//      ACCEPTED but INERT there. Spanish and German fixtures pinned to ['en']
//      came back in their original language, byte-identical with and without
//      it. So this file pins the config we SEND, which is the documented and
//      forward-compatible shape; it does not claim the real-time model honours
//      it. Cause 1 above is the part that actually changes behaviour today.
//
// The config frame used to be built inline inside the ws 'open' handler, which
// is unreachable without a live socket. It now lives in buildConfigFrame() so
// the shipped logic — not a re-implementation — can be asserted directly.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');
const { SonioxStreamingSTT } = await import(
  pathToFileURL(path.join(distRoot, 'SonioxStreamingSTT.js')).href
);

const frameFor = (languageCode) =>
  SonioxStreamingSTT.prototype.buildConfigFrame.call(
    Object.assign(Object.create(SonioxStreamingSTT.prototype), {
      apiKey: 'test-key',
      sampleRate: 16000,
      numChannels: 1,
      languageCode,
    }),
  );

describe('SonioxStreamingSTT config frame — pinned language must actually pin', () => {
  test('a pinned language sends a STRICT hint', () => {
    const cfg = frameFor('es');
    assert.deepEqual(cfg.language_hints, ['es']);
    assert.equal(cfg.language_hints_strict, true,
      'send the documented restriction flag (inert on stt-rt-v5 today, see header)');
  });

  test('a pinned language does NOT switch on auto language identification', () => {
    const cfg = frameFor('es');
    assert.notEqual(cfg.enable_language_identification, true,
      'identification is auto-detect; enabling it for a pinned session IS the bug');
  });

  test('pinned English behaves like every other pinned language', () => {
    const cfg = frameFor('en');
    assert.deepEqual(cfg.language_hints, ['en']);
    assert.equal(cfg.language_hints_strict, true);
    assert.notEqual(cfg.enable_language_identification, true);
  });

  test('auto (no language code) keeps identification on and sends no hints', () => {
    const cfg = frameFor(undefined);
    assert.equal(cfg.enable_language_identification, true);
    assert.equal(cfg.language_hints, undefined);
    assert.equal(cfg.language_hints_strict, undefined);
  });

  test('the rest of the frame is unchanged in both modes', () => {
    for (const code of ['es', undefined]) {
      const cfg = frameFor(code);
      assert.equal(cfg.api_key, 'test-key');
      assert.equal(cfg.model, 'stt-rt-v5');
      assert.equal(cfg.audio_format, 'pcm_s16le');
      assert.equal(cfg.sample_rate, 16000);
      assert.equal(cfg.num_channels, 1);
      assert.equal(cfg.enable_endpoint_detection, true);
    }
  });
});

describe('setRecognitionLanguage feeds the frame', () => {
  test('an internal key resolves to its ISO-639-1 code and pins strictly', () => {
    const stt = Object.create(SonioxStreamingSTT.prototype);
    Object.assign(stt, { apiKey: 'k', sampleRate: 16000, numChannels: 1, isActive: false });
    stt.setRecognitionLanguage('spanish');
    assert.deepEqual(stt.buildConfigFrame().language_hints, ['es']);
    assert.equal(stt.buildConfigFrame().language_hints_strict, true);
  });

  test("'auto' clears the hint and re-enables identification", () => {
    const stt = Object.create(SonioxStreamingSTT.prototype);
    Object.assign(stt, { apiKey: 'k', sampleRate: 16000, numChannels: 1, isActive: false });
    stt.setRecognitionLanguage('spanish');
    stt.setRecognitionLanguage('auto');
    const cfg = stt.buildConfigFrame();
    assert.equal(cfg.language_hints, undefined);
    assert.equal(cfg.enable_language_identification, true);
  });
});
