// Regression test for "Auto Detect on Google STT can never detect the
// user's language" (ru/uk transcribed as English gibberish).
//
// Two causes, both fixed:
//   1. AppState.setRecognitionLanguage silently rewrote 'auto' →
//      'english-us' for every non-natively provider, pinning the stream
//      to en-US before detection could even be attempted.
//   2. GoogleSTT's auto branch hardcoded fr/es/de as the alternative
//      language codes (Google STT v1 caps them at 3), so Russian and
//      Ukrainian were never candidates at all.
//
// Fix: the substitution is gone, and googleAutoDetectAlternates() builds
// the 3-slot alternates list from the user's OS preferred languages,
// falling back to fr/es/de only when nothing matches.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distConfig = path.resolve(__dirname, '../../../dist-electron/electron/config');

const { googleAutoDetectAlternates } = await import(path.join(distConfig, 'languages.js'));

test('OS preferred languages take the alternate slots (en skipped as primary)', () => {
    assert.deepEqual(
        googleAutoDetectAlternates(['en-GB', 'en-UA', 'uk-UA', 'ru-UA']),
        ['uk-UA', 'ru-RU', 'fr-FR'],
    );
});

test('English-only or empty preferences fall back to the historical defaults', () => {
    assert.deepEqual(googleAutoDetectAlternates(['en-US']), ['fr-FR', 'es-ES', 'de-DE']);
    assert.deepEqual(googleAutoDetectAlternates([]), ['fr-FR', 'es-ES', 'de-DE']);
});

test('duplicate language subtags collapse and the list caps at 3', () => {
    assert.deepEqual(
        googleAutoDetectAlternates(['ru-RU', 'ru-UA', 'uk-UA']),
        ['ru-RU', 'uk-UA', 'fr-FR'],
    );
    assert.deepEqual(
        googleAutoDetectAlternates(['ja-JP', 'ko-KR', 'zh-CN', 'ru-RU']),
        ['ja-JP', 'ko-KR', 'zh-CN'],
    );
});

test('unsupported locales are skipped, fill avoids duplicating a match', () => {
    assert.deepEqual(
        googleAutoDetectAlternates(['xx-XX', 'uk-UA']),
        ['uk-UA', 'fr-FR', 'es-ES'],
    );
    assert.deepEqual(
        googleAutoDetectAlternates(['fr-FR']),
        ['fr-FR', 'es-ES', 'de-DE'],
    );
});

test("main.ts no longer rewrites 'auto' to 'english-us' for non-natively providers", () => {
    const mainSource = readFileSync(path.resolve(__dirname, '../../main.ts'), 'utf8');
    assert.ok(
        !mainSource.includes("key === 'auto' && sttProvider !== 'natively'"),
        "the auto → english-us substitution must stay removed from AppState.setRecognitionLanguage",
    );
});

test('GoogleSTT auto branch uses googleAutoDetectAlternates, not a hardcoded list', () => {
    const sttSource = readFileSync(path.resolve(__dirname, '../GoogleSTT.ts'), 'utf8');
    assert.ok(sttSource.includes('googleAutoDetectAlternates('));
    assert.ok(
        !sttSource.includes("this.alternativeLanguageCodes = ['fr-FR', 'es-ES', 'de-DE']"),
        'auto mode must not pin the alternates to fr/es/de',
    );
});
