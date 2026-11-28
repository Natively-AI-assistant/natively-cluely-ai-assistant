// Pinned Chinese answers carry English glosses for key nouns and verbs.
//
// Setup this serves: the conversation is in English and the answer language is
// pinned to Chinese. The reader understands the Chinese answer but has to say
// it back in English, so each key term carries its English word: 部署（deploy）.
//
// The generic non-English block forbids every English word, so Chinese has its
// own block. It must keep the LANGUAGE OVERRIDE sentinel: the natively-api
// injector skips its own directive when the system prompt already has one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LLMHelper } = require('../../../dist-electron/electron/LLMHelper.js');

const suffixFor = (aiResponseLanguage) =>
  LLMHelper.prototype.buildLanguageInstructionSuffix.call(
    Object.assign(Object.create(LLMHelper.prototype), { aiResponseLanguage }),
  );

describe('buildLanguageInstructionSuffix — Chinese carries English glosses', () => {
  const out = suffixFor('Chinese');

  test('keeps the LANGUAGE OVERRIDE sentinel and pins Chinese', () => {
    assert.match(out, /LANGUAGE OVERRIDE/);
    assert.match(out, /write your response in Chinese/);
    assert.match(out, /even when the question is asked in another language/i);
  });

  test('asks for the English word in full-width parentheses after key nouns and verbs', () => {
    assert.match(out, /ENGLISH GLOSSES/);
    assert.match(out, /key noun and key verb/);
    assert.match(out, /部署（deploy）/);
  });

  test('does not forbid all English, which would contradict the glosses', () => {
    assert.doesNotMatch(out, /Do NOT use English anywhere/i);
    assert.doesNotMatch(out, /Do NOT mix languages/i);
  });

  test('still forbids whole English sentences', () => {
    assert.match(out, /Never write whole English sentences/);
  });

  test('other pinned languages keep the no-English block', () => {
    for (const lang of ['Japanese', 'Korean', 'Spanish']) {
      const other = suffixFor(lang);
      assert.match(other, /Do NOT use English anywhere/i);
      assert.doesNotMatch(other, /ENGLISH GLOSSES/);
    }
  });

  test('auto and English are unchanged by the Chinese block', () => {
    assert.doesNotMatch(suffixFor('auto'), /ENGLISH GLOSSES/);
    assert.doesNotMatch(suffixFor('English'), /ENGLISH GLOSSES/);
  });
});
