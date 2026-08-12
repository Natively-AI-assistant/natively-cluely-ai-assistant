// languageTable.ts has zero local imports (pure data + a lookup function),
// so — same precedent as cacheState.test.mjs in this directory — it can be
// imported directly as a '.ts' specifier and run standalone via
// `node --test electron/audio/whisper/nemotron/__tests__/languageTable.test.mjs`,
// no prior `tsc`/`build:electron` step required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveNemotronLangId, NEMOTRON_TRANSCRIPTION_READY_LOCALES } from '../languageTable.ts';

test('resolveNemotronLangId("en-US") returns 0, not the old wrong vocab id 2947', () => {
  // This is the regression check that matters most: the plan's original
  // (wrong) Task 12 table would also produce a value for 'en-US' — 2947,
  // the tokenizer.json vocabulary id of the literal token '<en-US>' — which
  // task-11's investigation empirically confirmed produces EMPTY
  // transcription against the real model. A test asserting 2947 here would
  // silently validate a reintroduced version of that exact bug.
  assert.equal(resolveNemotronLangId('en-US'), 0);
  assert.notEqual(resolveNemotronLangId('en-US'), 2947);
});

test('resolveNemotronLangId("de-DE") returns 9', () => {
  assert.equal(resolveNemotronLangId('de-DE'), 9);
});

test('resolveNemotronLangId("mt-MT") returns null (adaptation-ready tier, not transcription-ready)', () => {
  // Maltese is present in the real reference PROMPT_DICTIONARY (index 102)
  // but deliberately excluded from this app's restricted 19-locale table —
  // confirms the transcription-ready restriction is real, not accidentally
  // permissive.
  assert.equal(resolveNemotronLangId('mt-MT'), null);
});

test('resolveNemotronLangId returns null for "auto" and unknown locales', () => {
  assert.equal(resolveNemotronLangId('auto'), null);
  assert.equal(resolveNemotronLangId('not-a-real-locale'), null);
});

test('all 19 transcription-ready table entries match the verified reference values exactly', () => {
  const expected = {
    'en-US': 0, 'en-GB': 1,
    'es-US': 3, 'es-ES': 2,
    'fr-FR': 8, 'fr-CA': 100,
    'it-IT': 15,
    'pt-BR': 12, 'pt-PT': 13,
    'nl-NL': 16,
    'de-DE': 9,
    'tr-TR': 18,
    'ru-RU': 11,
    'ar-AR': 7,
    'hi-IN': 6,
    'ja-JP': 10,
    'ko-KR': 14,
    'vi-VN': 33,
    'uk-UA': 19,
  };
  assert.deepEqual(NEMOTRON_TRANSCRIPTION_READY_LOCALES, expected);
  assert.equal(Object.keys(NEMOTRON_TRANSCRIPTION_READY_LOCALES).length, 19);
  for (const [locale, langId] of Object.entries(expected)) {
    assert.equal(resolveNemotronLangId(locale), langId, `mismatch for ${locale}`);
  }
});
