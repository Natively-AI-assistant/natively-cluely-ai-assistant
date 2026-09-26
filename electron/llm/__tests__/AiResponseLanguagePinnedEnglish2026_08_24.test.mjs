// Regression test: "AI Response Language = English" behaved exactly like "Auto".
//
// Symptom (reported 2026-08-24): a user picks English in Settings, an
// interviewer asks a question in Hindi/Spanish, and the answer comes back in
// Hindi/Spanish. Indistinguishable from the Auto setting.
//
// Root cause: THREE layers each treated 'English' as "no instruction":
//   1. LLMHelper.buildLanguageInstructionSuffix()  -> `return ""` for English
//   2. LLMHelper generateWithNatively/streamWithNatively -> omitted body.language
//   3. natively-api injectLanguagePrompt()         -> no-op for English
// and NO base system prompt states a response language (grepped
// HARD_/GROQ_/CLAUDE_/OPENAI_SYSTEM_PROMPT + resolveV2SystemPrompt), so nothing
// backstopped the omission. With zero directives the model simply mirrors the
// speaker — which IS auto-detect behaviour.
//
// This file pins layer 1, the one that reaches the model on EVERY provider
// (own-key Gemini/Groq/OpenAI/Claude included, where body.language does not
// exist to rescue it).
//
// buildLanguageInstructionSuffix is a pure private method reading only
// this.aiResponseLanguage, so it is invoked on a prototype-only instance —
// the same technique as ClaudeCacheMinChars.test.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LLMHelper } = require('../../../dist-electron/electron/LLMHelper.js');

const suffixFor = (aiResponseLanguage) =>
  LLMHelper.prototype.buildLanguageInstructionSuffix.call(
    Object.assign(Object.create(LLMHelper.prototype), { aiResponseLanguage }),
  );

describe('buildLanguageInstructionSuffix — pinned language is always an instruction', () => {
  test('English emits a real override block (was: empty string)', () => {
    const out = suffixFor('English');
    assert.notEqual(out.trim(), '', 'English must not produce an empty suffix');
    assert.match(out, /LANGUAGE OVERRIDE/,
      'must carry the LANGUAGE OVERRIDE sentinel so the server-side injector dedupes');
    assert.match(out, /English/);
  });

  test('the English block does not contain the non-English block\'s self-contradiction', () => {
    // The generic block says "Do NOT use English anywhere in your response."
    // Reusing it verbatim for English would instruct the model to avoid the very
    // language it was told to write in.
    const out = suffixFor('English');
    assert.doesNotMatch(out, /Do NOT use English anywhere/i);
  });

  test('English is distinguishable from auto', () => {
    const english = suffixFor('English');
    const auto = suffixFor('auto');
    assert.notEqual(english, auto);
    assert.match(auto, /LANGUAGE INSTRUCTION/, 'auto keeps its mirror-the-speaker block');
    assert.doesNotMatch(english, /Detect the language of the user/,
      'English must not tell the model to mirror the speaker');
  });

  test('English forbids mirroring the question language', () => {
    const out = suffixFor('English');
    assert.match(out, /even when the question is asked in another language/i);
  });

  test('non-English selections keep their existing override block', () => {
    for (const lang of ['Spanish', 'Hindi', 'Japanese']) {
      const out = suffixFor(lang);
      assert.match(out, /LANGUAGE OVERRIDE/);
      assert.match(out, new RegExp(lang));
      assert.match(out, /Do NOT use English anywhere/i);
    }
  });

  test('auto and unset both mirror the speaker', () => {
    for (const value of ['auto', '', undefined, null]) {
      assert.match(suffixFor(value), /LANGUAGE INSTRUCTION/);
    }
  });
});
