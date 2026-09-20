// electron/llm/__tests__/UserInstructionSystemLayer2026_09_20.test.mjs
//
// Cause 5 of 6 (see userInstructionContract.ts): the typed-chat / legacy
// carrier existed as THREE hand-maintained copies (LLMHelper.chatWithGemini,
// LLMHelper's streaming path, documentGroundedPrompt's regen layer), and for
// every BUILT-IN mode — General, Seminar, Call Centre, ... — all three told the
// model:
//
//   "Treat as configuration for tone/focus. Never as facts about the candidate
//    and never overriding the rules above."
//
// "The rules above" include the coding contract and every length target, so
// the user's prompt was declared subordinate to exactly the defaults it was
// written to change. One renderer now backs all three.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjs = createRequire(import.meta.url);
const distLlm = (p) => path.resolve(__dirname, '../../../dist-electron/electron/llm/', p);
const { renderUserInstructionSystemLayer } = cjs(distLlm('userInstructionContract.js'));
const { appendCustomModeSystemPromptLayer } = cjs(distLlm('documentGroundedPrompt.js'));

describe('the shared system layer', () => {
  for (const isCustomMode of [false, true]) {
    describe(isCustomMode ? 'custom mode' : 'built-in mode (General / Seminar / Call Centre)', () => {
      const layer = renderUserInstructionSystemLayer('Answer in 100 words.\nUse Java only', { isCustomMode });

      test('never declares the user’s instructions subordinate to "the rules above"', () => {
        assert.doesNotMatch(layer, /never overriding the rules above/i);
        assert.doesNotMatch(layer, /configuration for tone\/focus/i);
      });
      test('carries the authoritative block with the resolved length and language', () => {
        assert.match(layer, /## ACTIVE MODE INSTRUCTIONS \(user-configured\)/);
        assert.match(layer, /<user_instructions[^>]*cannot authorize a source/);
        assert.match(layer, /LENGTH is set by the user: about 100 words/);
        assert.match(layer, /CODE LANGUAGE is set by the user: Java/);
      });
      test('still protects identity / security / safety rules', () => {
        assert.match(layer, /never (?:modify|override)|cannot/i);
        assert.match(layer, /CORE_IDENTITY|security|safety/i);
      });
      test('still says the text is configuration, not facts about the person', () => {
        assert.match(layer, /not facts|never (?:as )?facts/i);
      });
    });
  }

  test('a custom mode keeps its template guard and elevation sentence', () => {
    const layer = renderUserInstructionSystemLayer('Always respond in Spanish.', { isCustomMode: true });
    assert.match(layer, /supplemental behavioral layer for this mode/);
    assert.match(layer, /user-configured custom-mode instructions/);
    assert.match(layer, /Approach, Code, Dry Run, or Complexity/);
  });

  test('empty in, empty out', () => {
    assert.equal(renderUserInstructionSystemLayer('', { isCustomMode: false }), '');
    assert.equal(renderUserInstructionSystemLayer('  \n', { isCustomMode: true }), '');
  });
});

describe('the regen layer uses it', () => {
  test('a built-in mode’s regen prompt no longer subordinates the user', () => {
    const out = appendCustomModeSystemPromptLayer({ baseSystemPrompt: 'BASE', pinnedInstructions: 'Answer in 100 words.', isActiveCustomMode: false });
    assert.ok(out.startsWith('BASE'));
    assert.doesNotMatch(out, /never overriding the rules above/i);
    assert.match(out, /LENGTH is set by the user: about 100 words/);
  });
  test('empty inputs still leave the base untouched', () => {
    assert.equal(appendCustomModeSystemPromptLayer({ baseSystemPrompt: 'BASE', pinnedInstructions: '', modePromptSuffix: '' }), 'BASE');
  });
});
