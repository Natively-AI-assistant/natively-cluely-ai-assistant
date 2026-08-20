// Contract tests for electron/audio/whisper/modelLanguageSupport.ts — the
// single source of truth for which recognition languages each local STT model
// accepts (verified against each model's official docs; see that file's
// provenance comment).
//
// Guards three real regressions:
//  1. The worker's English-only guard was a hand-typed id list that omitted
//     Parakeet CTC (English-only per NVIDIA's model card). It is now derived
//     from MODEL_CATALOG's `multilingual` flag — assert every English-only
//     checkpoint is covered and no multilingual one is.
//  2. The worker's old LANG_MAP was keyed by BCP-47 tags while the host sends
//     the app's internal settings key ('english-us'), so language selection
//     silently never reached multilingual Whisper. resolveWhisperLanguage()
//     must resolve EVERY RECOGNITION_LANGUAGES key (and the legacy BCP-47
//     forms) to a valid Whisper language name.
//  3. The Settings UI restricts language options per model via
//     getLocalModelLanguageSupport() — assert the Nemotron set matches the
//     transcription-ready locale table and English-only models lock the
//     selects.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distWhisper = path.resolve(__dirname, '../../../../dist-electron/electron/audio/whisper');
const distConfig = path.resolve(__dirname, '../../../../dist-electron/electron/config');

const {
  getLocalModelLanguageSupport,
  isEnglishOnlyLocalModel,
  resolveWhisperLanguage,
} = await import(pathToFileURL(path.join(distWhisper, 'modelLanguageSupport.js')).href);
const { MODEL_CATALOG } = await import(pathToFileURL(path.join(distWhisper, 'modelManager.js')).href);
const { RECOGNITION_LANGUAGES, ENGLISH_VARIANTS } = await import(
  pathToFileURL(path.join(distConfig, 'languages.js')).href
);
const { NEMOTRON_TRANSCRIPTION_READY_LOCALES } = await import(
  pathToFileURL(path.join(distWhisper, 'nemotron/languageTable.js')).href
);

const NEMOTRON_ID = 'onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4';

// Whisper's official language names (openai/whisper tokenizer LANGUAGES) for
// every language this app offers — the resolver must never emit anything
// outside this set, or transformers.js throws "Unsupported language".
const OFFICIAL_WHISPER_NAMES = new Set([
  'english', 'indonesian', 'russian', 'spanish', 'french', 'german', 'italian',
  'portuguese', 'japanese', 'korean', 'chinese', 'turkish', 'ukrainian',
  'romanian', 'polish', 'dutch', 'arabic', 'hindi', 'swedish', 'norwegian',
  'danish', 'czech', 'hungarian', 'vietnamese', 'thai', 'greek', 'bulgarian',
  'hebrew', 'malay', 'finnish',
]);

test('every catalog model has a language-support entry with keys drawn from RECOGNITION_LANGUAGES', () => {
  for (const m of MODEL_CATALOG) {
    const s = getLocalModelLanguageSupport(m.id);
    assert.ok(s, `${m.id}: no support entry`);
    assert.ok(Array.isArray(s.allowedLanguageKeys) && s.allowedLanguageKeys.length > 0, `${m.id}: empty allowed set`);
    for (const key of s.allowedLanguageKeys) {
      assert.ok(key in RECOGNITION_LANGUAGES, `${m.id}: allowed key '${key}' is not a RECOGNITION_LANGUAGES key`);
    }
  }
});

test('English-only guard derives from the catalog and covers Parakeet (the old hand-typed set missed it)', () => {
  const englishOnly = MODEL_CATALOG.filter((m) => !m.multilingual).map((m) => m.id);
  const multilingual = MODEL_CATALOG.filter((m) => m.multilingual).map((m) => m.id);
  assert.ok(englishOnly.includes('onnx-community/parakeet-ctc-0.6b-ONNX'), 'catalog must mark Parakeet English-only');
  for (const id of englishOnly) {
    assert.equal(isEnglishOnlyLocalModel(id), true, `${id} must be English-only`);
  }
  for (const id of multilingual) {
    assert.equal(isEnglishOnlyLocalModel(id), false, `${id} must NOT be English-only`);
  }
  // Unknown ids fail conservative: strip language/task rather than pass them.
  assert.equal(isEnglishOnlyLocalModel('some/unknown-model'), true);
});

test('English-only models lock both selects and allow only the English variants', () => {
  for (const m of MODEL_CATALOG.filter((x) => !x.multilingual)) {
    const s = getLocalModelLanguageSupport(m.id);
    assert.equal(s.languageSelectable, false, `${m.id}: language must be locked`);
    assert.equal(s.accentSelectable, false, `${m.id}: accent must be locked`);
    assert.deepEqual(
      [...s.allowedLanguageKeys].sort(),
      Object.keys(ENGLISH_VARIANTS).sort(),
      `${m.id}: allowed set must be exactly the English variants`,
    );
  }
});

test('multilingual Whisper-family models allow every language including auto, but no accent conditioning', () => {
  const whisperMultilingual = MODEL_CATALOG.filter(
    (m) => m.multilingual && m.sessionLayout !== 'nemotron-rnnt',
  );
  assert.ok(whisperMultilingual.length > 0, 'catalog must contain multilingual Whisper checkpoints');
  for (const m of whisperMultilingual) {
    const s = getLocalModelLanguageSupport(m.id);
    assert.equal(s.languageSelectable, true, `${m.id}: language must be selectable`);
    assert.equal(s.accentSelectable, false, `${m.id}: Whisper has no accent/region parameter`);
    assert.deepEqual(
      [...s.allowedLanguageKeys].sort(),
      Object.keys(RECOGNITION_LANGUAGES).sort(),
      `${m.id}: must allow the full RECOGNITION_LANGUAGES set (Whisper's 99 languages are a superset)`,
    );
    assert.ok(s.allowedLanguageKeys.includes('auto'), `${m.id}: Whisper supports auto-detect`);
  }
});

test('Nemotron allows exactly the keys that resolve through the transcription-ready locale table — no auto', () => {
  const s = getLocalModelLanguageSupport(NEMOTRON_ID);
  assert.equal(s.languageSelectable, true);
  assert.equal(s.accentSelectable, true, 'Nemotron is the only local model with regional-variant conditioning');
  assert.ok(!s.allowedLanguageKeys.includes('auto'), 'Nemotron has no auto-detect mode');

  const expected = [
    // English variants: en-US/en-GB are table entries; en-IN/en-AU/en-CA route
    // to en-US via the documented inference in languageTable.ts.
    'english-us', 'english-uk', 'english-in', 'english-au', 'english-ca',
    // Direct table entries (ar-SA reaches ar-AR via the documented alias).
    'spanish', 'french', 'german', 'italian', 'portuguese', 'dutch',
    'turkish', 'russian', 'arabic', 'hindi', 'japanese', 'korean',
    'vietnamese', 'ukrainian',
  ];
  assert.deepEqual([...s.allowedLanguageKeys].sort(), expected.sort());

  // Sanity anchor against the verified table itself: every non-English
  // allowed key's BCP-47 locale (or its alias) must exist in the table.
  for (const key of s.allowedLanguageKeys) {
    if (key.startsWith('english-')) continue;
    const bcp47 = RECOGNITION_LANGUAGES[key].bcp47;
    const aliased = bcp47 === 'ar-SA' ? 'ar-AR' : bcp47;
    assert.ok(
      aliased in NEMOTRON_TRANSCRIPTION_READY_LOCALES,
      `${key} (${bcp47}) not in NEMOTRON_TRANSCRIPTION_READY_LOCALES`,
    );
  }
});

test('resolveWhisperLanguage covers every internal settings key (the old LANG_MAP resolved none of them)', () => {
  for (const [key, lang] of Object.entries(RECOGNITION_LANGUAGES)) {
    const resolved = resolveWhisperLanguage(key);
    if (key === 'auto') {
      assert.equal(resolved, null, "'auto' must resolve to null (Whisper auto-detect)");
      continue;
    }
    assert.ok(resolved, `internal key '${key}' must resolve`);
    assert.ok(OFFICIAL_WHISPER_NAMES.has(resolved), `'${key}' resolved to non-official name '${resolved}'`);
    // Legacy worker contract: BCP-47 tags and bare iso639 codes still resolve
    // to the same name.
    assert.equal(resolveWhisperLanguage(lang.bcp47), resolved, `bcp47 '${lang.bcp47}' must match key resolution`);
    assert.equal(resolveWhisperLanguage(lang.iso639), resolved, `iso639 '${lang.iso639}' must match key resolution`);
  }
  assert.equal(resolveWhisperLanguage(''), null);
  assert.equal(resolveWhisperLanguage('klingon'), null);
});
