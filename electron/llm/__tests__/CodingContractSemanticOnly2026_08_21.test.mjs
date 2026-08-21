// electron/llm/__tests__/CodingContractSemanticOnly2026_08_21.test.mjs
//
// RC-3 cause-side regression from live shadow session C (2026-08-21): in
// Technical Interview mode the six-section DSA contract was appended to the
// system prompt on EVERY turn — CODING_CONTRACT_MODES made the mode alone
// satisfy the trigger, so `codingTask:false` had no effect (measured live:
// byte-identical 15,982-char prompts with the flag on and off; small talk and
// "what's a semaphore?" both carried the full template, and the model applied
// it to conceptual questions inconsistently — presses 24/76/80/81 shipped the
// scaffold).
//
// Fix under test: the contract attaches SEMANTICALLY — when the routed turn is
// a coding task (`codingTask`, triple-sourced from answerType routing,
// caller-side promotion, and structural stub detection) or the action is
// coding-shaped (code_hint) — never from the mode alone. validateAnswerStructure
// only enforces the sections for coding answer types, where codingTask is true
// by construction from the same isCodingAnswerType source, so prompt and
// validator cannot diverge.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.NATIVELY_PROMPT_SYSTEM_V2 = '1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/', p)).href;
const { buildSystemPromptV2 } = await import(dist('promptSystemV2.js'));

const SCAFFOLD_MARKER = /## Dry Run/;

describe('RC-3 cause: mode alone no longer forces the coding contract', () => {
  test('technical-interview + answer + codingTask:false → NO contract', () => {
    const p = buildSystemPromptV2({ mode: 'technical-interview', action: 'answer', tier: 'standard', codingTask: false });
    assert.doesNotMatch(p, SCAFFOLD_MARKER,
      'a non-coding turn in Technical Interview mode must not carry the DSA template');
  });

  test('technical-interview + what_to_say + no codingTask → NO contract', () => {
    const p = buildSystemPromptV2({ mode: 'technical-interview', action: 'what_to_say', tier: 'standard' });
    assert.doesNotMatch(p, SCAFFOLD_MARKER);
  });

  test('codingTask flag now actually changes the prompt (was byte-identical live)', () => {
    const off = buildSystemPromptV2({ mode: 'technical-interview', action: 'answer', tier: 'standard', codingTask: false });
    const on = buildSystemPromptV2({ mode: 'technical-interview', action: 'answer', tier: 'standard', codingTask: true, codingTaskKind: 'dsa' });
    assert.notEqual(off.length, on.length);
    assert.match(on, SCAFFOLD_MARKER);
  });
});

describe('RC-3 cause: every legitimate contract trigger is preserved', () => {
  test('a coding turn in technical-interview keeps the contract', () => {
    const p = buildSystemPromptV2({ mode: 'technical-interview', action: 'answer', tier: 'standard', codingTask: true, codingTaskKind: 'dsa' });
    assert.match(p, SCAFFOLD_MARKER);
  });

  test('a coding turn in ANY mode keeps the contract (universal semantic activation)', () => {
    const p = buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'standard', codingTask: true, codingTaskKind: 'dsa' });
    assert.match(p, SCAFFOLD_MARKER);
  });

  test('the code_hint action keeps the contract without an explicit codingTask', () => {
    const p = buildSystemPromptV2({ mode: 'technical-interview', action: 'code_hint', tier: 'standard' });
    assert.match(p, SCAFFOLD_MARKER);
  });
});
