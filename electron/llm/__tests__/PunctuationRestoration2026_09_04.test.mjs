// electron/llm/__tests__/PunctuationRestoration2026_09_04.test.mjs
//
// Candidate P's pure decoder, and the provenance rules around it.
//
// The decoder's hard part is WordPiece subwords, and getting them wrong fails
// silently: the output still reads like English, so nothing downstream notices
// that a word was dropped or mangled. Hence both the subword tests and the
// faithfulness guard.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const load = (f) => import(pathToFileURL(path.join(repoRoot, 'dist-electron/electron/llm', f)).href);

const { parseLabel, restoreFromLabels, isFaithfulRestoration } = await load('punctuationRestoration.js');
const { provenanceAfterRestoration, shouldRestorePunctuation, punctuationSourceFor } = await load('punctuationProvenance.js');

const tok = (word, entity, score) => ({ word, entity, score });

describe('label parsing', () => {
  test('splits the fused casing+punctuation label', () => {
    assert.deepEqual(parseLabel('Upper,'), { casing: 'Upper', punctuation: ',' });
    assert.deepEqual(parseLabel('UPPER?'), { casing: 'UPPER', punctuation: '?' });
    assert.deepEqual(parseLabel('lower.'), { casing: 'lower', punctuation: '.' });
  });

  test('underscore means NO punctuation and must never be emitted', () => {
    assert.equal(parseLabel('lower_').punctuation, '');
    assert.equal(parseLabel('Upper_').punctuation, '');
  });

  test('an unknown label degrades to a no-op instead of throwing', () => {
    // One odd label must not lose an entire turn.
    assert.doesNotThrow(() => parseLabel('nonsense'));
    assert.doesNotThrow(() => parseLabel(''));
    assert.doesNotThrow(() => parseLabel(undefined));
  });
});

describe('decoding', () => {
  test('applies casing and trailing punctuation', () => {
    const r = restoreFromLabels([tok('hey', 'Upper,'), tok('john', 'Upper_'), tok('ok', 'UPPER.')]);
    assert.equal(r.text, 'Hey, John OK.');
  });

  test('GLUES WordPiece subwords without spacing or re-casing them', () => {
    // "what's" tokenises to what + ##s. Applying the ##s token's casing would
    // produce "WhatS"; spacing it would produce "what s". Both read as English
    // and both are wrong.
    const r = restoreFromLabels([tok('what', 'Upper_'), tok('##s', 'lower_'), tok('up', 'lower?')]);
    assert.equal(r.text, 'Whats up?');
  });

  test("a subword's punctuation lands at the END of the whole word", () => {
    const r = restoreFromLabels([tok('invalid', 'lower_'), tok('##ation', 'lower?')]);
    assert.equal(r.text, 'invalidation?');
  });

  test('trailing punctuation on the final token is not lost', () => {
    const r = restoreFromLabels([tok('yes', 'Upper.')]);
    assert.equal(r.text, 'Yes.');
  });

  test('averages confidence and reports token count', () => {
    const r = restoreFromLabels([tok('a', 'lower_', 0.8), tok('b', 'lower_', 0.6)]);
    assert.equal(r.confidence, 0.7);
    assert.equal(r.tokenCount, 2);
    assert.equal(restoreFromLabels([tok('a', 'lower_')]).confidence, null, 'no scores means null, not 0');
  });

  test('never throws on malformed tokens', () => {
    assert.doesNotThrow(() => restoreFromLabels([null, undefined, {}, tok('ok', 'lower_')]));
    assert.equal(restoreFromLabels([]).text, '');
  });
});

describe('faithfulness guard', () => {
  test('accepts a restoration that only adds marks and casing', () => {
    assert.equal(isFaithfulRestoration('hey john did you get that email', 'Hey, John, did you get that email?'), true);
  });

  test('REJECTS a restoration that drops or invents a word', () => {
    // The silent failure mode of a broken subword decoder. Without this the
    // corpus would carry text the speaker never said.
    assert.equal(isFaithfulRestoration('hey john did you get that email', 'Hey, did you get that email?'), false);
    assert.equal(isFaithfulRestoration('hey john', 'Hey, John, indeed.'), false);
  });

  test('is insensitive to casing and punctuation, sensitive to words', () => {
    assert.equal(isFaithfulRestoration('a b c', 'A, B; C!'), true);
    assert.equal(isFaithfulRestoration('a b c', 'A B D'), false);
  });
});

describe('provenance after restoration', () => {
  test('NEVER downgrades a provider that actually punctuates', () => {
    // A provider explicitly requesting question marks is better evidence than a
    // local model's guess. Overwriting it with `restored` would weaken real
    // evidence, which is the mirror of the LocalWhisper mis-stamp already
    // documented in punctuationProvenance.ts.
    assert.equal(provenanceAfterRestoration('provider_final'), 'provider_final');
    assert.equal(provenanceAfterRestoration('provider_interim'), 'provider_interim');
  });

  test('upgrades unavailable to restored', () => {
    assert.equal(provenanceAfterRestoration('unavailable'), 'restored');
    assert.equal(provenanceAfterRestoration(undefined), 'restored');
  });

  test('restoration is skipped when the provider already punctuates', () => {
    assert.equal(shouldRestorePunctuation('provider_final'), false);
    assert.equal(shouldRestorePunctuation('provider_interim'), false);
    assert.equal(shouldRestorePunctuation('unavailable'), true);
    assert.equal(shouldRestorePunctuation(undefined), true);
  });

  test('the provider map is unchanged by this work', () => {
    assert.equal(punctuationSourceFor('deepgram', true), 'provider_final');
    assert.equal(punctuationSourceFor('google', false), 'provider_interim');
    assert.equal(punctuationSourceFor('soniox', true), 'unavailable');
    assert.equal(punctuationSourceFor('local-whisper', true), 'unavailable',
      'local models emit sentence punctuation but rarely question marks; measured, not assumed');
  });
});
