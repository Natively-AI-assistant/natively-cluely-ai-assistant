// electron/llm/__tests__/AnswerStyle2026_06_08.test.mjs
//
// Release 2026-06-08 — adaptive answer-style engine. Detects requested style/length
// from the question and shapes FORM only — never routing, voice, grounding, or leak
// boundaries.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { detectAnswerStyle, styleSuppressesScaffold, planAnswer, formatAnswerPlanForPrompt } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href
);

describe('detectAnswerStyle — recognizes the requested style', () => {
  const cases = [
    ['quickly introduce yourself', 'short'],
    ['briefly, what are your skills', 'short'],
    ['give me the gist of your background', 'short'],
    ['walk me through your background', 'detailed'],
    ['explain your projects in detail', 'detailed'],
    ['why should we hire you in one line', 'one_liner'],
    ['tl;dr your experience', 'one_liner'],
    ['tell me about a time you handled conflict', 'star'],
    ['just give me the code', 'code_only'],
    ['code only please', 'code_only'],
    ['explain BFS to a beginner', 'beginner'],
    ['explain this in simple terms', 'beginner'],
    ['list your skills as bullet points', 'bullets'],
    ['explain your approach first', 'approach_first'],
    ['how would you approach this problem', 'approach_first'],
    ['write a 6 marks answer on TCP', 'exam'],
    ['make notes on this lecture', 'notes'],
  ];
  for (const [q, style] of cases) {
    test(`"${q}" → ${style}`, () => assert.equal(detectAnswerStyle(q).style, style, `got ${detectAnswerStyle(q).style}`));
  }
});

describe('detectAnswerStyle — normal questions stay default (no routing-affecting false positives)', () => {
  for (const q of ['what is your name', 'tell me about Natively', 'solve two sum', 'why should we hire you', 'rate your Python out of 10', 'what is eventual consistency']) {
    test(`"${q}" → default`, () => assert.equal(detectAnswerStyle(q).style, 'default'));
  }
});

describe('style is threaded into the AnswerPlan + prompt contract', () => {
  test('plan carries answerStyle + target seconds', () => {
    const p = planAnswer({ question: 'quickly introduce yourself', source: 'manual_input', speakerPerspective: 'user' });
    assert.equal(p.answerStyle, 'short');
    assert.ok(p.answerStyleTargetSeconds > 0);
  });
  test('the contract includes a STYLE directive for a styled question', () => {
    const p = planAnswer({ question: 'why should we hire you in one line', source: 'manual_input', speakerPerspective: 'user' });
    const contract = formatAnswerPlanForPrompt(p, false);
    assert.match(contract, /answerStyle: one_liner/);
    assert.match(contract, /STYLE: Answer in ONE short sentence/);
  });
  test('a default question gets NO style directive', () => {
    const p = planAnswer({ question: 'what is your name', source: 'manual_input', speakerPerspective: 'user' });
    const contract = formatAnswerPlanForPrompt(p, false);
    assert.match(contract, /answerStyle: default/);
    assert.doesNotMatch(contract, /STYLE:/);
  });
});

describe('SAFETY: style shapes FORM only — never routing or leak boundaries', () => {
  test('"just give me the code" stays a coding answer with profile FORBIDDEN', () => {
    const p = planAnswer({ question: 'just give me the code for two sum', source: 'manual_input', speakerPerspective: 'user' });
    assert.match(p.answerType, /coding_question_answer|dsa_question_answer/);
    assert.ok(p.forbiddenContextLayers.includes('resume'), 'resume must stay forbidden for coding');
    assert.equal(p.profileContextPolicy, 'forbidden');
  });
  test('code_only suppresses the coding scaffold (no six-section template for "code only")', () => {
    const p = planAnswer({ question: 'code only: reverse a linked list', source: 'manual_input', speakerPerspective: 'user' });
    assert.equal(p.answerStyle, 'code_only');
    assert.equal(p.shouldShowImmediateScaffold, false);
  });
  test('a normal coding question KEEPS the scaffold (style default)', () => {
    const p = planAnswer({ question: 'solve two sum', source: 'manual_input', speakerPerspective: 'user' });
    assert.equal(p.answerStyle, 'default');
    assert.equal(p.shouldShowImmediateScaffold, true);
  });
  test('"introduce yourself briefly" keeps identity routing + profile required', () => {
    const p = planAnswer({ question: 'introduce yourself briefly', source: 'manual_input', speakerPerspective: 'user' });
    assert.equal(p.answerType, 'identity_answer');
    assert.equal(p.profileContextPolicy, 'required');
    assert.equal(p.answerStyle, 'short');
  });
});

describe('styleSuppressesScaffold', () => {
  test('code_only + one_liner suppress; others do not', () => {
    assert.equal(styleSuppressesScaffold('code_only'), true);
    assert.equal(styleSuppressesScaffold('one_liner'), true);
    assert.equal(styleSuppressesScaffold('detailed'), false);
    assert.equal(styleSuppressesScaffold('default'), false);
  });
});
