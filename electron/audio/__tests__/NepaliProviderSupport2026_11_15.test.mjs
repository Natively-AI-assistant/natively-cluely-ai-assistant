// Nepali in the recognition-language picker (PR #736, 2026-11-15). Measured
// live the same day: Deepgram Nova-3 accepts `ne`, Nova-2 refuses it with
// HTTP 400; Soniox lists 60 languages on GET /v1/models and Nepali is not one
// (a pinned `ne` is 400 "Invalid language hint", which ends the session). The
// Natively API relay starts on Soniox and turns that refusal into auto-detect,
// so Nepali is held back there too. Nothing here branches on the operating
// system, so these run the same on macOS and Windows.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (f) => require(path.join(REPO, 'dist-electron/electron', f));
const src = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

const L = dist('config/languages.js');

describe('the Nepali entry', () => {
  test('is a recognition language, an auto-detect alternate and an answer language', () => {
    assert.deepEqual(L.RECOGNITION_LANGUAGES.nepali, { label: 'Nepali', code: 'nepali', bcp47: 'ne-NP', iso639: 'ne', group: 'Nepali' });
    assert.ok(L.AUTO_DETECT_ALTERNATES.includes('ne-NP'));
    assert.ok(L.AI_RESPONSE_LANGUAGES.some((l) => l.label === 'Nepali' && l.code === 'Nepali'));
  });
});

describe('which providers offer Nepali', () => {
  test('Soniox and the Natively API refuse it; other cloud providers are not narrowed', () => {
    assert.equal(L.sttProviderRejectsLanguage('soniox', 'nepali'), true);
    assert.equal(L.sttProviderRejectsLanguage('natively', 'nepali'), true);
    for (const p of ['elevenlabs', 'google', 'deepgram', 'openai', 'groq', 'azure', null, undefined]) {
      assert.equal(L.sttProviderRejectsLanguage(p, 'nepali'), false, String(p));
    }
  });

  test('every language Soniox has stays offered under Soniox and the Natively API', () => {
    for (const key of Object.keys(L.RECOGNITION_LANGUAGES)) {
      if (key === 'nepali' || key === 'maltese') continue;
      assert.equal(L.sttProviderRejectsLanguage('soniox', key), false, key);
      assert.equal(L.sttProviderRejectsLanguage('natively', key), false, key);
    }
  });

  test('the picker hides Nepali under Soniox and the Natively API only', () => {
    assert.equal(L.isRecognitionLanguageOffered('nepali', null, null, 'soniox'), false);
    assert.equal(L.isRecognitionLanguageOffered('nepali', null, null, 'natively'), false);
    assert.equal(L.isRecognitionLanguageOffered('nepali', null, null, 'elevenlabs'), true);
    assert.equal(L.isRecognitionLanguageOffered('nepali', null, null), true);
    assert.equal(L.isRecognitionLanguageOffered('hindi', null, null, 'soniox'), true);
  });

  test('Settings and the notes picker pass the active provider', () => {
    assert.match(src('src/components/SettingsOverlay.tsx'), /isRecognitionLanguageOffered\([^)]*allowedLanguageKeySet, sttProvider\)/);
    assert.match(src('src/components/notes/TranscriptControls.tsx'), /isRecognitionLanguageOffered\(k, null, null, provider\)/);
  });
});

describe('Deepgram', () => {
  const C = dist('audio/sttModelCatalog.js');
  test('Nova-2 refuses Nepali, Nova-3 takes it', () => {
    assert.equal(C.sttModelRejectsLanguage('deepgram', 'nova-2', 'ne'), true);
    assert.equal(C.sttModelRejectsLanguage('deepgram', 'nova-3', 'ne'), false);
  });
});

describe('failover', () => {
  const S = dist('audio/sttLanguageSupport.js');
  const deps = { modelFor: () => undefined, isEnglishOnlyModel: () => false, localModelLanguageKeys: () => null };
  test('a Nepali meeting is not handed to Soniox, but is to ElevenLabs', () => {
    assert.deepEqual(S.candidatesForLanguage(['soniox', 'elevenlabs', 'google'], 'nepali', deps), ['elevenlabs', 'google']);
    assert.deepEqual(S.candidatesForLanguage(['soniox', 'elevenlabs'], 'hindi', deps), ['soniox', 'elevenlabs']);
  });
});

describe('Soniox with Nepali stored', () => {
  test('falls back to auto-detect instead of sending the hint it refuses', async () => {
    const { SonioxStreamingSTT } = dist('audio/SonioxStreamingSTT.js');
    const stt = Object.create(SonioxStreamingSTT.prototype);
    Object.assign(stt, { apiKey: 'k', sampleRate: 16000, numChannels: 1, isActive: false });
    stt.setRecognitionLanguage('nepali');
    const frame = stt.buildConfigFrame();
    assert.equal(frame.language_hints, undefined);
    assert.equal(frame.enable_language_identification, true);
    stt.setRecognitionLanguage('hindi');
    assert.deepEqual(stt.buildConfigFrame().language_hints, ['hi']);
  });
});
