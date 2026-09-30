// The user's own life is not a status to check (2026-09-30).
//
// Measured on the dev set: asked "Why'd you leave Cindervale?" with the résumé
// loaded, the candidate answered "The résumé shows Cindervale running July 2025
// to January 2026 … I don't have the specifics of how it wrapped up in front of
// me, so I'd rather confirm those details". 12 of 120 replayed Looking-for-work
// answers carried such a phrase; with the rule, 4. A gap question ("there's a gap
// of about eight months before your current role") also invented a reason ("a
// deliberate pause") because the heard-commitment notice did not know the shape.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = (p) => import(pathToFileURL(path.resolve(process.cwd(), 'dist-electron/electron', p)).href);
const composer = await dist('context-intelligence/generation/prompt-composer.js');
const { composePrompt, personalCommitmentNotice } = composer;
const { decide } = await dist('context-intelligence/orchestration/orchestrator.js');
const { resolveModePolicy } = await dist('context-intelligence/policies/mode-policy-registry.js');

const compose = (modeId, q) => composePrompt({
  decision: decide({ requestId: 'r', requestSequence: 1, surface: 'what-to-answer', modeId, scope: { userId: 'local' }, sessionId: 's', transcriptQuestion: q }),
  policy: resolveModePolicy(modeId), evidence: [], heardQuestion: true,
});

describe('the own-life rule is in the job modes\' system prompts', () => {
  for (const modeId of ['looking-for-work', 'technical-interview']) {
    test(modeId, () => {
      const { system } = compose(modeId, 'Why did you leave your last job?');
      assert.match(system, /Speaking as the user about their own life/);
      assert.match(system, /never cite their résumé or profile as a document/);
      assert.match(system, /never with "I don't have a specific example"/);
    });
  }
  // Scoped (2026-09-30): in Team Meet the rule turned a colleague's "You did a payments
  // migration at your last company, right?" into "I don't have a payments migration in
  // my background" 6 of 6 times (0 of 6 without it).
  for (const modeId of ['team-meet', 'general', 'sales', 'recruiting', 'call-center', 'lecture', 'seminar']) {
    test(`not in ${modeId}`, () => {
      const { system } = compose(modeId, 'You did a payments migration at your last company, right?');
      assert.doesNotMatch(system, /Speaking as the user about their own life/);
    });
  }
  test('its example names no benchmark person or employer', () => {
    const { system } = compose('looking-for-work', 'x');
    const rule = system.slice(system.indexOf('Speaking as the user about their own life'));
    assert.doesNotMatch(rule.slice(0, 900), /Cindervale|Larkspur|Tallowmarket|Nimbuscrest|Brindlecap/);
  });
});

describe('a gap question is a question about the user\'s own reason', () => {
  for (const q of [
    "I'm looking at your resume and there's a gap of about eight months before your current role. What happened there?",
    'What happened between those two jobs?',
    'Was that a career break?',
    'Why the switch from consulting to product?',
  ]) {
    test(q, () => assert.match(personalCommitmentNotice(q, 'looking-for-work', true), /own preference, commitment or reason/));
  }
  test('not in recruiting (the user is the recruiter)', () => {
    assert.equal(personalCommitmentNotice('What happened there, was that a career break?', 'recruiting', true), '');
  });
  test('an unrelated question is unaffected', () => {
    assert.equal(personalCommitmentNotice('How does a hash map handle collisions?', 'technical-interview', true), '');
  });
});
