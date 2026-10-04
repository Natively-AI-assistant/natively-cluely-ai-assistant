// A profile document handed over whole is not removed from the prompt by the claim-authority gate (2026-10-05, E16b).
//
// Measured on the evidence-rich benchmark (630 development turns), on the build that plans the whole profile on
// every retrieving turn: the profile port returned the résumé and the job description whole, the adapter admitted
// them, and the claim-authority gate removed one or both on nine turns.
//
//  * Typed, Technical Interview: "do i clear their experience bar on paper? count it from my cv as of today: total
//    years, and how long i've been at senior / tech lead level". The needed claim is about the user, the job
//    description cannot evidence it, and the bar the question asks about left the prompt.
//  * Typed, Technical Interview, only a job description loaded: every item was removed and the turn read nothing
//    (7 items → 0; 11,751 → 2,159 characters).
//  * Typed, Looking for work: "why am I leaving lumenquay": résumé and job description both removed.
//
// Claim authority exists so a job description's "Postgres required" cannot ANSWER "does the candidate have Postgres
// experience?". That is decided by what an item may SUPPORT (acceptedFor, evidenceSupportsClaim), which is not
// touched here. Only presence in the prompt changes, and only for a résumé or job description the profile port hands
// over entire, exactly as for a whole file of the mode (LoadedPackReachesEveryTurn2026_10_04).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { createProfileRetrievalPort, profileWholeInfo } = await import(pathToFileURL(path.join(base, 'retrieval/profile-retrieval-port.js')).href);
const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
const { decide, evidenceSupportsClaim } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);

const filler = (topic, n) => Array.from({ length: n }, (_, i) => `- ${topic} item ${i + 1}: maintained the service, wrote the runbook and reviewed the rollout plan.`).join('\n');
const RESUME_RAW = [
  '# Mira Okonjo', 'Platform engineer, Lisbon', '',
  '## Experience', '### Harbourline Logistics, Staff Engineer (2022 to present)', filler('Harbourline', 14), '',
  '### Tessel Freight, Senior Engineer (2018 to 2022)', filler('Tessel', 14), '',
  '## Education', 'BSc Computer Science, Universidade do Porto, 2014.',
].join('\n');
const JD_RAW = [
  '# Senior Platform Engineer, Quillmere Payments', '',
  '## Requirements', '- 6+ years building distributed backend systems, at least 2 of them as a senior or tech lead', '- Experience with Kafka and PostgreSQL', filler('Requirement', 8), '',
  '## Process', 'Four interviews: recruiter screen, coding, system design, hiring manager.',
].join('\n');
const STRUCTURED_RESUME = {
  identity: { name: 'Mira Okonjo', location: 'Lisbon' },
  skills: { languages: ['Go', 'TypeScript'], frameworks: ['gRPC'] },
  experience: [{ role: 'Staff Engineer', company: 'Harbourline Logistics', start_date: '2022', end_date: 'present', bullets: ['Maintained the service.'] }],
  education: [{ degree: 'BSc', field: 'Computer Science', institution: 'Universidade do Porto' }],
};
const STRUCTURED_JD = { title: 'Senior Platform Engineer', company: 'Quillmere Payments', requirements: ['6+ years building distributed backend systems'], technologies: ['Kafka', 'PostgreSQL'] };
const RESUME = { kind: 'resume', sourceId: 'psrc_res', versionId: 'v1', fileName: 'Resume (PI)', structured: STRUCTURED_RESUME, rawText: RESUME_RAW };
const JD = { kind: 'jd', sourceId: 'psrc_jd', versionId: 'v1', fileName: 'JD (PI)', structured: STRUCTURED_JD, rawText: JD_RAW };

let seq = 0;
const ask = async (modeId, surface, q, docs, extra = {}) => {
  const policy = MODE_POLICIES[modeId];
  const port = createProfileRetrievalPort({ docs, allowedSourceTypes: policy.allowedSourceTypes, profileSources: policy.profileSources, userId: 'u1', ...extra });
  const decision = decide({
    requestId: `wp${++seq}`, requestSequence: seq, surface, modeId, scope: { userId: 'u1', modeId }, sessionId: 's',
    ...(surface === 'manual-chat' ? { manualQuestion: q } : { transcriptQuestion: q }),
    profileWhole: profileWholeInfo(docs, policy.allowedSourceTypes, policy.profileSources),
  });
  // A mode with no profile sources gets no port at all.
  const { evidence, attempts } = port ? await port.retrieve({ decision }) : { evidence: [], attempts: [] };
  return { decision, evidence, attempts };
};
const whole = (evidence, provenance) => evidence.find((e) => e.provenance === provenance && e.metadata?.wholeDocument === true);
const needed = (decision) => new Set(decision.claimRequirements.filter((c) => c.authority === 'PRIVATE_SOURCE_REQUIRED').map((c) => c.claimType));

describe('a profile document handed over whole stays in the prompt', () => {
  test('"do I clear their experience bar? count it from my CV": the job description is there with the résumé', async () => {
    const { decision, evidence } = await ask('technical-interview', 'manual-chat',
      "do i clear their experience bar on paper? count it from my cv as of today: total years, and how long i've been at senior / tech lead level", [RESUME, JD]);
    assert.equal(decision.retrievalPlan.wholeProfile, true, 'fixture: the profile is handed over whole');
    assert.ok(needed(decision).size > 0, 'fixture: the turn has claims the gate filters on');
    assert.ok(whole(evidence, 'PROFILE_RESUME'), 'the résumé, whole');
    const jd = whole(evidence, 'PROFILE_JOB_DESCRIPTION');
    assert.ok(jd, 'the job description, whole');
    assert.match(jd.content, /at least 2 of them as a senior or tech lead/);
  });

  test('only a job description loaded, a question about the user: the turn does not read nothing', async () => {
    const { decision, evidence } = await ask('technical-interview', 'manual-chat',
      'which of the things they ask for have I actually done, and which should I be ready to be pushed on?', [JD]);
    assert.equal(decision.retrievalPlan.wholeProfile, true);
    assert.ok(evidence.length > 0, 'the turn has evidence');
    assert.ok(whole(evidence, 'PROFILE_JOB_DESCRIPTION'), 'the job description, whole');
  });

  test('"why am I leaving …" (Looking for work): the résumé and the job description are both there', async () => {
    const { decision, evidence } = await ask('looking-for-work', 'manual-chat', 'why am I leaving harbourline - give me the short version I can say out loud', [RESUME, JD]);
    assert.equal(decision.retrievalPlan.wholeProfile, true);
    assert.ok(whole(evidence, 'PROFILE_RESUME'), 'the résumé, whole');
    assert.ok(whole(evidence, 'PROFILE_JOB_DESCRIPTION'), 'the job description, whole');
  });

  test('heard, Technical Interview, a question about the candidate\'s own work: both documents', async () => {
    const { evidence } = await ask('technical-interview', 'what-to-answer', 'How often are you carrying the pager these days, and what is the incident load like?', [RESUME, JD]);
    assert.ok(whole(evidence, 'PROFILE_RESUME'));
    assert.ok(whole(evidence, 'PROFILE_JOB_DESCRIPTION'));
  });
});

describe('what the gate still does', () => {
  test('what the job description may SUPPORT is unchanged: never a claim about the user', async () => {
    const { evidence } = await ask('technical-interview', 'manual-chat',
      "do i clear their experience bar on paper? count it from my cv as of today: total years, and how long i've been at senior / tech lead level", [RESUME, JD]);
    const jd = whole(evidence, 'PROFILE_JOB_DESCRIPTION');
    assert.ok(jd);
    assert.equal(jd.sourceType, 'JOB_DESCRIPTION');
    for (const claim of jd.acceptedFor) assert.ok(!/^(USER_|CANDIDATE_)/.test(claim), `the JD accepted for ${claim}`);
    for (const claim of ['USER_EMPLOYMENT', 'USER_SKILL', 'USER_EXPERIENCE', 'CANDIDATE_EXPERIENCE']) {
      assert.equal(evidenceSupportsClaim(jd, claim, 'Do I have Kafka experience?'), false, claim);
    }
  });

  test('a profile NOT handed over whole keeps the gate exactly as it was', async () => {
    const { decision, evidence } = await ask('technical-interview', 'manual-chat',
      "do i clear their experience bar on paper? count it from my cv as of today: total years, and how long i've been at senior / tech lead level", [RESUME, JD], { wholeDocuments: false });
    const need = needed(decision);
    assert.ok(need.size > 0);
    for (const e of evidence) assert.ok(e.acceptedFor.some((c) => need.has(c)), `${e.sourceId} (${e.provenance}) kept without authority`);
  });

  test('a document the mode does not plan is still removed by the planned-type gate', async () => {
    const { decision, evidence } = await ask('sales', 'what-to-answer', 'What does the Operations plan cost per vehicle on annual billing?', [RESUME, JD]);
    assert.ok(!decision.retrievalPlan.sourceTypes.includes('RESUME'));
    assert.equal(evidence.filter((e) => e.provenance === 'PROFILE_RESUME').length, 0);
  });
});
