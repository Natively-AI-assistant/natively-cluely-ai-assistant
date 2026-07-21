/**
 * Real-custom-mode-repair (2026-07-11) — regression for a confirmed P0
 * incident: "What fine-tuning method was used?" (a document-grounded thesis
 * question) was hijacked by the bare `\bmethod\b` token inside
 * CODING_PATTERNS into coding_question_answer, and the model answered with
 * an unrelated Two Sum LeetCode solution instead of retrieving the thesis
 * evidence (docs/context-os/real-custom-mode-repair/06_ROOT_CAUSE_REPORT.md).
 *
 * `method` and `class` are common non-coding English nouns ("teaching
 * method", "testing method", "business class", "what class of algorithm").
 * The fix drops them from the bare CODING_PATTERNS trigger — they now only
 * count as a coding signal when paired with an explicit coding verb/object
 * in the same clause ("write a class for X", "implement a method to sort Y").
 *
 * Requires: npm run build:electron.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planAnswer, isCodingAnswerType } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/AnswerPlanner.js')).href
);
const p = (q) => planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user' });

describe('INCIDENT REGRESSION: bare "method"/"class" must not hijack a non-coding question into coding', () => {
  const nonCodingQuestions = [
    'What fine-tuning method was used?',
    'What testing method did you use?',
    'What teaching method does the professor use?',
    'What research method was applied in this study?',
  ];
  for (const q of nonCodingQuestions) {
    test(`"${q}" must NOT route to coding_question_answer`, () => {
      const r = p(q);
      assert.notEqual(r.answerType, 'coding_question_answer');
      assert.equal(isCodingAnswerType(r.answerType), false);
    });
  }
});

describe('Genuine coding "class"/"method" asks are unaffected by the fix', () => {
  const codingCases = [
    'Write a class for a binary tree',
    'Implement a method to reverse a string',
    'Write code for bubble sort',
    'Implement quicksort in Python',
  ];
  for (const q of codingCases) {
    test(`"${q}" must still route to a coding answer type`, () => {
      const r = p(q);
      assert.equal(isCodingAnswerType(r.answerType) || r.answerType === 'dsa_question_answer', true, `got ${r.answerType}`);
    });
  }
});
