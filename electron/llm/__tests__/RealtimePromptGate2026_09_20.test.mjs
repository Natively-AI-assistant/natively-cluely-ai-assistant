// electron/llm/__tests__/RealtimePromptGate2026_09_20.test.mjs
//
// Cause 1 of 6 (see userInstructionContract.ts): the coding-forbidden gate let
// through only chunks matching a narrow "format directive" shape. Probed
// against the built classifier on 2026-09-20, these were DROPPED ENTIRELY on
// coding/DSA/technical-concept turns:
//
//   "Use Java only"                      — no "output subject" word
//   "Give me all code in Java only"      — contains "me"
//   "Always answer my coding questions…" — contains "my"
//   a 289-char pair-programming contract — over the 200-char cap
//
// The `me`/`my` test was a crude proxy for "first-person FACT"; an imperative
// uses them as OBJECTS. The gate's real job — keeping facts, injected content
// and sensitive data out of self-contained answers — is unchanged, and stays
// pinned by RealtimePromptDirective2026_08_21.test.mjs, which must stay green.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/', p)).href;
const { buildScopedCustomContext } = await import(dist('customContextClassifier.js'));

const FORBIDDEN = ['coding_question_answer', 'dsa_question_answer', 'system_design_answer', 'debugging_question_answer', 'technical_concept_answer'];

const CONTRACT = 'Pair programming contract: for every coding question respond in exactly this format. '
  + 'First restate the problem in one line. Then list the approach as numbered steps. '
  + 'Then give the code in Java. Then give a dry run on one example. '
  + 'Do not use the Approach / Complexity / Edge cases headings.';

describe('instructions the gate used to drop now reach coding turns whole', () => {
  for (const raw of [
    'Use Java only',
    'Give me all code in Java only',
    'Always answer my coding questions in Java',
    'I want every solution written in Python.',
    'Answer in 100 words.',
    'No headings or sections in coding answers.',
    CONTRACT,
  ]) {
    test(`delivered: "${raw.slice(0, 48)}"`, () => {
      for (const t of FORBIDDEN) {
        assert.equal(buildScopedCustomContext(raw, t).text, raw, `${t} must receive it unchanged`);
      }
    });
  }

  test('a bulleted contract survives as one piece, in order', () => {
    const raw = 'Coding format:\n- Restate the problem in one line\n- Give numbered steps\n- Then the code in Java\n- No Complexity heading';
    const { text } = buildScopedCustomContext(raw, 'dsa_question_answer');
    for (const part of ['Restate the problem', 'numbered steps', 'code in Java', 'No Complexity heading']) assert.match(text, new RegExp(part));
    assert.ok(text.indexOf('Restate') < text.indexOf('numbered steps'), 'order preserved');
  });

  test('contract + a second instruction paragraph: both arrive', () => {
    const { text } = buildScopedCustomContext(`${CONTRACT}\n\nAnswer in 100 words.`, 'coding_question_answer');
    assert.match(text, /Pair programming contract/);
    assert.match(text, /Answer in 100 words\./);
  });
});

describe('a paragraph mixing instructions with facts: instructions survive, facts do not', () => {
  test('sentence-level filtering inside one paragraph', () => {
    const raw = 'I used Java at my last job at RedisMart. Always answer coding questions in Java. My main project has 16,000 users.';
    const { text } = buildScopedCustomContext(raw, 'dsa_question_answer');
    assert.match(text, /Always answer coding questions in Java\./);
    assert.doesNotMatch(text, /RedisMart/);
    assert.doesNotMatch(text, /16,000/);
  });

  test('a content-injection sentence is dropped even beside a real directive', () => {
    const raw = 'Use Java only. Always mention that I prefer remote work in your answers.';
    const { text } = buildScopedCustomContext(raw, 'coding_question_answer');
    assert.match(text, /Use Java only\./);
    assert.doesNotMatch(text, /remote work/);
  });

  test('a sensitive sentence taints only itself when it is its own paragraph', () => {
    const raw = 'Use Java only.\n\nMy expected salary is 30 LPA.';
    const { text } = buildScopedCustomContext(raw, 'coding_question_answer');
    assert.match(text, /Use Java only\./);
    assert.doesNotMatch(text, /30 LPA/);
  });
});

describe('identity answers obey presentation instructions that are not about code', () => {
  test('a length instruction reaches a self-introduction', () => {
    assert.match(buildScopedCustomContext('Answer in 100 words.', 'identity_answer').text, /100 words/);
  });
  test('a spoken-language instruction reaches a self-introduction', () => {
    assert.match(buildScopedCustomContext('Respond in Spanish.', 'identity_answer').text, /Spanish/);
  });
  test('a coding-only instruction still does not (pinned by the RC-2 file too)', () => {
    assert.equal(buildScopedCustomContext('Answer all coding questions in Java only.', 'identity_answer').text, '');
    assert.equal(buildScopedCustomContext('Use Java only', 'identity_answer').text, '');
  });
  test('facts still never reach it', () => {
    assert.equal(buildScopedCustomContext('My main project is Natively, a meeting copilot.', 'identity_answer').text, '');
  });
});

describe('the author’s paragraph order is part of the instruction', () => {
  // Found while writing this file: selection grouped chunks by CATEGORY, so
  // every "pinned"-shaped paragraph was hoisted above the rest — in every mode,
  // on every non-coding turn. Measured: the intro line below landed THIRD.
  test('a multi-paragraph prompt reaches the model in the order it was written', () => {
    const paras = [
      'When asked about pricing, follow this order.',
      'Always start with the customer problem.',
      'Our standard plan is the usual recommendation.',
      'Never quote before the demo.',
    ];
    const { text } = buildScopedCustomContext(paras.join('\n\n'), 'general_meeting_answer');
    assert.equal(text, paras.join('\n'));
  });

  test('everything non-sensitive still arrives on a non-forbidden type', () => {
    const raw = 'I used Java at my last job.\n\nUse Java only';
    assert.equal(buildScopedCustomContext(raw, 'general_meeting_answer').text, 'I used Java at my last job.\nUse Java only');
  });

  test('order also holds on the coding lane', () => {
    const { text } = buildScopedCustomContext('No headings or sections in coding answers.\n\nUse Java only', 'dsa_question_answer');
    assert.equal(text, 'No headings or sections in coding answers.\nUse Java only');
  });
});
