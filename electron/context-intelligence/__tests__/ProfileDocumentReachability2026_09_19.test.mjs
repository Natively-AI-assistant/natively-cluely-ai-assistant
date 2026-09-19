// Profile Intelligence reachability (2026-09-19, retrieval-scale campaign).
// Measured with experiments/retrieval-scale/run-profile.mjs — the REAL profile
// port + orchestrator + packer over a generated résumé and job description, as
// profile documents with NO file attached to the mode: the chunk that answers
// reached the prompt for 29–32% of questions (the same documents attached to a
// MODE: ~90%). Two causes, both pinned here:
//
//   1. A document lookup (DOCUMENT_FACT) retrieves from reference-file pools
//      only — a deliberate narrowing that stops a value lookup being flooded by
//      résumé chunks. With no reference file it searches NOTHING, and the job
//      description was planned only when the question said "role", "position"
//      or "interview": 37 of 45 job-description questions could not reach it.
//   2. The port's lossless raw text was bare ~110-word windows with no heading:
//      "Worked with 7 engineers under …" never said WHICH project.
//
// After: 85–86% (markdown text), 74–86% (plain text, as a PDF extracts).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.NATIVELY_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-profile-reach-'));
const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);
const { decide, orchestrate } = await load('orchestration/orchestrator.js');
const { buildV3Prompt } = await load('orchestration/engine-bridge.js');
const { createProfileRetrievalPort } = await load('retrieval/profile-retrieval-port.js');
const { resolveModePolicy } = await load('policies/mode-policy-registry.js');
const { CONTEXT_INTELLIGENCE_V3_ENV_KEY } = await load('contracts/flag.js');

const MODE = 'looking-for-work';
const req = (q, extra = {}) => ({ requestId: 'r', requestSequence: 1, surface: 'manual_chat', modeId: MODE, scope: { userId: 'u' }, sessionId: `s-${q.length}-${Math.random()}`, manualQuestion: q, hasAttachedDocuments: true, ...extra });
// A job-description question with none of the classifier's JD trigger words.
const JD_Q = 'How much relocation does the company cover?';

describe('the identity-pool narrowing, and the two ways a turn gets past it', () => {
  test('default: a document lookup does not plan the job description (the narrowing stands)', () => {
    const d = decide(req(JD_Q));
    assert.ok(d.retrievalPlan.shouldRetrieve);
    assert.ok(!d.retrievalPlan.sourceTypes.includes('JOB_DESCRIPTION'), d.retrievalPlan.sourceTypes.join(','));
  });
  test('profile-only turn: the résumé and job description ARE the documents, so the lookup looks in them', () => {
    const d = decide(req(JD_Q, { profileOnlyDocuments: true }));
    assert.ok(d.retrievalPlan.sourceTypes.includes('JOB_DESCRIPTION'), d.retrievalPlan.sourceTypes.join(','));
    assert.ok(d.retrievalPlan.sourceTypes.includes('RESUME'));
  });
  test('NOT inferred from a missing attachedFileNames — callers omit it while files are attached', () => {
    // The first cut inferred "profile-only" from this and broke the narrowing
    // for mode attachments (ModeAttachmentAdmission2026_09_07 caught it).
    const d = decide(req('What is the worker batch size?', { modeId: 'technical-interview', attachedFileNames: undefined }));
    assert.ok(!d.retrievalPlan.sourceTypes.includes('RESUME'), d.retrievalPlan.sourceTypes.join(','));
  });
  test('anchored source: only the named pool re-enters, and only one DOCUMENT_FACT has authority over', () => {
    const d = decide(req(JD_Q, { anchoredSourceTypes: ['JOB_DESCRIPTION', 'MEETING_TRANSCRIPT'] }));
    assert.ok(d.retrievalPlan.sourceTypes.includes('JOB_DESCRIPTION'));
    assert.ok(!d.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), d.retrievalPlan.sourceTypes.join(','));
  });
  test('a mode that does not authorize the job description never plans it', () => {
    const d = decide(req(JD_Q, { modeId: 'sales', profileOnlyDocuments: true }));
    assert.ok(!d.retrievalPlan.sourceTypes.includes('JOB_DESCRIPTION'), d.retrievalPlan.sourceTypes.join(','));
  });
});

describe('engine bridge: profile-only is computed from the two source counts', () => {
  before(() => { process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY] = '1'; });
  after(() => { delete process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY]; });
  const plannedWith = async (counts) => {
    let planned = null;
    await buildV3Prompt({
      surface: 'manual-chat', question: JD_Q, modeTemplateType: MODE, modeUniqueId: MODE, ...counts,
      attachedFileNames: counts.attachedSourceCount ? ['handbook.pdf'] : [],
      retrieval: { async retrieve({ decision }) { planned = decision.retrievalPlan.sourceTypes; return { evidence: [], attempts: [] }; } },
      scope: { sessionId: `pr-${counts.attachedSourceCount}-${counts.profileSourceCount}` },
    });
    return planned;
  };
  test('no mode file + profile documents → the job description is planned', async () => {
    const planned = await plannedWith({ attachedSourceCount: 0, profileSourceCount: 2 });
    assert.ok(planned?.includes('JOB_DESCRIPTION'), String(planned));
  });
  test('a mode file attached → the narrowing protects it, exactly as before', async () => {
    const planned = await plannedWith({ attachedSourceCount: 1, profileSourceCount: 2 });
    assert.ok(planned && !planned.includes('JOB_DESCRIPTION'), String(planned));
  });
});

// A résumé whose projects share every sub-heading, and a job description.
// Each project carries ~170 words of bullets BETWEEN its heading and its Team
// line — more than the old 110-word raw window — so a window that holds the
// team line cannot also hold the project's name. (The first version of this
// fixture used ~70-word sections; the old windows happened to keep heading and
// team line together, and the test passed against the code it was meant to
// fail. Caught by running it against the committed port.)
const BULLETS = [
  'Rebuilt the ingestion pipeline end to end, replacing synchronous ledger writes with an outbox and improving p99 latency by',
  'Automated the audit trail export for the compliance group, removing a weekly manual reconciliation and improving build time by',
  'Sharded the search indexer across three availability zones after a three-week shadow-traffic trial, improving throughput by',
  'Hardened the partner API gateway against retry storms with tenant-aware token buckets, reducing on-call pages per week by',
  'Consolidated four notification fan-out services into one durable workflow with checkpointed jobs, cutting storage cost by',
  'Instrumented the fraud-scoring service with structured tracing and handed ownership to the platform group, improving mean time to recovery by',
  'Decommissioned the legacy report scheduler while keeping the old path as a fallback for two quarters, improving deploy frequency by',
];
const RESUME = ['# Maya Okonkwo-Reyes', '', '## Experience', '',
  ...Array.from({ length: 24 }, (_, i) => [`### Project Wicket-${100 + i} — Oakhaven Mutual (20${10 + (i % 9)}–20${11 + (i % 9)})`, '', '**Highlights**', '',
    ...BULLETS.map((b, k) => `- ${b} ${20 + i + k}% with zero customer-facing downtime and a documented rollout for other squads.`), '', '**Team**', '',
    `Worked with ${3 + (i % 7)} engineers under ${['Greta Kovalenko', 'Otto Szabo', 'Priya Mbeki', 'Ilse Eklund', 'Hamid Novak'][i % 5]}${i === 7 ? ' and Dagmar Thackeray' : ''}; partnered with the Risk Engineering group.`, ''].join('\n'))].join('\n');
const JD = ['# Job description — Principal Engineer', '', '## About the role', '', 'Helix Meridian runs clearing and settlement for European marketplaces.', '',
  ...Array.from({ length: 12 }, (_, i) => `### Team profile: pod ${i}\n\nThe pod owns the billing reconciler. It is led by someone and currently has ${4 + i} engineers.\n`),
  '### Immigration', '', 'We sponsor Dutch highly-skilled-migrant visas and cover relocation up to €12,000.', ''].join('\n');
const docs = [
  { kind: 'resume', sourceId: 'p-resume', versionId: 'v1', fileName: 'resume.md', structured: null, rawText: RESUME },
  { kind: 'jd', sourceId: 'p-jd', versionId: 'v1', fileName: 'jd.md', structured: null, rawText: JD },
];
const policy = resolveModePolicy(MODE);
const port = () => createProfileRetrievalPort({ docs, allowedSourceTypes: policy.allowedSourceTypes, profileSources: policy.profileSources, userId: 'u' });

describe('profile port, end to end over the raw text alone', () => {
  test('a job-description fact is reachable for a question with no JD trigger word', async () => {
    const r = await orchestrate(req(JD_Q, { profileOnlyDocuments: true }), port());
    assert.ok(r.evidence.some((e) => /12,000/.test(e.content)), r.evidence.map((e) => e.content.slice(0, 50)).join(' | '));
    // Control: the same port, the same question, WITHOUT the profile-only
    // signal and with the probe withheld — the narrowing drops the fact. This
    // is the measured failure, and what makes the assertion above mean something.
    const { probeAnchors: _a, probeAnchorSources: _b, ...bare } = port();
    const before = await orchestrate(req(JD_Q), bare);
    assert.ok(!before.evidence.some((e) => /12,000/.test(e.content)), 'expected the narrowing to hide the JD fact without the fix');
  });
  test('raw chunks carry their heading: the project NAME and the team line arrive together', async () => {
    const r = await orchestrate(req('Who did you work under on Project Wicket-107?', { profileOnlyDocuments: true }), port());
    const hit = r.evidence.find((e) => /Dagmar Thackeray/.test(e.content));
    assert.ok(hit, r.evidence.map((e) => e.content.slice(0, 60)).join(' | '));
    assert.match(hit.content, /Wicket-107/, 'the chunk that holds the answer must also say which project it is');
  });
  test('source-aware probe: names the job description for a JD question, the résumé for a résumé one', () => {
    const p = port();
    assert.deepEqual(p.probeAnchorSources('We sponsor visas and cover relocation — how much?'), ['JOB_DESCRIPTION']);
    assert.deepEqual(p.probeAnchorSources('Tell me about Project Wicket-107 at Oakhaven Mutual'), ['RESUME']);
    assert.deepEqual(p.probeAnchorSources('What is the difference between TCP and UDP?'), []);
  });
});

describe('a fired intent\'s vocabulary reaches the raw text', () => {
  // Measured LIVE (natively stack, real ingest of a 15k-token JD): "How much does
  // the position pay?" was answered "158 to 183 thousand euro" — the app's own
  // derived salary ESTIMATE — while the JD says $214,000–$262,000. The intent
  // boost went to the structured compensation section (empty: structuring was
  // lossy) and the estimate; BM25 cannot match "pay" to "salary".
  const BIG_JD = ['# Job description — Principal Engineer', '', '## About the role', '', 'Helix Meridian runs clearing and settlement for European marketplaces.', '',
    ...Array.from({ length: 40 }, (_, i) => `### Team profile: pod ${i}\n\nThe pod owns the billing reconciler and the position of record for ledger ${i}. It is led by someone and currently has ${4 + (i % 9)} engineers working on the position feed.\n`),
    '### Compensation', '', 'Base salary range for this role is $214,000–$262,000, reviewed every January.', ''].join('\n');
  const jdPort = () => createProfileRetrievalPort({ docs: [{ kind: 'jd', sourceId: 'p-jd', versionId: 'v1', fileName: 'jd.md', structured: null, rawText: BIG_JD }], allowedSourceTypes: policy.allowedSourceTypes, profileSources: policy.profileSources, userId: 'u' });
  test('"How much does the position pay?" reaches the stated salary range', async () => {
    const r = await orchestrate(req('How much does the position pay?', { profileOnlyDocuments: true }), jdPort());
    assert.ok(r.evidence.some((e) => /214,000/.test(e.content)), r.evidence.map((e) => e.content.slice(0, 60)).join(' | '));
  });
  test('a class that matches most of the raw text does not discriminate, and boosts nothing', async () => {
    // "position" is in every pod section here AND in the experience/role intent class.
    const r = await orchestrate(req('Tell me about the position and the company', { profileOnlyDocuments: true }), jdPort());
    assert.ok(r.evidence.length > 0);
    assert.ok(r.evidence.every((e) => (e.finalScore ?? 0) <= 1));
  });
});
