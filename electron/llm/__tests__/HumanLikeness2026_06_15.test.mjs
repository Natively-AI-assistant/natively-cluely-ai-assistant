// electron/llm/__tests__/HumanLikeness2026_06_15.test.mjs
//
// Phase 12 (task 2026-06-15, bug #8): grounded answers read as corporate/LinkedIn
// boilerplate. The human-likeness guard adds a prompt directive for spoken candidate/sales
// answers and a deterministic corporate-filler detector — applied ONLY to those types,
// never to code/lecture/diagram/technical/search.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  shouldHumanize,
  humanizeDirectiveFor,
  detectCorporateFiller,
  HUMANIZE_DIRECTIVE,
} from '../../../dist-electron/electron/llm/index.js';

describe('shouldHumanize — applies to spoken candidate/sales answers only', () => {
  const humanize = [
    'identity_answer', 'experience_answer', 'project_answer', 'skills_answer',
    'skill_experience_answer', 'jd_fit_answer', 'gap_analysis_answer',
    'behavioral_interview_answer', 'negotiation_answer', 'sales_answer',
  ];
  for (const t of humanize) test(`humanize: ${t}`, () => assert.equal(shouldHumanize(t), true));

  const preserve = [
    'coding_question_answer', 'dsa_question_answer', 'system_design_answer',
    'debugging_question_answer', 'technical_concept_answer', 'lecture_answer',
  ];
  for (const t of preserve) test(`preserve structure: ${t}`, () => assert.equal(shouldHumanize(t), false));
});

describe('humanizeDirectiveFor — directive only for humanized types', () => {
  test('jd_fit_answer gets the directive', () => {
    assert.equal(humanizeDirectiveFor('jd_fit_answer'), HUMANIZE_DIRECTIVE);
    assert.ok(HUMANIZE_DIRECTIVE.length > 0);
  });
  test('dsa_question_answer gets no directive (code untouched)', () => {
    assert.equal(humanizeDirectiveFor('dsa_question_answer'), '');
  });
  test('lecture_answer gets no directive (structure preserved)', () => {
    assert.equal(humanizeDirectiveFor('lecture_answer'), '');
  });
  test('the directive bans the flagged corporate phrases', () => {
    assert.match(HUMANIZE_DIRECTIVE, /unique blend/);
    assert.match(HUMANIZE_DIRECTIVE, /data-driven mindset/);
    assert.match(HUMANIZE_DIRECTIVE, /the candidate/);
  });
});

describe('detectCorporateFiller — flags boilerplate, passes real speech', () => {
  test('a corporate answer is flagged with the matched phrases', () => {
    const v = detectCorporateFiller(
      'I bring a unique blend of skills and a data-driven mindset to drive business objectives, ' +
      'leveraging my technical rigor to deliver actionable intelligence and a decisive competitive advantage.'
    );
    assert.equal(v.hasFiller, true);
    assert.ok(v.count >= 5, `expected many filler hits, got ${v.count}`);
    assert.ok(v.matches.includes('unique blend'));
  });

  test('a plain, human answer is NOT flagged', () => {
    const v = detectCorporateFiller(
      "I'm a backend engineer. I built the payments service at my last job and cut p95 latency from 800ms to 300ms."
    );
    assert.equal(v.hasFiller, false);
    assert.equal(v.count, 0);
  });

  test('"based on the provided context" / "the candidate" tells are flagged', () => {
    assert.equal(detectCorporateFiller('Based on the provided context, the candidate is a strong fit.').hasFiller, true);
  });

  test('matched phrases are generic boilerplate (safe to log — no profile content)', () => {
    const v = detectCorporateFiller('A seamless, best-in-class, results-oriented professional.');
    // Every match is a generic phrase, not a name/company/number.
    for (const m of v.matches) assert.doesNotMatch(m, /\d|@/);
  });
});
