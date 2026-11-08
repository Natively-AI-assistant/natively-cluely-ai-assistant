// Marathi, Tamil, Telugu, Bengali, Gujarati, Kannada, Malayalam, Punjabi and
// Urdu in the recognition-language picker (2026-10-16). The relay already pins
// them; these tests hold the app side to what each provider accepts, measured
// live the same day: Soniox and ElevenLabs take all nine, Deepgram Nova-3 all
// but Malayalam, Nova-2 none but Hindi, and Google names Punjabi and Urdu its
// own way. Nothing here branches on the operating system.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../..');
const dist = (f) => require(path.join(repoRoot, 'dist-electron/electron', f));
const src = (f) => fs.readFileSync(path.join(repoRoot, f), 'utf8');

const NEW = {
  marathi: ['Marathi', 'mr-IN', 'mr'],
  tamil: ['Tamil', 'ta-IN', 'ta'],
  telugu: ['Telugu', 'te-IN', 'te'],
  bengali: ['Bengali', 'bn-IN', 'bn'],
  gujarati: ['Gujarati', 'gu-IN', 'gu'],
  kannada: ['Kannada', 'kn-IN', 'kn'],
  malayalam: ['Malayalam', 'ml-IN', 'ml'],
  punjabi: ['Punjabi', 'pa-IN', 'pa'],
  urdu: ['Urdu', 'ur-IN', 'ur'],
};

describe('the language table', () => {
  const L = dist('config/languages.js');

  test('each language has its own entry, auto-detect alternate and answer language', () => {
    for (const [key, [label, bcp47, iso639]] of Object.entries(NEW)) {
      assert.deepEqual(L.RECOGNITION_LANGUAGES[key], { label, code: key, bcp47, iso639, group: label }, key);
      assert.ok(L.AUTO_DETECT_ALTERNATES.includes(bcp47), `${bcp47} must be an auto-detect alternate`);
      assert.ok(L.AI_RESPONSE_LANGUAGES.some((l) => l.label === label && l.code === label), `${label} answer language`);
      assert.equal(L.PARAKEET_ONLY_LANGUAGE_KEYS.has(key), false, `${key} is a cloud language, not Parakeet-only`);
      assert.equal(L.isRecognitionLanguageOffered(key, null, null), true, `${key} offered by an unrestricted provider`);
    }
  });

  test('the relay sends at most five alternates, and the new ones do not displace the first five', () => {
    assert.deepEqual(L.AUTO_DETECT_ALTERNATES.slice(0, 5), ['en-US', 'en-GB', 'en-IN', 'en-AU', 'en-CA']);
  });

  test('a stored key resolves to itself', () => {
    for (const key of Object.keys(NEW)) assert.equal(L.normalizeSttLanguageKey(key), key);
  });
});

describe('local models', () => {
  const M = dist('audio/whisper/modelLanguageSupport.js');
  const { MODEL_CATALOG } = dist('audio/whisper/modelManager.js');

  test('multilingual Whisper gets a language token for each', () => {
    for (const [key, [label]] of Object.entries(NEW)) {
      assert.equal(M.resolveWhisperLanguage(key), label.toLowerCase(), key);
    }
    const whisper = MODEL_CATALOG.find((m) => m.multilingual && !/parakeet|nemotron/i.test(m.id));
    assert.ok(whisper, 'catalog has a multilingual Whisper model');
    const allowed = M.getLocalModelLanguageSupport(whisper.id).allowedLanguageKeys;
    for (const key of Object.keys(NEW)) assert.ok(allowed.includes(key), `${whisper.id} offers ${key}`);
  });

  test('Parakeet and Nemotron, which have none of them, do not offer them', () => {
    for (const m of MODEL_CATALOG.filter((x) => /parakeet|nemotron/i.test(x.id))) {
      const allowed = M.getLocalModelLanguageSupport(m.id).allowedLanguageKeys;
      for (const key of Object.keys(NEW)) assert.equal(allowed.includes(key), false, `${m.id} must not offer ${key}`);
    }
  });
});

describe('Deepgram: never connect with a language the model refuses', () => {
  const cat = dist('audio/sttModelCatalog.js');
  const { DeepgramStreamingSTT } = dist('audio/DeepgramStreamingSTT.js');

  test('the catalogue records what each model refused live', () => {
    assert.equal(cat.sttModelRejectsLanguage('deepgram', 'nova-3', 'ml'), true);
    for (const iso of ['hi', 'mr', 'ta', 'te', 'bn', 'gu', 'kn', 'pa', 'ur', 'fr', 'en']) {
      assert.equal(cat.sttModelRejectsLanguage('deepgram', 'nova-3', iso), false, `nova-3 ${iso}`);
    }
    for (const iso of ['mr', 'ta', 'te', 'bn', 'gu', 'kn', 'ml', 'pa', 'ur']) {
      assert.equal(cat.sttModelRejectsLanguage('deepgram', 'nova-2', iso), true, `nova-2 ${iso}`);
    }
    assert.equal(cat.sttModelRejectsLanguage('deepgram', 'nova-2', 'hi'), false);
    assert.equal(cat.sttModelRejectsLanguage('deepgram', 'nova-3', ''), false);
  });

  test('a refused language connects as multi; an accepted one is sent as is', () => {
    const nova3 = new DeepgramStreamingSTT('k', 'nova-3');
    nova3.setRecognitionLanguage('malayalam');
    assert.equal(nova3.connectLanguage(), 'multi');
    nova3.setRecognitionLanguage('marathi');
    assert.equal(nova3.connectLanguage(), 'mr');
    const nova2 = new DeepgramStreamingSTT('k', 'nova-2');
    nova2.setRecognitionLanguage('tamil');
    assert.equal(nova2.connectLanguage(), 'multi');
    nova2.setRecognitionLanguage('hindi');
    assert.equal(nova2.connectLanguage(), 'hi');
    const med = new DeepgramStreamingSTT('k', 'nova-3-medical');
    med.setRecognitionLanguage('malayalam');
    assert.equal(med.connectLanguage(), 'en', 'English-only models still get English');
  });

  test('Settings hides refused languages for the picked model and shows the Auto it gets', () => {
    const s = src('src/components/SettingsOverlay.tsx');
    const cap = s.slice(s.indexOf('const deepgramLanguageCapability = useMemo'), s.indexOf('}, [sttProvider, sttModels.deepgram, availableLanguages]);'));
    assert.match(cap, /sttModelRejectsLanguage\('deepgram', model, /);
    assert.match(s, /const showsAutoFallback = !showsEnglishFallback && sttProvider === 'deepgram' && storedLanguageUnsupported;/);
    assert.match(s, /const showsEnglishFallback = \(languageLocked \|\| deepgramEnglishOnly\)/);
  });
});

test('Google gets the codes it lists for Punjabi and Urdu', () => {
  const g = src('electron/audio/GoogleSTT.ts');
  assert.match(g, /'pa-IN':\s*'pa-Guru-IN'/);
  assert.match(g, /'ur-IN':\s*'ur-PK'/);
});
