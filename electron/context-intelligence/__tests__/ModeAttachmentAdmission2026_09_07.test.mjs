// A file the user attached to the MODE must be reachable for a document-fact
// question, whatever shape the port typed it as (2026-09-07).
//
// THE DEFECT, measured in the user's own General mode (a résumé PDF and a JD
// PDF attached, nothing else): "What latency did the FastAPI backend handle
// chatbot requests at?" — the fact sits in the résumé — traced as
//   intent DOCUMENT_FACT, planned [REFERENCE_FILE], candidates 1, admitted 1,
//   evidence 0, answerability NONE, fallback DOCUMENT_FACT_NOT_FOUND
// and the user was told "the records don't mention a specific latency
// metric". The same fact surfaced verbatim one turn later for "Tell me about
// your experience at EstroTech" (PERSONAL_SKILL plans CANDIDATE_FILE).
//
// The chain: attachmentSourceTypeExtensions types a résumé-shaped attachment
// CANDIDATE_FILE (JD → JOB_DESCRIPTION); DOCUMENT_FACT deliberately narrows
// retrieval to the document pools (REFERENCE_FILE/PROJECT_FILE/CODING_SAMPLE)
// so a value lookup does not fan out to the profile résumé/JD pools; the
// legacy port then dropped the mode's OWN attachment as PLANNED_TYPE_FILTER.
//
// The narrowing is about identity POOLS (Profile Intelligence), which the mode
// port never reads. Every chunk the mode port returns is a file the user put
// in this mode — its provenance says so — and for a plan that consults the
// document pools it is admissible regardless of the identity type the shape
// detector stamped on it. Claim authority still applies afterwards.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);

const { decide } = await load('orchestration/orchestrator.js');
const { createLegacyRetrievalPort } = await load('retrieval/legacy-retrieval-port.js');
const { attachmentSourceTypeExtensions, sourceTypeForFile } = await load('retrieval/mode-retrieval-port.js');
const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');

const RESUME = [
  'Evin John — Software Engineer',
  '## Summary',
  'AI and full-stack engineer. Portfolio: evinjohn.dev',
  '## Experience',
  'AI & Full Stack Engineer Intern, EstroTech Robotics, Jun 2025 – Aug 2025',
  '◦ Architected a high-performance backend (Python/FastAPI) to handle concurrent chatbot requests with sub-100ms latency.',
  '## Education',
  'B.Tech Computer Science',
].join('\n');
const JD = [
  'Data Analyst — Job Description',
  'About the role: we are looking for a detail-oriented Data Analyst.',
  '## Responsibilities',
  'Data Quality Assurance',
  '• Validate data accuracy, completeness, and integrity.',
  'Minimum qualifications',
  '• 3+ years of experience with SQL.',
].join('\n');

const registryFor = (files, allowed) => {
  const sourceTypes = new Map();
  const activeVersions = new Map();
  const chunkVersions = new Map();
  const sourceScopes = new Map();
  for (const f of files) {
    sourceTypes.set(f.id, sourceTypeForFile(f.fileName, f.content, allowed));
    activeVersions.set(f.id, 'legacy');
    chunkVersions.set(f.id, 'legacy');
    sourceScopes.set(f.id, { userId: 'u' });
  }
  return { sourceTypes, activeVersions, chunkVersions, sourceScopes };
};

const decisionFor = (question, modeId, extraAllowedSourceTypes) => decide({
  requestId: 'r', requestSequence: 1, surface: 'manual_chat', modeId,
  scope: { userId: 'u', modeId }, sessionId: 's',
  manualQuestion: question,
  hasAttachedDocuments: true,
  extraAllowedSourceTypes,
});

describe('a mode attachment is admissible for a document-fact plan whatever its typed shape', () => {
  const files = [
    { id: 'resume', fileName: 'evin-resume-2025.pdf', content: RESUME },
    { id: 'jd', fileName: 'job-description-data-analyst.pdf', content: JD },
  ];

  test('general mode: the attached résumé answers a value lookup about its own content', async () => {
    const extra = attachmentSourceTypeExtensions('general', files);
    const allowed = [...MODE_POLICIES.general.allowedSourceTypes, ...extra];
    const registry = registryFor(files, allowed);
    // Precondition: the shape detector typed the attachment as an identity file.
    assert.equal(registry.sourceTypes.get('resume'), 'CANDIDATE_FILE');
    assert.equal(registry.sourceTypes.get('jd'), 'JOB_DESCRIPTION');

    const d = decisionFor('What latency did the FastAPI backend handle chatbot requests at?', 'general', extra);
    assert.ok(d.questionTypes.includes('DOCUMENT_FACT'), JSON.stringify(d.questionTypes));
    assert.ok(d.retrievalPlan.sourceTypes.includes('REFERENCE_FILE'), JSON.stringify(d.retrievalPlan.sourceTypes));

    const chunks = [{
      sourceId: 'resume', fileName: files[0].fileName, chunkIndex: 0, score: 0.91,
      text: 'Architected a high-performance backend (Python/FastAPI) to handle concurrent chatbot requests with sub-100ms latency.',
      provenance: 'MODE_REFERENCE_FILE',
    }];
    const port = createLegacyRetrievalPort({
      registry, retrieve: async () => chunks,
      assumeCurrentWhenVersionUnknown: true, assumeInScopeWhenUnknown: true,
    });
    const { evidence, attempts } = await port.retrieve({ decision: d });
    assert.equal(evidence.length, 1, `attachment dropped: ${JSON.stringify(attempts[0]?.rejections)}`);
    assert.match(evidence[0].content, /sub-100ms/);
  });

  test('general mode: the attached JD answers a document-fact question about the role', async () => {
    const extra = attachmentSourceTypeExtensions('general', files);
    const allowed = [...MODE_POLICIES.general.allowedSourceTypes, ...extra];
    const registry = registryFor(files, allowed);
    const d = decisionFor('What are the responsibilities under Data Quality Assurance in the job description?', 'general', extra);
    const chunks = [{
      sourceId: 'jd', fileName: files[1].fileName, chunkIndex: 0, score: 0.88,
      text: 'Data Quality Assurance\n• Validate data accuracy, completeness, and integrity.',
      provenance: 'MODE_REFERENCE_FILE',
    }];
    const port = createLegacyRetrievalPort({
      registry, retrieve: async () => chunks,
      assumeCurrentWhenVersionUnknown: true, assumeInScopeWhenUnknown: true,
    });
    const { evidence, attempts } = await port.retrieve({ decision: d });
    assert.equal(evidence.length, 1, `attachment dropped: ${JSON.stringify(attempts[0]?.rejections)}`);
  });

  test('technical-interview: a résumé attached to the mode (typed RESUME) is reachable for a pure value lookup', async () => {
    const allowed = MODE_POLICIES['technical-interview'].allowedSourceTypes;
    const registry = registryFor(files, allowed);
    assert.equal(registry.sourceTypes.get('resume'), 'RESUME');
    // The phrasing the narrowing test pins (RemainingDefects issue 5): a pure
    // value lookup whose PLAN excludes the identity pools.
    const d = decisionFor('What is the worker batch size?', 'technical-interview');
    assert.ok(!d.retrievalPlan.sourceTypes.includes('RESUME'), JSON.stringify(d.retrievalPlan.sourceTypes));
    const chunks = [{
      sourceId: 'resume', fileName: files[0].fileName, chunkIndex: 0, score: 0.91,
      text: 'Projects — QueueForge: tuned WORKER_BATCH_SIZE 64 for the ingest workers.',
      provenance: 'MODE_REFERENCE_FILE',
    }];
    const port = createLegacyRetrievalPort({
      registry, retrieve: async () => chunks,
      assumeCurrentWhenVersionUnknown: true, assumeInScopeWhenUnknown: true,
    });
    const { evidence } = await port.retrieve({ decision: d });
    assert.equal(evidence.length, 1, 'mode attachment must not be dropped by the planned-type filter');
  });
});

describe('the identity-pool narrowing is unchanged for evidence that is NOT a mode attachment', () => {
  test('a profile-pool résumé chunk (no mode provenance) is still excluded from a value lookup', async () => {
    const registry = {
      sourceTypes: new Map([['res', 'RESUME'], ['proj', 'PROJECT_FILE']]),
      activeVersions: new Map([['res', 'v1'], ['proj', 'v1']]),
      chunkVersions: new Map([['res', 'v1'], ['proj', 'v1']]),
      sourceScopes: new Map([['res', { userId: 'u' }], ['proj', { userId: 'u' }]]),
    };
    const chunks = [
      { sourceId: 'res', text: 'resume chunk: WORKER_BATCH_SIZE mentioned in passing', chunkIndex: 0, score: 0.95 },
      { sourceId: 'proj', text: 'QueueForge config: WORKER_BATCH_SIZE 64', chunkIndex: 0, score: 0.4 },
    ];
    const port = createLegacyRetrievalPort({ registry, retrieve: async () => chunks });
    const d = decisionFor('What is the worker batch size?', 'technical-interview');
    const { evidence } = await port.retrieve({ decision: d });
    assert.ok(evidence.every((e) => e.sourceType !== 'RESUME'), evidence.map((e) => e.sourceType).join(','));
    assert.ok(evidence.some((e) => e.sourceType === 'PROJECT_FILE'));
  });

  test('a mode attachment still cannot evidence a claim its type has no authority for', async () => {
    // JD chunk, question purely about the user's own employment: JOB_DESCRIPTION
    // is prohibited for USER_EMPLOYMENT. Provenance admission never bypasses
    // claim authority — it only relaxes the planned-type gate.
    const files = [{ id: 'jd', fileName: 'backend-job-description.md', content: JD }];
    const allowed = MODE_POLICIES['looking-for-work'].allowedSourceTypes;
    const registry = registryFor(files, allowed);
    assert.equal(registry.sourceTypes.get('jd'), 'JOB_DESCRIPTION');
    const d = decisionFor('Tell me about your experience at Wilson & Kinsman.', 'looking-for-work');
    assert.ok(d.claimRequirements.every((c) => c.claimType.startsWith('USER_')), JSON.stringify(d.claimRequirements.map((c) => c.claimType)));
    const chunks = [{ sourceId: 'jd', text: 'Requirements: Production Kafka and PostgreSQL. Wilson & Kinsman is a preferred employer.', chunkIndex: 0, score: 0.9, provenance: 'MODE_REFERENCE_FILE' }];
    const port = createLegacyRetrievalPort({ registry, retrieve: async () => chunks, assumeCurrentWhenVersionUnknown: true, assumeInScopeWhenUnknown: true });
    const { evidence } = await port.retrieve({ decision: d });
    assert.equal(evidence.length, 0, 'a JD must not evidence a user-employment claim');
  });
});
