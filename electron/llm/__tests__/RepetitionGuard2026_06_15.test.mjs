// electron/llm/__tests__/RepetitionGuard2026_06_15.test.mjs
//
// Property tests for the strengthened AnswerDiversityGuard + varySpokenOpening
// (spoken-answer-quality sprint). Detects same opening window / skeleton / corporate
// cluster / project-reuse across the last few answers to DIFFERENT questions, and skips
// code/structured answers. Behavioural — no fixed strings.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { AnswerDiversityGuard, varySpokenOpening } from '../../../dist-electron/electron/llm/index.js';

describe('AnswerDiversityGuard — same opening window across different asks', () => {
  test('flags two answers that open with the same 8 words', () => {
    const g = new AnswerDiversityGuard(20);
    g.record('I think the useful part of my background is data work.', 'jd_fit_answer', 'why hire you');
    const v = g.check('I think the useful part of my background is backend systems.', 'experience_answer', 'tell me about a challenge');
    assert.equal(v.repeated, true);
    assert.equal(v.reason, 'same_opening_window');
  });

  test('does NOT flag genuinely different openings', () => {
    const g = new AnswerDiversityGuard(20);
    g.record('I think the useful part of my background is data work.', 'jd_fit_answer', 'why hire you');
    const v = g.check('My strongest project was the payments service I shipped.', 'project_answer', 'what project');
    assert.equal(v.repeated, false);
  });
});

describe('AnswerDiversityGuard — same project reused when another is available', () => {
  test('flags + suggests an unused grounded project', () => {
    const g = new AnswerDiversityGuard(20);
    const opts = { availableProjects: ['PriceX', 'RedisMart'] };
    g.record('At PriceX I built a scraping pipeline.', 'project_answer', 'tell me a project', opts);
    const v = g.check('At PriceX I optimized the backend.', 'experience_answer', 'describe your backend work', opts);
    assert.equal(v.repeated, true);
    assert.equal(v.reason, 'same_project_reused');
    assert.equal((v.suggestedProject || '').toLowerCase(), 'redismart');
  });

  test('no suggestion when no other project is available', () => {
    const g = new AnswerDiversityGuard(20);
    const opts = { availableProjects: ['PriceX'] };
    g.record('At PriceX I built a scraping pipeline.', 'project_answer', 'tell me a project', opts);
    const v = g.check('At PriceX I optimized the backend.', 'experience_answer', 'describe your backend', opts);
    // Only PriceX exists → can't suggest a different one → not flagged as project-reuse.
    assert.notEqual(v.reason, 'same_project_reused');
  });
});

describe('AnswerDiversityGuard — corporate cluster repetition', () => {
  test('flags repeated corporate-phrase clusters (different openings)', () => {
    const g = new AnswerDiversityGuard(20);
    // Different opening words, but the SAME pair of corporate phrases — the cluster signal.
    g.record('My background shows a proven track record with high-impact delivery.', 'jd_fit_answer', 'why you');
    const v = g.check('Across roles I have a proven track record and high-impact results.', 'experience_answer', 'your strengths');
    assert.equal(v.repeated, true);
    // The corporate cluster or near-dup fires — both are correct repetition signals.
    assert.ok(['same_corporate_cluster', 'near_duplicate', 'same_skeleton'].includes(v.reason), `got ${v.reason}`);
  });
});

describe('AnswerDiversityGuard — skips code / structured answers', () => {
  test('coding answer type is never flagged', () => {
    const g = new AnswerDiversityGuard(20);
    g.record('```python\nx=1\n```', 'dsa_question_answer', 'solve a');
    const v = g.check('```python\nx=1\n```', 'dsa_question_answer', 'solve b');
    assert.equal(v.repeated, false);
  });
  test('an answer containing a code fence is never flagged', () => {
    const g = new AnswerDiversityGuard(20);
    g.record('Here. ```js\nf()\n```', 'jd_fit_answer', 'q1');
    const v = g.check('Here. ```js\nf()\n```', 'experience_answer', 'q2');
    assert.equal(v.repeated, false);
  });
  test('lecture answers are never flagged', () => {
    const g = new AnswerDiversityGuard(20);
    g.record('Bayes theorem updates a belief after evidence.', 'lecture_answer', 'explain bayes');
    const v = g.check('Bayes theorem updates a belief after evidence.', 'lecture_answer', 'explain bayes again');
    assert.equal(v.repeated, false);
  });
});

describe('AnswerDiversityGuard — same ask is allowed to repeat', () => {
  test('synonymous questions legitimately re-yield the same answer', () => {
    const g = new AnswerDiversityGuard(20);
    g.record('I think the useful part of my background is data work for analytics.', 'skills_answer', 'what are your main skills');
    const v = g.check('I think the useful part of my background is data work for analytics.', 'skills_answer', 'what are your technical skills');
    assert.equal(v.repeated, false, 'same ask must not be flagged');
  });
});

describe('varySpokenOpening — deterministic first-sentence variation', () => {
  test('adds a natural opener and keeps the rest', () => {
    const out = varySpokenOpening('The data pipeline was the hard part.', 0);
    assert.notEqual(out, 'The data pipeline was the hard part.');
    assert.match(out, /data pipeline was the hard part/);
  });
  test('does not stack openers on an already-hedged sentence', () => {
    const already = 'Honestly, I built the pipeline myself.';
    assert.equal(varySpokenOpening(already, 1), already);
  });
  test('leaves a code-bearing answer untouched', () => {
    const code = '```python\nx=1\n```';
    assert.equal(varySpokenOpening(code, 0), code);
  });
  test('different rotations give different openers', () => {
    const a = varySpokenOpening('The system held up well.', 0);
    const b = varySpokenOpening('The system held up well.', 1);
    assert.notEqual(a, b);
  });
});
