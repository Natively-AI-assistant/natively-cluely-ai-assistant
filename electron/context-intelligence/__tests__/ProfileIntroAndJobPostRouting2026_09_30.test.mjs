// Profile Intelligence planning gaps, reproduced live 2026-09-30 (dev:agent, hotkey + typed,
// résumé/JD ingested through __e2e__:ingest-profile-doc):
//  1. "Thanks for hopping on. Why don't you start by telling me a bit about yourself?" in
//     looking-for-work with a résumé + JD loaded planned [PROFILE_FACT, MEETING_TRANSCRIPT,
//     REFERENCE_FILE] — no RESUME — and answered with zero evidence. "Why don't you start…" matched
//     the motivation cue, USER_MOTIVATION prohibits the résumé, and the named aspect suppressed the
//     catch-all employment claim. PROFILE_FACT has no production store (v3ProfileSources serves none).
//  2. JD-only profile, typed: "based on the job post what are the rounds…" planned
//     [RESUME, PROFILE_FACT, REFERENCE_FILE] and answered "I don't have the job post in front of me".
//     "job post" was not job vocabulary.
// Pure classification/planning — no platform branch is involved.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.cwd(), 'dist-electron/electron');
const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const { classifyTurn } = await load('context-intelligence/question/turn-classifier.js');
const { decide } = await load('context-intelligence/orchestration/orchestrator.js');
const { resolveModePolicy } = await load('context-intelligence/policies/mode-policy-registry.js');

const cls = (q, modeId = 'looking-for-work', extra = {}) => classifyTurn({
  resolvedQuestion: q, policy: resolveModePolicy(modeId), isFollowUp: false,
  hasAttachedDocuments: true, profileOnlyDocuments: true, ...extra,
});
const plan = (q, modeId = 'looking-for-work', extra = {}) => decide({
  requestId: 'r', requestSequence: 1, surface: 'what-to-answer', modeId, scope: { userId: 'u' },
  sessionId: `s-${Math.random()}`, transcriptQuestion: q, hasAttachedDocuments: true, profileOnlyDocuments: true, ...extra,
}).retrievalPlan;

describe('a self-introduction always reaches the résumé', () => {
  const intros = [
    "Thanks for hopping on. Why don't you start by telling me a bit about yourself?",
    'Why dont you start by telling me about yourself',
    'why don’t you go ahead and introduce yourself',
    'Tell me a little bit about yourself.',
    'Could you walk me through your background?',
  ];
  for (const q of intros) {
    test(`"${q}" plans RESUME`, () => {
      const c = cls(q);
      assert.ok(c.claimTypes.includes('USER_EMPLOYMENT'), c.claimTypes.join(','));
      assert.ok(plan(q).sourceTypes.includes('RESUME'), plan(q).sourceTypes.join(','));
    });
  }

  test('an invitation ("why don\'t you start…") is not a reason question', () => {
    const c = cls("Thanks for hopping on. Why don't you start by telling me a bit about yourself?");
    assert.ok(!c.claimTypes.includes('USER_MOTIVATION'), c.claimTypes.join(','));
  });

  test('technical-interview gets the same intro routing', () => {
    assert.ok(plan("Why don't you start by introducing yourself?", 'technical-interview').sourceTypes.includes('RESUME'));
  });

  test('an intro joined to another ask still reaches the résumé', () => {
    const q = 'Tell me about yourself and why you want this role.';
    assert.ok(cls(q).claimTypes.includes('USER_EMPLOYMENT'), cls(q).claimTypes.join(','));
    assert.ok(plan(q).sourceTypes.includes('RESUME'), plan(q).sourceTypes.join(','));
  });

  test('an intro in the SAME clause as a reason cue claims both sides', () => {
    // "why" survives here (it is not the invitation shape), so motivation stays claimed and the
    // intro rule adds the employment claim that the named aspect used to suppress.
    const q = 'So why this company? Walk me through your background first, and why you left your last job.';
    const c = cls(q);
    assert.ok(c.claimTypes.includes('USER_EMPLOYMENT'), c.claimTypes.join(','));
    assert.ok(plan(q).sourceTypes.includes('RESUME'), plan(q).sourceTypes.join(','));
  });

  describe('controls: real reason questions keep the motivation claim', () => {
    for (const q of ['Why do you want to leave your current job?', 'Why did you decide to leave Cindervale?']) {
      test(q, () => assert.ok(cls(q).claimTypes.includes('USER_MOTIVATION'), cls(q).claimTypes.join(',')));
    }
    test('a motivation-only question is not widened to the résumé by the intro rule', () => {
      assert.ok(!plan('Why do you want to work here?').sourceTypes.includes('RESUME'), plan('Why do you want to work here?').sourceTypes.join(','));
    });
  });

  test('coding control: a pure coding question with a profile loaded plans no résumé', () => {
    const p = plan('Write a Python function that reverses a singly linked list in place.', 'technical-interview');
    assert.ok(!p.sourceTypes.includes('RESUME'), p.sourceTypes.join(','));
  });
});

describe('a pointer at the job posting plans the job description', () => {
  for (const q of [
    'final round tomorrow. based on the job post what are the rounds, who is the last conversation with, and what should i brush up on for the design one',
    'What does the job posting say about on-call?',
    'According to the posting, is this remote?',
    'what does their job listing say about the team size',
  ]) {
    test(`"${q.slice(0, 60)}…" plans JOB_DESCRIPTION`, () => {
      const c = cls(q);
      assert.ok(c.claimTypes.includes('JOB_REQUIRED_SKILL'), c.claimTypes.join(','));
      assert.ok(plan(q).sourceTypes.includes('JOB_DESCRIPTION'), plan(q).sourceTypes.join(','));
    });
  }

  test('control: writing advice about job postings in General is not a JD claim', () => {
    const c = cls('How do I write a good job posting?', 'general', { hasAttachedDocuments: false, profileOnlyDocuments: false });
    assert.ok(!c.claimTypes.includes('JOB_REQUIRED_SKILL'), c.claimTypes.join(','));
    assert.equal(c.path, 'FAST');
  });

  test('control: a blog post is not a job posting', () => {
    const c = cls('What did the blog post say about retries?', 'looking-for-work');
    assert.ok(!c.claimTypes.includes('JOB_REQUIRED_SKILL'), c.claimTypes.join(','));
  });
});
