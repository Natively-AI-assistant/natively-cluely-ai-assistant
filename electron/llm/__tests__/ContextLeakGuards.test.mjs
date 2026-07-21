// electron/llm/__tests__/ContextLeakGuards.test.mjs
//
// Issue 5: context leaks = 0. Profile/JD/negotiation context must never leak into
// sales / meeting / lecture / coding / technical answers. The credibility-for-
// selling question must route to product_candidate_mix (no résumé dump), not
// profile_fact.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planAnswer } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href
);
const plan = (q) => planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user' });
const forbids = (p, layer) => p.forbiddenContextLayers.includes(layer);

describe('Issue 5: product+candidate-mix does not dump the résumé', () => {
  for (const q of [
    'Why is your profile good for selling this product?',
    'Why are you credible to sell this?',
    'Why are you the right founder for this product?',
  ]) {
    test(`"${q}" → product_candidate_mix, profile forbidden`, () => {
      const p = plan(q);
      assert.equal(p.answerType, 'product_candidate_mix_answer', `→ ${p.answerType}`);
      assert.equal(p.profileContextPolicy, 'forbidden');
      assert.ok(forbids(p, 'resume') && forbids(p, 'jd') && forbids(p, 'negotiation'));
    });
  }
});

describe('Issue 5: meeting / lecture / sales forbid candidate profile', () => {
  const cases = [
    ['What are the action items?', 'general_meeting_answer'],
    ['What did we decide in the meeting?', 'general_meeting_answer'],
    ['What was the customer asking?', 'general_meeting_answer'],
    ['What did the professor mean by this slide?', 'lecture_answer'],
    ['How do you compare with competitors?', null], // sales-ish, must forbid profile
  ];
  for (const [q, expectedType] of cases) {
    test(`"${q}" → forbids profile/jd/negotiation`, () => {
      const p = plan(q);
      if (expectedType) assert.equal(p.answerType, expectedType, `→ ${p.answerType}`);
      assert.equal(p.profileContextPolicy, 'forbidden', `${q} policy → ${p.profileContextPolicy}`);
      assert.ok(forbids(p, 'resume'), `${q} must forbid resume`);
    });
  }
});

describe('Issue 5: coding/technical forbid profile (no personal-experience ask)', () => {
  for (const q of ['Solve Two Sum.', 'Write a SQL query for the second highest salary.', 'Explain BFS.', 'How would you use SQL?']) {
    test(`"${q}" → profile forbidden`, () => {
      assert.equal(plan(q).profileContextPolicy, 'forbidden', q);
    });
  }
});

describe('Issue 5: unknown_answer forbids profile by default', () => {
  test('an unmatched non-candidate question never forces profile', () => {
    const p = plan('so what do you think about all this?');
    assert.notEqual(p.profileContextPolicy, 'required');
  });
});
