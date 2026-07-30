// Tests for the phonetic post-processing fix that restores English tech
// terms mangled by a ru/uk-primary STT model ("стейтлес виджет" →
// "Stateless Widget"). Runs on FINAL transcripts only, provider-agnostic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distLlm = path.resolve(__dirname, '../../../dist-electron/electron/llm');

const { fixMangledTechTerms, phoneticSkeleton } = await import(path.join(distLlm, 'transcriptTermFix.js'));

test('skeletons of English spelling and Russian phonetics converge', () => {
    assert.equal(phoneticSkeleton('stateless'), phoneticSkeleton('стейтлес'));
    assert.equal(phoneticSkeleton('stateful'), phoneticSkeleton('стейтфул'));
    assert.equal(phoneticSkeleton('widget'), phoneticSkeleton('виджет'));
    assert.equal(phoneticSkeleton('flutter'), phoneticSkeleton('флаттер'));
    assert.equal(phoneticSkeleton('docker'), phoneticSkeleton('докер'));
    assert.equal(phoneticSkeleton('kubernetes'), phoneticSkeleton('кубернетес'));
});

test('the motivating sentence gets its terms restored', () => {
    const fixed = fixMangledTechTerms('в чём разница между стейтлес виджет и стейтфул виджет');
    assert.ok(fixed.includes('Stateless Widget'), fixed);
    assert.ok(fixed.includes('Stateful Widget'), fixed);
    assert.ok(fixed.startsWith('в чём разница между'), 'surrounding Russian text must survive');
});

test('single distinctive terms are fixed, punctuation preserved', () => {
    assert.equal(fixMangledTechTerms('мы используем кубернетес.'), 'мы используем Kubernetes.');
    assert.equal(fixMangledTechTerms('запусти хот релоад, пожалуйста'), 'запусти hot reload, пожалуйста');
});

test('ordinary Russian speech is never rewritten', () => {
    const sentences = [
        'я вчера гулял в парке и думал о жизни',
        'давайте начнём встречу с обсуждения планов',
        'сколько это стоит и когда можно начать',
    ];
    for (const s of sentences) {
        assert.equal(fixMangledTechTerms(s), s);
    }
});

test('Latin text and English-only finals pass through untouched', () => {
    assert.equal(fixMangledTechTerms('what is the difference between stateless and stateful widgets'),
        'what is the difference between stateless and stateful widgets');
    assert.equal(fixMangledTechTerms(''), '');
});

test('already-correct Latin terms inside Russian text are not doubled', () => {
    const s = 'разница между Stateless Widget и обычным виджетом в том что';
    const fixed = fixMangledTechTerms(s);
    assert.ok(fixed.startsWith('разница между Stateless Widget'), fixed);
});
