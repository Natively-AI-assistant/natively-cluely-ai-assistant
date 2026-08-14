// PHASE 5 — OutputShapeNormalizer facade (over the live answerPolish machinery).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeOutputShape,
  applyAnswerContract,
  AnswerDiversityGuard,
} from '../../../dist-electron/electron/intelligence/OutputShapeNormalizer.js';

describe('OutputShapeNormalizer.normalizeOutputShape', () => {
  test('strips empty bullets and reports it', () => {
    const r = normalizeOutputShape({ answer: 'Real answer.\n*\nMore.', answerStyle: 'default' });
    assert.doesNotMatch(r.text, /^\s*\*\s*$/m);
    assert.ok(r.applied.includes('cleaned_artifacts'));
    assert.equal(r.changed, true);
  });

  // Realistic-length bodies: compressToSpeakable only swaps when the prose form is
  // >= 40 chars (the live path's guard against replacing with a too-short fragment).
  const TEMPLATED = 'Direct Answer: I am a strong fit for this senior role.\n'
    + 'Matching Experience: I led backend teams for five years at scale.\n'
    + 'Why This Role: it matches my platform and reliability focus.';

  test('compresses visible scaffold to speakable when structure NOT requested', () => {
    const r = normalizeOutputShape({ answer: TEMPLATED, answerStyle: 'default' });
    assert.doesNotMatch(r.text, /Direct Answer:|Matching Experience:/);
    assert.ok(r.applied.includes('compressed_to_speakable'));
  });

  test('KEEPS scaffold labels when structure WAS requested (detailed/bullets/star/notes)', () => {
    for (const style of ['detailed', 'bullets', 'star', 'notes', 'exam']) {
      const r = normalizeOutputShape({ answer: TEMPLATED, answerStyle: style });
      assert.match(r.text, /Direct Answer:/, `style=${style} should keep structure`);
    }
  });

  test('leaves coding answers untouched', () => {
    const code = '```js\nconst x = [1];\n```\n* not a bullet in prose';
    const r = normalizeOutputShape({ answer: code, isCoding: true });
    assert.equal(r.changed, false);
    assert.equal(r.text, code);
  });

  test('never throws on empty input', () => {
    assert.doesNotThrow(() => normalizeOutputShape({ answer: '' }));
    assert.equal(normalizeOutputShape({ answer: '' }).changed, false);
  });
});

describe('OutputShapeNormalizer.applyAnswerContract', () => {
  test('repaired when a repeated answer is detected across different asks', () => {
    const guard = new AnswerDiversityGuard();
    const tmpl = 'The Honest Gap: x\nWhy It\'s Manageable: y\nHow I\'d Close It: z';
    // First delivery records the template.
    applyAnswerContract({ answer: tmpl, answerStyle: 'detailed', answerType: 'gap_analysis_answer', question: 'where are you weak?', guard });
    // Second, different ask, same template → contract should repair/compress.
    const r = applyAnswerContract({ answer: tmpl.replace(/x/, 'a'), answerStyle: 'detailed', answerType: 'gap_analysis_answer', question: 'what should you improve?', guard });
    assert.ok(r.repetition, 'a repetition verdict is produced');
  });

  test('records each delivered answer into the guard', () => {
    const guard = new AnswerDiversityGuard();
    applyAnswerContract({ answer: 'My skills are X.', answerStyle: 'default', answerType: 'skills_answer', question: 'skills?', guard });
    assert.equal(guard.size, 1);
  });

  test('never throws', () => {
    const guard = new AnswerDiversityGuard();
    assert.doesNotThrow(() => applyAnswerContract({ answer: '', answerStyle: 'default', answerType: 'x', question: 'q', guard }));
  });
});
