// Two routing defects left after the retrieval work, both measured at every document size with a
// résumé + job description as the ONLY documents (run-profile.mjs, 2026-09-20):
//  1. a factual question no rule recognised was inferred to be about the user's own PROJECT, because
//     the résumé is a job-seeking mode's primary source — "who is the hiring manager", "How large is
//     the group I would be joining?", "How much ownership of the company comes with the offer?";
//  2. a question with NO claim planned reference-file pools that were empty — "Will they help me move
//     countries and pay for it?" went out with zero evidence.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.cwd(), 'dist-electron/electron');
const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const { classifyTurn } = await load('context-intelligence/question/turn-classifier.js');
const { decide } = await load('context-intelligence/orchestration/orchestrator.js');
const { resolveModePolicy } = await load('context-intelligence/policies/mode-policy-registry.js');

const policy = resolveModePolicy('looking-for-work');
const cls = (q, extra = {}) => classifyTurn({ resolvedQuestion: q, policy, isFollowUp: false, hasAttachedDocuments: true, profileOnlyDocuments: true, ...extra });
const plan = (q, extra = {}) => decide({ requestId: 'r', requestSequence: 1, surface: 'manual-chat', modeId: 'looking-for-work', scope: { userId: 'u' }, sessionId: `s-${Math.random()}`, manualQuestion: q, hasAttachedDocuments: true, profileOnlyDocuments: true, ...extra }).retrievalPlan;

describe('prospective questions are about the job being applied for', () => {
  for (const q of ['who is the hiring manager', 'How large is the group I would be joining?', 'How much ownership of the company comes with the offer?']) {
    test(`"${q}" claims the job side, not the user's project`, () => {
      const c = cls(q);
      assert.ok(c.claimTypes.includes('JOB_REQUIRED_SKILL'), c.claimTypes.join(','));
      assert.ok(!c.claimTypes.includes('USER_PROJECT'), c.claimTypes.join(','));
      assert.equal(c.requiredSourceTypes[0], 'JOB_DESCRIPTION');
    });
  }
  test('a question that already carries an EMPLOYMENT claim is left to the corpus check (owner decision 11)', () => {
    const c = cls('Who would be my manager?');
    assert.deepEqual(c.claimTypes, ['USER_EMPLOYMENT'], 'grammar alone must not add the job claim — see ProfileDocumentReachability');
  });
  test('controls: questions about the user\'s own past are untouched', () => {
    for (const q of ['Tell me about a project you built', 'How many engineers did you work with on Project Cinder-115?']) {
      assert.deepEqual(cls(q).claimTypes, ['USER_PROJECT'], q);
    }
    assert.ok(!cls('What would you do differently on that project?').claimTypes.includes('JOB_REQUIRED_SKILL'), '"would you" is not prospective about a job');
    assert.ok(!cls('How would I reverse a linked list in Python?').claimTypes.includes('JOB_REQUIRED_SKILL'), 'a coding task is never a job question');
  });
  test('a mode with no job description never gains the claim', () => {
    const general = resolveModePolicy('general');
    if (general.allowedSourceTypes.includes('JOB_DESCRIPTION')) return;   // nothing to assert in this build
    const c = classifyTurn({ resolvedQuestion: 'Who would be my manager?', policy: general, isFollowUp: false });
    assert.ok(!c.claimTypes.includes('JOB_REQUIRED_SKILL'));
  });
});

describe('an unclaimed question looks in the résumé and job description when they are the only documents', () => {
  const Q = 'Will they help me move countries and pay for it?';
  test('profile-only: the plan reaches the job description', () => {
    const p = plan(Q);
    assert.equal(p.shouldRetrieve, true);
    assert.ok(p.sourceTypes.includes('JOB_DESCRIPTION'), p.sourceTypes.join(','));
  });
  test('control: with a mode attachment present, an UNCLAIMED plan still keeps identity pools out (issue 5)', () => {
    const p = decide({ requestId: 'r', requestSequence: 1, surface: 'manual-chat', modeId: 'looking-for-work', scope: { userId: 'u' }, sessionId: 's-x', manualQuestion: 'okay and then what', hasAttachedDocuments: true, profileOnlyDocuments: false }).retrievalPlan;
    if (p.shouldRetrieve && !decide({ requestId: 'r', requestSequence: 1, surface: 'manual-chat', modeId: 'looking-for-work', scope: { userId: 'u' }, sessionId: 's-y', manualQuestion: 'okay and then what', hasAttachedDocuments: true }).claimRequirements.length) {
      assert.ok(!p.sourceTypes.includes('RESUME'), p.sourceTypes.join(','));
    }
  });
});
