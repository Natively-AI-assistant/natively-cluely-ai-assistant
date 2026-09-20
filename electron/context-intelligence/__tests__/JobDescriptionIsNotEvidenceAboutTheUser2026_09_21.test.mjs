// Owner decision, 2026-09-21: the job description may be RETRIEVED for a question about the user, but it
// can never SATISFY one. Found by an independent review: "Have I ever been on call?" — the résumé says
// nothing, the JD mentions a "hiring-manager call", and the turn was reported FULLY supported by six
// job-description chunks.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.cwd(), 'dist-electron/electron');
const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const { createProfileRetrievalPort } = await load('context-intelligence/retrieval/profile-retrieval-port.js');
const { orchestrate } = await load('context-intelligence/orchestration/orchestrator.js');
const { resolveModePolicy } = await load('context-intelligence/policies/mode-policy-registry.js');

const MODE = 'looking-for-work'; const policy = resolveModePolicy(MODE);
const RESUME = ['# Maya Okonkwo-Reyes', '', '## Experience', '', ...Array.from({ length: 20 }, (_, i) => `### Project Alder-${i}\n\nRebuilt the billing reconciler for ledger ${i} with a team of ${3 + i} engineers.\n`)].join('\n');
const JD = ['# Job description — Principal Engineer', '', '## Interview process', '', 'Five stages: recruiter screen, hiring-manager call, systems design, an incident round, and a values conversation.', '',
  '## On-call', '', 'Engineers carry the pager one week in every seven; the on call rotation is shared across three pods.', '',
  '## Reporting line', '', 'This role reports to Dagny Verhoeven, Director of Ledger Infrastructure.', '',
  ...Array.from({ length: 20 }, (_, i) => `### Team profile: pod ${i}\n\nThe pod owns the settlement stream for ledger ${i} and currently has ${4 + i} engineers.\n`)].join('\n');
const docs = [{ kind: 'resume', sourceId: 'p-r', versionId: 'v1', fileName: 'resume.md', structured: null, rawText: RESUME }, { kind: 'jd', sourceId: 'p-j', versionId: 'v1', fileName: 'jd.md', structured: null, rawText: JD }];
const ask = (q) => orchestrate({ requestId: 'r', requestSequence: 1, surface: 'manual_chat', modeId: MODE, scope: { userId: 'u' }, sessionId: `s-${Math.random()}`, manualQuestion: q, hasAttachedDocuments: true, profileOnlyDocuments: true },
  createProfileRetrievalPort({ docs, allowedSourceTypes: policy.allowedSourceTypes, profileSources: policy.profileSources, userId: 'u' }));
const jdOnly = (r) => r.evidence.length > 0 && r.evidence.every((e) => e.sourceType === 'JOB_DESCRIPTION');

describe('a question the user asks about THEIR OWN PAST', () => {
  for (const q of ['Have I ever been on call?', 'Was I on call at my last job?']) {
    test(`"${q}" is not FULLY supported by the employer's document`, async () => {
      const r = await ask(q);
      if (jdOnly(r) || r.evidence.some((e) => e.sourceType === 'JOB_DESCRIPTION')) assert.notEqual(r.answerability, 'FULL', `FULL on: ${r.evidence.map((e) => e.sourceType).join(',')}`);
      assert.notEqual(r.trace.fallbackUsed, 'NONE', 'an unsupported claim about the user must be disclosed, not reported clean');
    });
  }
});

describe('what must keep working', () => {
  test('a job-description question that only carries the classifier\'s GUESSED user claim is still supported by the JD', async () => {
    const r = await ask('How many engineers are in pod 3?');
    assert.ok((r.decision.inferredClaimTypes ?? []).length > 0, 'fixture: the classifier no longer guesses a claim for this question');
    assert.ok(r.evidence.some((e) => e.sourceType === 'JOB_DESCRIPTION' && /pod 3\b/.test(e.content)));
    assert.equal(r.answerability, 'FULL');
  });
  test('a PROSPECTIVE question is about the job — the JD is its source', async () => {
    const r = await ask('Who would be my manager?');
    assert.ok(r.evidence.some((e) => /Dagny Verhoeven/.test(e.content)) || r.answerability !== 'FULL', 'either the reporting line is found, or the turn is honest about not finding it');
    const found = r.evidence.some((e) => e.sourceType === 'JOB_DESCRIPTION' && /Dagny Verhoeven/.test(e.content));
    if (found) assert.notEqual(r.answerability, 'NONE', 'found in the JD and still reported as nothing');
  });
  test('an explicit question about the job is untouched', async () => {
    const r = await ask('Who does this role report to?');
    assert.ok(r.evidence.some((e) => /Dagny Verhoeven/.test(e.content))); assert.equal(r.answerability, 'FULL');
  });
});
