// The résumé and the job description are handed over whole (2026-10-03).
//
// Measured on the evidence-rich benchmark, with a 1,048-word résumé and a 760-word job description loaded through
// Profile Intelligence: a turn carries at most six profile passages out of about seventy, and of the rows whose
// answer rests on a résumé or JD fact, every needed fact was in the prompt on 13 of 33. With it there the answers
// scored 9.5, without it 6.6: "I'll confirm the before-and-after figures and come back to you", from a candidate
// whose résumé states them. The two documents together are about 2,700 tokens.
//
// When every registered résumé / JD has its raw text and together they fit PROFILE_WHOLE_MAX_TOKENS, a turn that
// reads the profile gets each PLANNED document as one item holding its whole text, in place of that document's
// raw-text passages and the semantic arm. The plan's item cap grows by the number of documents and its token budget
// by their size, on top of the room a whole reference pack gets. Structured sections, cards, the complete-inventory
// sections that license "X is not listed", derived facts and the planned-type gate are untouched.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const base = path.resolve(root, 'dist-electron/electron/context-intelligence');
const { createProfileRetrievalPort, profileWholeInfo, PROFILE_WHOLE_MAX_TOKENS, PROFILE_WHOLE_SECTION } =
  await import(pathToFileURL(path.join(base, 'retrieval/profile-retrieval-port.js')).href);
const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
const { decide, WHOLE_PACK_ITEM_OVERHEAD, PROFILE_WHOLE_ITEM_OVERHEAD } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);
const { WHOLE_PACK_MAX_TOKENS } = await import(pathToFileURL(path.join(base, 'retrieval/mode-retrieval-port.js')).href);

const LFW = MODE_POLICIES['looking-for-work'];
const filler = (topic, n) => Array.from({ length: n }, (_, i) => `- ${topic} item ${i + 1}: maintained the service, wrote the runbook and reviewed the rollout plan.`).join('\n');

// A résumé long enough that six passages cannot hold it, with the asked-about fact near the end.
const RESUME_RAW = [
  '# Mira Okonjo', 'Platform engineer, Lisbon', '',
  '## Experience', '### Harbourline Logistics, Staff Engineer (2022 to present)', filler('Harbourline', 14), '',
  '### Tessel Freight, Senior Engineer (2018 to 2022)', filler('Tessel', 14), '',
  '## Projects', '### Driftgate', filler('Driftgate', 10), '',
  '## On-call', 'On call one week in five. Nine incidents at Sev-2 or above last year, median time to restore 41 minutes.', '',
  '## Education', 'BSc Computer Science, Universidade do Porto, 2014.',
].join('\n');
const JD_RAW = [
  '# Senior Platform Engineer, Quillmere Payments', '',
  '## Requirements', '- 6+ years building distributed backend systems', '- Experience with Kafka and PostgreSQL', filler('Requirement', 8), '',
  '## Process', 'Four interviews: recruiter screen, coding, system design, hiring manager.',
].join('\n');
const STRUCTURED_RESUME = {
  identity: { name: 'Mira Okonjo', location: 'Lisbon' },
  skills: { languages: ['Go', 'TypeScript'], frameworks: ['gRPC'] },
  experience: [{ role: 'Staff Engineer', company: 'Harbourline Logistics', start_date: '2022', end_date: 'present', bullets: ['Maintained the service.'] }],
  education: [{ degree: 'BSc', field: 'Computer Science', institution: 'Universidade do Porto' }],
};
const STRUCTURED_JD = { title: 'Senior Platform Engineer', company: 'Quillmere Payments', requirements: ['6+ years building distributed backend systems'], technologies: ['Kafka', 'PostgreSQL'] };

const DOCS = [
  { kind: 'resume', sourceId: 'psrc_res', versionId: 'v1', fileName: 'Resume (PI)', structured: STRUCTURED_RESUME, rawText: RESUME_RAW },
  { kind: 'jd', sourceId: 'psrc_jd', versionId: 'v1', fileName: 'JD (PI)', structured: STRUCTURED_JD, rawText: JD_RAW },
];
const mkPort = (docs = DOCS, extra = {}) => createProfileRetrievalPort({
  docs, allowedSourceTypes: LFW.allowedSourceTypes, profileSources: LFW.profileSources, userId: 'u1', ...extra,
});
let seq = 0;
const req = (q, extra = {}) => ({
  requestId: `pw${++seq}`, requestSequence: seq, surface: 'what-to-answer', modeId: 'looking-for-work',
  scope: { userId: 'u1', modeId: 'looking-for-work' }, sessionId: 's', transcriptQuestion: q, hasAttachedDocuments: true, ...extra,
});
const ask = async (q, port = mkPort(), extra = {}) => {
  const decision = decide(req(q, { profileWhole: profileWholeInfo(DOCS, LFW.allowedSourceTypes, LFW.profileSources), ...extra }));
  const { evidence } = await port.retrieve({ decision });
  return { decision, evidence };
};

describe('profileWholeInfo: when the profile is handed over whole', () => {
  test('a résumé and a JD with raw text that fit: their size and count', () => {
    const info = profileWholeInfo(DOCS, LFW.allowedSourceTypes, LFW.profileSources);
    assert.equal(info.docs, 2);
    assert.equal(info.tokens, Math.ceil(RESUME_RAW.trim().length / 4) + Math.ceil(JD_RAW.trim().length / 4));
    assert.ok(info.tokens > 1200, 'larger than six passages hold');
  });
  test('a document without raw text: size unknown, nothing is handed over whole', () => {
    assert.equal(profileWholeInfo([DOCS[0], { ...DOCS[1], rawText: null }], LFW.allowedSourceTypes, LFW.profileSources), null);
    assert.equal(profileWholeInfo([{ ...DOCS[0], rawText: '   ' }], LFW.allowedSourceTypes, LFW.profileSources), null);
  });
  test('too large: the port keeps retrieving', () => {
    const big = { ...DOCS[0], rawText: 'x'.repeat(PROFILE_WHOLE_MAX_TOKENS * 4 + 8) };
    assert.equal(profileWholeInfo([big], LFW.allowedSourceTypes, LFW.profileSources), null);
    assert.equal(profileWholeInfo([{ ...DOCS[0], rawText: 'x'.repeat(PROFILE_WHOLE_MAX_TOKENS * 4) }], LFW.allowedSourceTypes, LFW.profileSources).docs, 1);
  });
  test('derived facts are not documents; a mode that does not hydrate the profile has none', () => {
    const withFact = [...DOCS, { kind: 'fact', sourceId: 'pf', versionId: 'v1', fileName: 'Salary', structured: {}, rawText: 'estimate' }];
    assert.equal(profileWholeInfo(withFact, LFW.allowedSourceTypes, LFW.profileSources).docs, 2);
    assert.equal(profileWholeInfo(DOCS, MODE_POLICIES.sales.allowedSourceTypes, MODE_POLICIES.sales.profileSources ?? []), null);
    assert.equal(profileWholeInfo([], LFW.allowedSourceTypes, LFW.profileSources), null);
  });
  test('the cap leaves room for a full reference pack under the claim pass\'s 96,000 characters', () => {
    assert.ok((WHOLE_PACK_MAX_TOKENS + PROFILE_WHOLE_MAX_TOKENS) * 4 + 10_000 <= 96_000);
  });
});

describe('the port: one whole item per planned document', () => {
  test('a fact near the end of the résumé reaches the evidence, in ONE item that is the whole document', async () => {
    const { evidence } = await ask('How often are you carrying the pager these days, and what has the incident load been like?');
    const whole = evidence.filter((e) => e.section === PROFILE_WHOLE_SECTION);
    const resume = whole.find((e) => e.sourceId === 'psrc_res');
    assert.ok(resume, 'the résumé, whole');
    assert.equal(resume.content.trim(), RESUME_RAW.trim());
    assert.match(resume.content, /Nine incidents at Sev-2 or above last year, median time to restore 41 minutes/);
    assert.equal(resume.provenance, 'PROFILE_RESUME');
    assert.equal(resume.sourceType, 'RESUME');
    assert.equal(evidence.filter((e) => /^Document text \(part/.test(e.section ?? '')).length, 0, 'no raw passages next to the whole document');
  });

  test('only PLANNED documents: a turn that does not plan the job description gets no JD', async () => {
    const { decision, evidence } = await ask('How often are you carrying the pager these days, and what has the incident load been like?');
    const planned = new Set(decision.retrievalPlan.sourceTypes);
    const jd = evidence.filter((e) => e.sourceId === 'psrc_jd');
    if (!planned.has('JOB_DESCRIPTION')) assert.equal(jd.length, 0);
    else assert.ok(jd.some((e) => e.section === PROFILE_WHOLE_SECTION && e.content.trim() === JD_RAW.trim()));
  });

  test('a question about the role gets the job description whole', async () => {
    const { decision, evidence } = await ask('How many interviews are there in the process for this role, and what does the job description require?');
    assert.ok(decision.retrievalPlan.sourceTypes.includes('JOB_DESCRIPTION'), JSON.stringify(decision.retrievalPlan.sourceTypes));
    const jd = evidence.find((e) => e.sourceId === 'psrc_jd' && e.section === PROFILE_WHOLE_SECTION);
    assert.ok(jd, 'the JD, whole');
    assert.match(jd.content, /Four interviews: recruiter screen, coding, system design, hiring manager/);
    assert.equal(jd.provenance, 'PROFILE_JOB_DESCRIPTION');
  });

  test('the complete inventory that licenses "not listed" still arrives, marked', async () => {
    const { evidence } = await ask('Do I have Kubernetes experience?');
    assert.ok(evidence.some((e) => e.metadata?.completeInventory === true), 'a complete-inventory section');
    assert.ok(evidence.some((e) => e.section === PROFILE_WHOLE_SECTION && e.sourceId === 'psrc_res'));
  });

  test('the semantic arm is not asked on a whole turn, and is asked when the profile is too large', async () => {
    let calls = 0;
    const arm = async () => { calls++; return []; };
    await ask('How often are you carrying the pager these days?', mkPort(DOCS, { rawRetriever: arm }));
    assert.equal(calls, 0);
    const bigDocs = [{ ...DOCS[0], rawText: `${RESUME_RAW}\n${filler('Padding', 400)}` }, DOCS[1]];
    assert.equal(profileWholeInfo(bigDocs, LFW.allowedSourceTypes, LFW.profileSources), null);
    const decision = decide(req('How often are you carrying the pager these days?'));
    const { evidence } = await mkPort(bigDocs, { rawRetriever: arm }).retrieve({ decision });
    assert.ok(calls >= 1, 'retrieval as before');
    assert.equal(evidence.filter((e) => e.section === PROFILE_WHOLE_SECTION).length, 0);
  });

  test('opt-out keeps today\'s passages', async () => {
    const decision = decide(req('How often are you carrying the pager these days?'));
    const { evidence } = await mkPort(DOCS, { wholeDocuments: false }).retrieve({ decision });
    assert.equal(evidence.filter((e) => e.section === PROFILE_WHOLE_SECTION).length, 0);
  });
});

describe('decide(): the plan makes room for the whole profile, on top of a whole pack', () => {
  const Q = 'How often are you carrying the pager these days, and what has the incident load been like?';
  const info = profileWholeInfo(DOCS, LFW.allowedSourceTypes, LFW.profileSources);
  test('item cap + one per document; budget + the profile\'s size', () => {
    const plain = decide(req(Q));
    const d = decide(req(Q, { profileWhole: info }));
    assert.ok(d.retrievalPlan.shouldRetrieve);
    assert.equal(d.retrievalPlan.maximumAcceptedEvidence, plain.retrievalPlan.maximumAcceptedEvidence + info.docs);
    const plainBudget = plain.retrievalPlan.evidenceTokens ?? LFW.contextBudget.evidenceTokens;
    assert.equal(d.retrievalPlan.evidenceTokens, plainBudget + info.tokens + PROFILE_WHOLE_ITEM_OVERHEAD * info.docs);
  });
  test('a whole pack and a whole profile in the same turn: both rooms, added', () => {
    const pack = { attachedSourceCount: 6, attachedCorpusTokens: 9000, attachedFileNames: ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf', 'e.pdf', 'f.pdf'] };
    const packOnly = decide(req(Q, pack));
    const both = decide(req(Q, { ...pack, profileWhole: info }));
    assert.equal(both.retrievalPlan.maximumAcceptedEvidence, packOnly.retrievalPlan.maximumAcceptedEvidence + info.docs);
    assert.equal(both.retrievalPlan.evidenceTokens, packOnly.retrievalPlan.evidenceTokens + info.tokens + PROFILE_WHOLE_ITEM_OVERHEAD * info.docs);
    assert.ok(packOnly.retrievalPlan.evidenceTokens >= 9000 + WHOLE_PACK_ITEM_OVERHEAD * 6);
  });
  test('absent, null or oversized: the plan is today\'s', () => {
    const plain = decide(req(Q));
    for (const profileWhole of [undefined, null, { tokens: PROFILE_WHOLE_MAX_TOKENS + 1, docs: 2 }, { tokens: 0, docs: 0 }]) {
      const d = decide(req(Q, { profileWhole }));
      assert.equal(d.retrievalPlan.maximumAcceptedEvidence, plain.retrievalPlan.maximumAcceptedEvidence);
      assert.equal(d.retrievalPlan.evidenceTokens, plain.retrievalPlan.evidenceTokens);
    }
  });
});

describe('wiring: both surfaces tell the plan how large the profile is', () => {
  const engine = fs.readFileSync(path.join(root, 'electron/IntelligenceEngine.ts'), 'utf8');
  const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  const bridge = fs.readFileSync(path.join(root, 'electron/context-intelligence/orchestration/engine-bridge.ts'), 'utf8');
  test('heard and typed builders compute it from the collected documents', () => {
    assert.match(engine, /profileWholeInfo\(collected\.docs, policy\.allowedSourceTypes, policy\.profileSources\)/);
    assert.match(ipc, /profileWholeInfo\(collected\.docs, policy\.allowedSourceTypes, policy\.profileSources\)/);
  });
  test('every bridge call that passes the pack\'s size passes the profile\'s', () => {
    const pack = (engine.match(/attachedCorpusTokens: (?:_ctx|ctx)\.attachedCorpusTokens/g) ?? []).length;
    const prof = (engine.match(/profileWhole: (?:_ctx|ctx)\.profileWhole/g) ?? []).length;
    assert.ok(pack >= 3 && prof === pack, `${prof} of ${pack}`);
    assert.match(ipc, /profileWhole: v3ProfileWhole/);
    assert.match(bridge, /profileWhole: input\.profileWhole \?\? null/);
  });
});
