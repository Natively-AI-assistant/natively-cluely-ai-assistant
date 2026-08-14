// electron/llm/__tests__/AnswerQualityJudge2026_06_08.test.mjs
//
// Release 2026-06-08 — the answer-quality judge must reward genuinely good live-copilot
// answers and penalize the real defects (assistant-meta, wrong voice, hallucinated
// metrics, wall-of-text, over-hedging, false refusals). Deterministic; no LLM.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The judge lives in benchmarks/ (TS) — node v25 strips types on import.
const { judgeAnswerDeterministic } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../benchmarks/profile-intelligence/answer_quality_judge.ts')).href
);

const J = (answer, opts = {}) => judgeAnswerDeterministic({
  question: opts.question || 'why should we hire you', answer,
  answerType: opts.answerType || 'jd_fit_answer', mode: opts.mode || 'looking-for-work',
  expectedVoice: opts.voice ?? 'first_person_candidate', answerStyle: opts.style || 'default',
  firstUsefulMs: opts.firstUsefulMs,
});

describe('rewards a strong, speakable candidate answer', () => {
  test('grounded, confident, concise first-person → excellent (>=4)', () => {
    const s = J('I bring three years of backend engineering with Python and SQL, and I have shipped low-latency data pipelines end to end. I move fast and own outcomes.');
    assert.ok(s.overall_human_quality_score >= 4, `got ${s.overall_human_quality_score}`);
    assert.ok(['excellent', 'good'].includes(s.label));
    assert.deepEqual(s.flags, []);
  });
});

describe('penalizes the real defects', () => {
  test('assistant-meta in a candidate answer → wrong_voice / not_speakable, low speakability', () => {
    const s = J('As an AI assistant, the candidate is probably a good fit, maybe.');
    assert.ok(s.speakability_score <= 3);
    assert.ok(s.flags.includes('assistant_meta'));
    assert.ok(['wrong_voice', 'not_speakable'].includes(s.label));
  });
  test('third-person candidate answer → wrong_voice', () => {
    const s = J('The candidate has strong skills and they bring good experience to the team.');
    assert.equal(s.label, 'wrong_voice');
    assert.ok(s.flags.includes('wrong_voice'));
  });
  test('over-hedged answer → underclaiming, lower confidence', () => {
    const s = J('I think I am maybe probably a decent fit, I guess, but it sort of depends, hard to say really.');
    assert.ok(s.confidence_score <= 3, `conf ${s.confidence_score}`);
    assert.ok(s.flags.includes('underclaiming') || s.flags.includes('over_hedged'));
  });
  test('false refusal when an answer was expected → low grounding', () => {
    const s = J("I can't share that information about the candidate.");
    assert.ok(s.grounding_score <= 3);
    assert.ok(s.flags.includes('false_refusal'));
  });
  test('overclaiming superlatives → flagged', () => {
    const s = J('I am a world-class, second-to-none 10x engineer, simply the best there is.');
    assert.ok(s.flags.includes('overclaiming'));
  });
  test('one-liner that is multiple sentences → one_liner_too_long', () => {
    const s = J('I am a strong fit. I have deep experience. I work hard every day.', { style: 'one_liner' });
    assert.ok(s.flags.includes('one_liner_too_long'));
  });
  test('a short-style answer that runs long → short_too_long', () => {
    const long = 'I bring extensive backend experience here. '.repeat(30); // ~180 words
    const s = J(long, { style: 'short' });
    assert.ok(s.flags.includes('short_too_long') || s.flags.includes('too_long'));
  });
  test('empty answer → 1/5 empty', () => {
    const s = J('');
    assert.equal(s.overall_human_quality_score, 1);
    assert.equal(s.label, 'empty');
  });
});

describe('respects style + answer-type length budgets', () => {
  test('a detailed coding answer is NOT penalized for length', () => {
    const long = 'First, we use a hash map to store seen values. '.repeat(15);
    const s = J(long, { answerType: 'coding_question_answer', voice: 'assistant_explanation', style: 'detailed', question: 'explain two sum in detail' });
    assert.ok(!s.flags.includes('too_long'), 'detailed coding may be long');
  });
  test('assistant-voice technical answer is not voice-penalized for lacking "I"', () => {
    const s = J('Breadth-first search explores a graph level by level using a queue, visiting each node once.', { answerType: 'technical_concept_answer', voice: 'assistant_explanation', question: 'explain BFS' });
    assert.ok(!s.flags.includes('wrong_voice'));
    assert.ok(s.overall_human_quality_score >= 4);
  });
});
