/**
 * Regression test for the Profile Intelligence production-fix autopilot
 * (2026-07-05, docs/investigations/pi-production-fix-progress.md, Confirmed
 * Bug #1). "What's RedisMart and what problem does it solve?" was hijacked by
 * the bare `\bsolve\b` token inside CODING_PATTERNS into
 * coding_question_answer (profile FORBIDDEN), so the manual-chat answer never
 * named the actual project — a real desync-shaped bug reproduced against the
 * live backend replay (scripts/pi-replay.cjs, round-00).
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

describe('Bare "solve" must not hijack a project-description question into coding', () => {
  const projectProblemQuestions = [
    "What's RedisMart and what problem does it solve?",
    'What problem does Natively solve?',
    'What problem does your project solve for users?',
    'What problem does the RedisMart app solve?',
  ];
  for (const q of projectProblemQuestions) {
    test(`"${q}" must NOT route to coding_question_answer`, () => {
      const r = p(q);
      assert.notEqual(r.answerType, 'coding_question_answer');
      assert.equal(isCodingAnswerType(r.answerType), false);
    });
  }
});

describe('Genuine "solve" coding asks are unaffected by the guard', () => {
  const codingCases = [
    ['Solve two sum.', 'dsa_question_answer'],
    ['Can you solve this problem for me?', 'coding_question_answer'],
  ];
  for (const [q, expected] of codingCases) {
    test(`"${q}" -> ${expected}`, () => {
      assert.equal(p(q).answerType, expected);
    });
  }

  test('"How did you solve the caching problem in RedisMart?" still routes to a coding-flavored or project-followup type (never unknown)', () => {
    const r = p('How did you solve the caching problem in RedisMart?');
    assert.notEqual(r.answerType, 'unknown_answer');
  });

  test('"How would you solve a rate limiter design problem?" still routes to a technical type', () => {
    const r = p('How would you solve a rate limiter design problem?');
    assert.notEqual(r.answerType, 'unknown_answer');
    assert.notEqual(r.answerType, 'profile_fact_answer');
  });
});

describe('COMPOUND-MESSAGE fix (debugger-confirmed regression from the first version of this guard)', () => {
  // The original isProductProblemSolveQuestion guard computed a whole-message
  // boolean and, once true, narrowed hasExplicitCodingVerb/hasWriteCodeVerb's
  // verb regex for the ENTIRE message. A message pairing the product-solve
  // phrase with a SEPARATE, genuine coding request lost its "write" signal
  // too and fell through to unknown_answer/profileContextPolicy:'allowed'
  // instead of coding_question_answer/forbidden — silently dropping the
  // coding-answer safety nets (structure validation, contract injection,
  // profile isolation) for a genuine coding ask. Fixed by stripping only the
  // matched product-solve CLAUSE, not gating the whole message.
  const compoundCases = [
    ['What problem does RedisMart solve? Also please write a Python function that checks if a number is prime.', 'coding_question_answer'],
    ['What problem does it solve? Also can you please write code to reverse a linked list.', 'dsa_question_answer'],
  ];
  for (const [q, expected] of compoundCases) {
    test(`"${q.slice(0, 60)}…" -> ${expected} (coding request survives the product-solve clause)`, () => {
      const r = p(q);
      assert.equal(r.answerType, expected);
      assert.equal(r.profileContextPolicy, 'forbidden');
    });
  }

  test('an isolated genuine coding question (control) still routes correctly', () => {
    const r = p('Please write a Python function that checks if a number is prime.');
    assert.equal(r.answerType, 'coding_question_answer');
    assert.equal(r.profileContextPolicy, 'forbidden');
  });
});
