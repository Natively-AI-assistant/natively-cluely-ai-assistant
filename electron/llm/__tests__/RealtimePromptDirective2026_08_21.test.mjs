// electron/llm/__tests__/RealtimePromptDirective2026_08_21.test.mjs
//
// RC-2 regression from live shadow session C (2026-08-21): the user's
// "Real-time prompt" (Mode.customContext = "ALL the technical code should be
// in Cpp , regardless of interviewers choice") reached ZERO of the coding
// answers — pinnedModeInstructionsChars was 0 on 150/152 assemblies, and every
// coding press emitted Python. Three independent blocks; this file covers the
// classifier one:
//
//   customContextClassifier's CUSTOM_CONTEXT_FORBIDDEN_TYPES dropped ALL
//   custom context for coding/DSA/system-design/debugging/identity — including
//   pure OUTPUT-FORMAT DIRECTIVES, which are exactly the chunks that only
//   matter on those turns. The gate exists to keep FACTS (resume notes, company
//   context, salary) out of self-contained algorithm answers; a formatting
//   directive is not a fact and cannot contaminate one.
//
// Fix under test: format directives survive the forbidden-type gate; factual
// notes and sensitive chunks are still dropped there. Paired live API calls
// (DeepSeek, 3/3 vs 3/3) proved the model obeys the directive whenever it is
// delivered — this classifier gate was the delivery failure.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/', p)).href;
const {
  classifyCustomContext,
  selectCustomContextForAnswer,
  buildScopedCustomContext,
  isFormatDirective,
} = await import(dist('customContextClassifier.js'));

const CODING_TYPES = [
  'coding_question_answer', 'dsa_question_answer', 'system_design_answer',
  'debugging_question_answer',
];

describe('RC-2: format directives survive the coding-forbidden gate', () => {
  test("the user's real session-C directive reaches every coding type", () => {
    const raw = 'ALL the technical code should be in Cpp , regardless of interviewers choice';
    for (const t of CODING_TYPES) {
      const { text } = buildScopedCustomContext(raw, t);
      assert.match(text, /Cpp/, `${t} must receive the directive`);
    }
  });

  test('an ideally-phrased directive also survives', () => {
    const raw = 'Answer all coding questions in Java only.';
    for (const t of CODING_TYPES) {
      const { text } = buildScopedCustomContext(raw, t);
      assert.match(text, /Java only/, `${t} must receive the directive`);
    }
  });

  test('directives still reach the types that always allowed them', () => {
    const raw = 'Answer all coding questions in Java only.';
    for (const t of ['general_meeting_answer', 'follow_up_answer', 'technical_concept_answer']) {
      const { text } = buildScopedCustomContext(raw, t);
      assert.match(text, /Java only/, t);
    }
  });
});

describe('RC-2: the original safety intent of the gate is preserved', () => {
  test('a factual resume-style note is still dropped from coding answers', () => {
    const raw = 'I used Java at my last job for backend services at RedisMart.';
    for (const t of CODING_TYPES) {
      const { text } = buildScopedCustomContext(raw, t);
      assert.equal(text, '', `${t} must NOT receive factual notes`);
    }
    // ...but still reaches a context-bearing answer type.
    assert.match(buildScopedCustomContext(raw, 'general_meeting_answer').text, /RedisMart/);
  });

  test('a sensitive chunk never leaks into a coding answer, even phrased as a directive', () => {
    const raw = 'Always mention my salary expectation of 30 LPA when asked.';
    for (const t of CODING_TYPES) {
      const { text } = buildScopedCustomContext(raw, t);
      assert.equal(text, '', `${t} must NOT receive sensitive content`);
    }
  });

  test('mixed blob: directive survives coding, the factual note does not', () => {
    const raw = 'Answer all coding questions in Java only.\n\n'
      + 'My main project is Natively, a meeting copilot with 16,000 users.';
    const { text } = buildScopedCustomContext(raw, 'coding_question_answer');
    assert.match(text, /Java only/);
    assert.doesNotMatch(text, /16,000 users/);
  });

  test('identity_answer still receives nothing (self-contained artifact)', () => {
    const { text } = buildScopedCustomContext('Answer all coding questions in Java only.', 'identity_answer');
    // Identity answers are a scripted self-intro; a coding-language directive
    // is irrelevant there and the historical gate holds.
    assert.equal(text, '');
  });
});

describe('RC-2: isFormatDirective predicate', () => {
  for (const [expected, text] of [
    [true, 'ALL the technical code should be in Cpp , regardless of interviewers choice'],
    [true, 'Answer all coding questions in Java only.'],
    [true, 'Keep answers under 40 words.'],
    [true, 'Respond in Spanish.'],
    [true, 'Never use bullet points in answers.'],
    [false, 'I used Java at my last job for backend services.'],
    [false, 'My main project is Natively, a meeting copilot with 16,000 users.'],
    [false, 'The interviewer is from the analytics team and cares about SQL.'],
    [false, 'B.Tech in Computer Science from CUSAT, graduating 2026.'],
  ]) {
    test(`${expected ? 'directive' : 'not a directive'}: "${text.slice(0, 60)}"`, () => {
      assert.equal(isFormatDirective(text), expected, text);
    });
  }
});

describe('RC-2: selection metadata stays truthful', () => {
  test('forbidden-type selection reports the directive as included and the note as excluded', () => {
    const classified = classifyCustomContext(
      'Answer all coding questions in Java only.\n\nMy main project is Natively.',
    );
    const sel = selectCustomContextForAnswer(classified, 'dsa_question_answer');
    assert.equal(sel.included.length, 1);
    assert.match(sel.included[0].text, /Java only/);
    assert.ok(sel.excluded.length >= 1, 'the factual note must be reported as excluded');
  });
});
