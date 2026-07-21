// electron/llm/__tests__/CustomContextClassifier.test.mjs
//
// Phase 3: backward-compatible custom-context categorisation. Proves the
// classifier splits a single trusted blob into pinned/searchable/sensitive,
// gates sensitive chunks by answer type (salary never leaks into a coding or
// behavioral answer), and is a no-op for empty input (old users unaffected).

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  classifyCustomContext,
  splitCustomContextChunks,
  selectCustomContextForAnswer,
  buildScopedCustomContext,
  summarizeCustomContextSelection,
} from '../../../dist-electron/electron/llm/index.js';

describe('splitCustomContextChunks', () => {
  test('empty/whitespace blob → no chunks (backward compatible)', () => {
    assert.deepEqual(splitCustomContextChunks(''), []);
    assert.deepEqual(splitCustomContextChunks('   \n  '), []);
  });
  test('blank-line separated paragraphs split into chunks', () => {
    const chunks = splitCustomContextChunks('Always be concise.\n\nMy current CTC is 30 LPA.\n\nI built a payments system.');
    assert.equal(chunks.length, 3);
  });
  test('single paragraph of bullet lines splits per line', () => {
    const chunks = splitCustomContextChunks('- be concise\n- salary is confidential\n- I use Go');
    assert.equal(chunks.length, 3);
    assert.ok(chunks.every(c => !c.startsWith('-')), 'bullet markers stripped');
  });
});

describe('classifyCustomContext', () => {
  test('short imperative directive → pinned', () => {
    const c = classifyCustomContext('Always answer concisely and confidently.');
    assert.equal(c.pinned.length, 1);
    assert.equal(c.sensitive.length, 0);
  });
  test('salary/comp line → sensitive', () => {
    const c = classifyCustomContext('My current CTC is 30 LPA and I want 45.');
    assert.equal(c.sensitive.length, 1);
    assert.equal(c.hasSensitive, true);
  });
  test('confidential pricing → sensitive', () => {
    const c = classifyCustomContext('Our discount floor is 20% and the cost price is confidential.');
    assert.equal(c.sensitive.length, 1);
  });
  test('long topical note → searchable', () => {
    const note = 'The migration project moved 4 services from a monolith to event-driven microservices using Kafka, taking eight months with a team of five engineers.';
    const c = classifyCustomContext(note);
    assert.equal(c.searchable.length, 1);
    assert.equal(c.pinned.length, 0);
    assert.equal(c.sensitive.length, 0);
  });
  test('sensitive precedence: a short directive that names salary is sensitive, not pinned', () => {
    const c = classifyCustomContext('Never reveal my current salary of 30 LPA.');
    assert.equal(c.sensitive.length, 1, 'salary term wins over the directive shape');
    assert.equal(c.pinned.length, 0);
  });
  test('mixed blob categorises each chunk independently', () => {
    const blob = 'Be concise.\n\nI led a fraud-detection ML project at scale.\n\nMy target compensation is 45 LPA.';
    const c = classifyCustomContext(blob);
    assert.equal(c.pinned.length, 1);
    assert.equal(c.searchable.length, 1);
    assert.equal(c.sensitive.length, 1);
  });
});

describe('selectCustomContextForAnswer — sensitive gating by answer type', () => {
  const blob = 'Be concise.\n\nI built a payments platform.\n\nMy current CTC is 30 LPA.';
  const classified = classifyCustomContext(blob);

  test('negotiation answer MAY see sensitive salary context', () => {
    const sel = selectCustomContextForAnswer(classified, 'negotiation_answer');
    assert.equal(sel.sensitiveIncluded, true);
    assert.ok(sel.included.some(c => /CTC|LPA/.test(c.text)), 'salary present for negotiation');
  });
  test('behavioral answer does NOT see sensitive salary context', () => {
    const sel = selectCustomContextForAnswer(classified, 'behavioral_interview_answer');
    assert.equal(sel.sensitiveIncluded, false);
    assert.ok(!sel.included.some(c => /CTC|LPA/.test(c.text)), 'salary excluded for behavioral');
    assert.ok(sel.excluded.some(e => e.category === 'sensitive'), 'records the exclusion');
    // but it DOES still see pinned + searchable
    assert.ok(sel.included.some(c => /concise/i.test(c.text)));
    assert.ok(sel.included.some(c => /payments/i.test(c.text)));
  });
  test('coding answer sees NO custom context at all (forbidden layer)', () => {
    const sel = selectCustomContextForAnswer(classified, 'coding_question_answer');
    assert.equal(sel.included.length, 0);
    assert.equal(sel.sensitiveIncluded, false);
  });
  test('dsa answer sees NO custom context at all', () => {
    const sel = selectCustomContextForAnswer(classified, 'dsa_question_answer');
    assert.equal(sel.included.length, 0);
  });
  test('identity answer sees NO custom context (self-contained)', () => {
    const sel = selectCustomContextForAnswer(classified, 'identity_answer');
    assert.equal(sel.included.length, 0);
  });
});

describe('buildScopedCustomContext — end-to-end rendering', () => {
  test('coding answer renders empty scoped context', () => {
    const { text } = buildScopedCustomContext('Be concise.\n\nSalary is 30 LPA.', 'coding_question_answer');
    assert.equal(text, '');
  });
  test('behavioral answer keeps pinned+searchable, drops sensitive', () => {
    const { text } = buildScopedCustomContext('Be concise.\n\nI shipped a data pipeline.\n\nMy CTC is 30 LPA.', 'behavioral_interview_answer');
    assert.match(text, /concise/i);
    assert.match(text, /data pipeline/i);
    assert.doesNotMatch(text, /CTC|LPA/);
  });
  test('negotiation answer keeps everything including salary', () => {
    const { text } = buildScopedCustomContext('Be concise.\n\nMy CTC is 30 LPA.', 'negotiation_answer');
    assert.match(text, /CTC|LPA/);
  });
  test('empty blob → empty text (backward compatible no-op)', () => {
    const { text } = buildScopedCustomContext('', 'general_meeting_answer');
    assert.equal(text, '');
  });
});

describe('SENSITIVE_RE hardening — adversarial comp/pricing phrasings must NOT leak', () => {
  // Each of these evaded the original regex and would have landed in
  // searchable/pinned (→ surfaced to behavioral/JD/general answers). They must
  // now classify as sensitive so the answer-type gate can contain them.
  const MUST_BE_SENSITIVE = [
    'My current pay is 30 lakhs',
    'I make $185k base plus 60k in options',
    'My TC is 320k',
    'Our gross margins are 70 percent',
    'Our floor price is $50/seat',
    'do not disclose our roadmap',
    "Please don't reveal our COGS to the prospect",
    'Our EBITDA is up; keep this internal',
    'Target compensation: ₹45,00,000',
    'Base salary 150000 USD',
    'Our rebate ceiling is 15%',
    'ACV is around 40k and churn is 3%',
  ];
  for (const text of MUST_BE_SENSITIVE) {
    test(`"${text}" → sensitive`, () => {
      const c = classifyCustomContext(text);
      assert.equal(c.sensitive.length, 1, `expected sensitive, got pinned=${c.pinned.length} searchable=${c.searchable.length}`);
    });
    test(`"${text}" is DROPPED for a behavioral answer`, () => {
      const { text: scoped } = buildScopedCustomContext(text, 'behavioral_interview_answer');
      assert.equal(scoped, '', 'sensitive phrasing must not reach a behavioral answer');
    });
  }

  test('SENSITIVE_RE is case-insensitive (an uppercased salary line still gates)', () => {
    assert.equal(classifyCustomContext('MY SALARY IS CONFIDENTIAL').sensitive.length, 1);
    assert.equal(classifyCustomContext('Total Comp: 200K').sensitive.length, 1);
  });

  test('benign style/skill notes are NOT over-classified as sensitive', () => {
    // Guard against the broadened regex turning ordinary notes sensitive.
    assert.equal(classifyCustomContext('I prefer Python and Go.').sensitive.length, 0);
    assert.equal(classifyCustomContext('Be concise and confident.').sensitive.length, 0);
    assert.equal(classifyCustomContext('I led a team of five engineers.').sensitive.length, 0);
  });
});

describe('classifier edge cases', () => {
  test('all-sensitive blob → empty for non-negotiation, full for negotiation', () => {
    const blob = 'My CTC is 30 LPA.\n\nEquity is 0.5%.\n\nBonus target 20%.';
    assert.equal(buildScopedCustomContext(blob, 'behavioral_interview_answer').text, '');
    assert.match(buildScopedCustomContext(blob, 'negotiation_answer').text, /CTC|Equity|Bonus/);
  });
  test('160-char boundary: <=160 directive is pinned, >160 is searchable', () => {
    const at160 = 'Always ' + 'x'.repeat(160 - 'Always '.length);
    assert.equal(at160.length, 160);
    assert.equal(classifyCustomContext(at160).pinned.length, 1);
    const at161 = 'Always ' + 'x'.repeat(161 - 'Always '.length);
    assert.equal(at161.length, 161);
    assert.equal(classifyCustomContext(at161).searchable.length, 1);
  });
  test('whitespace/bullet-only blob → nothing included for any answer type', () => {
    assert.equal(buildScopedCustomContext('  \n - \n * ', 'general_meeting_answer').text, '');
  });
});

describe('summarizeCustomContextSelection — PII-free telemetry', () => {
  test('summary carries counts + categories only, never raw content', () => {
    const blob = 'Be concise.\n\nMy CTC is 30 LPA.';
    const classified = classifyCustomContext(blob);
    const sel = selectCustomContextForAnswer(classified, 'behavioral_interview_answer');
    const summary = summarizeCustomContextSelection(sel, classified);
    const serialized = JSON.stringify(summary);
    assert.doesNotMatch(serialized, /30 LPA|CTC|concise/, 'no raw content in telemetry');
    assert.equal(summary.sensitive, 1);
    assert.equal(summary.sensitiveIncluded, false);
    assert.ok(Array.isArray(summary.excluded));
  });
});
