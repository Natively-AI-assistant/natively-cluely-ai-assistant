// Context Intelligence V3 — first-person planning + comparison intent (2026-07-31).
//
// The planner half of the source-routing defect: PERSONAL_RE knew "your",
// "my" and "the candidate" but not first-person auxiliaries, so manual-chat
// questions — which the USER asks about THEMSELF — planned no résumé side at
// all ("Do I meet the two-year requirement?" planned only JOB_DESCRIPTION,
// verified live). And USER_MOTIVATION was missing from CLAIM_TO_SOURCE, so
// motivation questions took the FAST path and answered from model knowledge
// with no disclosure.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { classifyTurn } = await import(pathToFileURL(path.join(base, 'question/turn-classifier.js')).href);
const { resolveModePolicy } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);

const LFW = resolveModePolicy('looking-for-work');
const cls = (q, policy = LFW) => classifyTurn({ resolvedQuestion: q, policy, isFollowUp: false });

describe('first-person self-reference is personal', () => {
  test('"Do I have Kubernetes experience?" plans the résumé side', () => {
    const c = cls('Do I have Kubernetes experience?');
    assert.ok(c.claimTypes.includes('USER_SKILL'));
    assert.ok(c.requiredSourceTypes.includes('RESUME'));
  });

  test('"Do I meet the two-year professional experience requirement?" plans BOTH sides', () => {
    const c = cls('Do I meet the two-year professional experience requirement?');
    assert.ok(c.claimTypes.includes('USER_SKILL') || c.claimTypes.includes('USER_EMPLOYMENT'),
      'the résumé side is claimed');
    assert.ok(c.claimTypes.includes('JOB_REQUIRED_SKILL'), 'the JD side is claimed');
    assert.ok(c.requiredSourceTypes.includes('RESUME'));
    assert.ok(c.requiredSourceTypes.includes('JOB_DESCRIPTION'));
  });

  test('"Which required languages do I not list?" is a résumé-vs-JD comparison', () => {
    const c = cls('Which required languages do I not list?');
    assert.ok(c.requiredSourceTypes.includes('RESUME'));
    assert.ok(c.requiredSourceTypes.includes('JOB_DESCRIPTION'));
  });

  test('"What is my CGPA?" claims education', () => {
    const c = cls('What is my CGPA?');
    assert.ok(c.claimTypes.includes('USER_EDUCATION'));
    assert.ok(c.requiredSourceTypes.includes('RESUME'));
  });

  test('"how do I reverse a linked list in Python?" stays IMPERSONAL', () => {
    const c = cls('how do I reverse a linked list in Python?');
    assert.ok(!c.claimTypes.some((t) => String(t).startsWith('USER_')),
      'an instruction request must not be dragged through résumé retrieval');
  });
});

describe('review hardening: first-person technical self-talk stays impersonal', () => {
  // Review finding (2026-07-31): the first-person widening dragged
  // technical-interview's bread-and-butter questions through résumé-claim
  // machinery — a segfault question got a motivation disclosure.
  for (const q of [
    'why do I get a segfault when I run this?',
    'should I use a hashmap or a BST here?',
    'can I solve this with dynamic programming?',
  ]) {
    test(`${JSON.stringify(q)} carries no USER_* claim`, () => {
      const c = cls(q, resolveModePolicy('technical-interview'));
      assert.ok(!c.claimTypes.some((t) => String(t).startsWith('USER_')),
        `got claims: ${c.claimTypes.join(',')}`);
    });
  }
});

describe('review hardening: JOB_RE widening stays narrow', () => {
  const GENERAL = resolveModePolicy('general');
  test('"what fields are required in this form" is not a JD claim', () => {
    const c = cls('what fields are required in this form?', GENERAL);
    assert.ok(!c.claimTypes.includes('JOB_REQUIRED_SKILL'));
  });
  test('"average salary for data scientists" is not a JD claim', () => {
    const c = cls('what is the average salary for data scientists?', GENERAL);
    assert.ok(!c.claimTypes.includes('JOB_REQUIRED_SKILL'));
  });
  test('recruiting presence-check does NOT force a JD conjunction (no profile JD there)', () => {
    const c = cls('do you know if the candidate has java experience?', resolveModePolicy('recruiting'));
    assert.ok(!c.claimTypes.includes('JOB_REQUIRED_SKILL'),
      'a JD is merely possible in recruiting — forcing the comparison made plain candidate questions structurally PARTIAL');
    assert.ok(c.claimTypes.includes('USER_SKILL'));
  });
});

describe('motivation questions are grounded turns, not FAST', () => {
  test('"Why did I build Natively?" claims motivation and retrieves', () => {
    const c = cls('Why did I build Natively?');
    assert.ok(c.claimTypes.includes('USER_MOTIVATION'));
    assert.notEqual(c.path, 'FAST', 'FAST here means answering a personal WHY from model knowledge');
    assert.equal(c.shouldRetrieve, true);
  });
});

describe('presence-check comparison respects mode authorization', () => {
  test('the JD side is only added where the mode allows a JD at all', () => {
    const seminar = resolveModePolicy('seminar');
    const c = cls('Do I have Kubernetes experience?', seminar);
    assert.ok(!c.requiredSourceTypes.includes('JOB_DESCRIPTION'),
      'seminar authorizes no JD — the comparison cannot widen authorization');
  });

  test('the salary question plans the JD', () => {
    const c = cls('What is the base salary?');
    assert.ok(c.requiredSourceTypes.includes('JOB_DESCRIPTION'));
  });
});
