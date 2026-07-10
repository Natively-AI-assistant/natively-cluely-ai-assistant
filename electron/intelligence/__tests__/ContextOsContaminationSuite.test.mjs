// Context OS Phase 14 — full contamination eval suite.
//
// Assertions inspect TRACES (contract + evidence pack + used sources), never
// natural-language output. The matrix covers:
//   • modes: document seminar, interview/profile, meeting, sales, lecture, general
//   • ambiguous terms: project, system, model, dataset, method, phase, stage,
//     result, experiment, hardware, software, company, role, experience,
//     current, latest, this, that, it
//   • forbidden-source non-retrieval, property mismatch, prior-assistant and
//     Hindsight isolation, JD≠resume, prompt-render leakage.
//
// Run with: npm run build:electron && node --test electron/intelligence/__tests__/ContextOsContaminationSuite.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  SENTINELS,
  DOC_SNIPPET_BLOCK,
  kernelInputFor,
  trackedRetrievers,
} from '../context-os/__tests__/fixtures/contamination.fixtures.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));

const kernel = new co.SourceAuthorityKernel();
const orchestrator = new co.EvidenceOrchestrator();

async function runTurn(mode, question) {
  const contract = kernel.build(kernelInputFor(mode, question));
  const calls = new Set();
  const pack = contract.sourceOwner === 'clarify'
    ? await orchestrator.buildEvidencePack({ question, contract, retrievers: trackedRetrievers(calls) })
    : await orchestrator.buildEvidencePack({ question, contract, retrievers: trackedRetrievers(calls) });
  const trace = co.buildContextOsTrace({
    contract,
    sourceAuthority: kernelInputFor(mode, question).sourceAuthority,
    question,
    evidencePack: pack,
    finalAction: pack.answerPolicy === 'ask_clarification' ? 'clarify'
      : pack.answerPolicy === 'refuse_insufficient_evidence' ? 'refuse_insufficient_evidence'
      : 'answer',
  });
  return { contract, pack, trace, calls };
}

// ═════════════════════════════ MATRIX ══════════════════════════════════════
// Each case: mode, question, expected trace fields, forbidden sources that
// must appear in neither usedSources nor the retriever call set.

const MATRIX = [
  // ── document-grounded seminar mode ────────────────────────────────────────
  {
    name: 'doc seminar: four phases of the project → reference_files, phase_or_stage',
    mode: 'document_grounded_seminar',
    question: 'What are the four phases of the project?',
    expectOwner: 'reference_files',
    expectProperty: 'phase_or_stage',
    expectAction: 'answer',
    forbidden: ['profile_resume', 'profile_project', 'profile_jd', 'hindsight_memory', 'prior_assistant_claim'],
    forbiddenRetrievers: ['profile', 'hindsight'],
  },
  {
    name: 'doc seminar: what hardware does the system use → reference_files, hardware',
    mode: 'document_grounded_seminar',
    question: 'What hardware does the system use?',
    expectOwner: 'reference_files',
    expectProperty: 'hardware_component',
    expectAction: 'answer',
    forbiddenRetrievers: ['profile', 'hindsight'],
  },
  {
    name: 'doc seminar: who funded this research → collaboration is NOT funding → refuse',
    mode: 'document_grounded_seminar',
    question: 'Who funded this research?',
    expectOwner: 'reference_files',
    expectProperty: 'funding_source',
    expectAction: 'refuse_insufficient_evidence',
    expectPropertySatisfied: false,
    forbiddenRetrievers: ['profile', 'hindsight'],
  },
  {
    name: 'doc seminar: what dataset was used → dataset evidence present → answer',
    mode: 'document_grounded_seminar',
    question: 'What dataset was used?',
    expectOwner: 'reference_files',
    expectProperty: 'dataset_size',
    expectAction: 'answer',
  },
  {
    name: 'doc seminar: what were the results → result metric present → answer',
    mode: 'document_grounded_seminar',
    question: 'What were the results?',
    expectOwner: 'reference_files',
    expectProperty: 'result_metric',
    expectAction: 'answer',
  },
  {
    name: 'doc seminar: what method did they use → reference_files owner',
    mode: 'document_grounded_seminar',
    question: 'What method did they use for grasping?',
    expectOwner: 'reference_files',
    forbiddenRetrievers: ['profile', 'hindsight'],
  },
  {
    name: 'doc seminar: what was the experiment → reference_files owner',
    mode: 'document_grounded_seminar',
    question: 'Describe the experiment they ran.',
    expectOwner: 'reference_files',
    forbiddenRetrievers: ['profile', 'hindsight'],
  },
  {
    name: 'doc seminar: which company collaborated → reference_files owner (not candidate employer)',
    mode: 'document_grounded_seminar',
    question: 'Which company did they collaborate with?',
    expectOwner: 'reference_files',
    forbiddenRetrievers: ['profile'],
  },
  {
    name: 'doc seminar: what stage is the pipeline in → phase_or_stage',
    mode: 'document_grounded_seminar',
    question: 'What stage of the pipeline handles perception?',
    expectOwner: 'reference_files',
    expectProperty: 'phase_or_stage',
  },
  {
    name: 'doc seminar: what software stack → software_stack',
    mode: 'document_grounded_seminar',
    question: 'What software frameworks did they use?',
    expectOwner: 'reference_files',
    expectProperty: 'software_stack',
  },
  {
    name: 'doc seminar: explicit "my resume" ask → clarify, profile still not retrieved',
    mode: 'document_grounded_seminar',
    question: 'What does my resume say about the project?',
    kernelOverrides: { userExplicitSource: 'profile' },
    expectOwner: 'clarify',
    expectAction: 'clarify',
    forbiddenRetrievers: ['profile', 'mode', 'hindsight', 'transcript'],
  },

  // ── interview/profile mode ───────────────────────────────────────────────
  {
    name: 'interview: what is my best project → profile, candidate_project',
    mode: 'interview',
    question: 'What is my best project?',
    expectOwner: 'profile',
    expectProperty: 'candidate_project',
    expectAction: 'answer',
    forbidden: ['mode_reference_file', 'mode_reference_chunk', 'okf_document_card', 'hindsight_memory'],
    forbiddenRetrievers: ['mode', 'hindsight', 'meeting_rag'],
  },
  {
    name: 'interview: what are my strongest skills → profile, candidate_experience',
    mode: 'interview',
    question: 'What are my strongest skills?',
    expectOwner: 'profile',
    expectProperty: 'candidate_experience',
    forbiddenRetrievers: ['mode'],
  },
  {
    name: 'interview: why am I fit for this role → profile owner',
    mode: 'interview',
    question: 'Why am I a good fit for this role?',
    expectOwner: 'profile',
    expectProperty: 'candidate_experience',
    forbiddenRetrievers: ['mode'],
  },
  {
    name: 'interview: what is my current status → profile, candidate_identity',
    mode: 'interview',
    question: 'What is my current status?',
    expectOwner: 'profile',
    expectProperty: 'candidate_identity',
    forbiddenRetrievers: ['mode'],
  },
  {
    name: 'interview: my experience with ROS → profile owner (uploaded thesis must not answer)',
    mode: 'interview',
    question: 'What is my experience with ROS?',
    expectOwner: 'profile',
    expectProperty: 'candidate_experience',
    forbidden: ['mode_reference_file', 'mode_reference_chunk'],
    forbiddenRetrievers: ['mode'],
  },

  // ── meeting mode ─────────────────────────────────────────────────────────
  {
    name: 'meeting: what did they say about the deadline → transcript owner',
    mode: 'meeting',
    question: 'What did they say about the deadline?',
    expectOwner: 'transcript',
    expectAction: 'answer',
    forbidden: ['profile_resume', 'mode_reference_file', 'hindsight_memory'],
    forbiddenRetrievers: ['profile', 'mode', 'hindsight'],
  },
  {
    name: 'meeting: what project are we discussing → transcript owner (not resume, not thesis)',
    mode: 'meeting',
    question: 'What project are we discussing?',
    expectOwner: 'transcript',
    forbiddenRetrievers: ['profile', 'mode'],
  },
  {
    name: 'meeting: what was the decision → transcript owner',
    mode: 'meeting',
    question: 'What was the decision?',
    expectOwner: 'transcript',
    forbiddenRetrievers: ['profile', 'mode', 'hindsight'],
  },

  // ── sales mode (reference_files_plus_transcript) ─────────────────────────
  {
    name: 'sales: product spec question → reference_files owner, profile forbidden',
    mode: 'sales',
    question: 'What are the phases of the rollout plan?',
    expectOwner: 'reference_files',
    forbidden: ['profile_resume', 'profile_jd'],
    forbiddenRetrievers: ['profile', 'hindsight'],
  },

  // ── lecture mode ─────────────────────────────────────────────────────────
  {
    name: 'lecture: definition question → reference_files owner',
    mode: 'lecture',
    question: 'What model architecture does the paper define?',
    expectOwner: 'reference_files',
    forbiddenRetrievers: ['profile', 'hindsight', 'meeting_rag'],
  },

  // ── general mode: ambiguous terms → clarify ──────────────────────────────
  ...[
    'What are the project phases?',
    'What model is used?',
    'What is the current result?',
    'What dataset does the system rely on?',
    'What was the latest experiment?',
    'Which company is involved?',
    'What is the role here?',
    'Tell me about the experience.',
    'What about that hardware?',
    'Explain this method.',
    'What software does the system run?',
  ].map((q) => ({
    name: `general ambiguous → clarify: "${q}"`,
    mode: 'general',
    question: q,
    expectOwner: 'clarify',
    expectAction: 'clarify',
    forbiddenRetrievers: ['profile', 'mode', 'hindsight', 'transcript', 'meeting_rag'],
  })),
];

for (const c of MATRIX) {
  test(c.name, async () => {
    const input = { ...kernelInputFor(c.mode, c.question), ...(c.kernelOverrides || {}) };
    const contract = kernel.build(input);
    const calls = new Set();
    const pack = await orchestrator.buildEvidencePack({ question: c.question, contract, retrievers: trackedRetrievers(calls) });
    const trace = co.buildContextOsTrace({
      contract, sourceAuthority: input.sourceAuthority, question: c.question, evidencePack: pack,
      finalAction: pack.answerPolicy === 'ask_clarification' ? 'clarify'
        : pack.answerPolicy === 'refuse_insufficient_evidence' ? 'refuse_insufficient_evidence'
        : 'answer',
    });

    if (c.expectOwner) assert.equal(trace.sourceOwner, c.expectOwner, `sourceOwner: ${JSON.stringify(trace)}`);
    if (c.expectProperty) assert.equal(trace.requestedProperty, c.expectProperty, 'requestedProperty');
    if (c.expectAction) assert.equal(trace.finalAction, c.expectAction, 'finalAction');
    if (c.expectPropertySatisfied !== undefined) {
      assert.equal(trace.evidenceCoverage.propertySatisfied, c.expectPropertySatisfied, 'propertySatisfied');
    }
    for (const f of c.forbidden ?? []) {
      assert.ok(!trace.usedSources.includes(f), `forbidden source used: ${f}`);
      assert.ok(trace.forbiddenSources.includes(f), `${f} missing from forbidden list`);
    }
    for (const r of c.forbiddenRetrievers ?? []) {
      assert.ok(!calls.has(r), `forbidden retriever invoked: ${r}`);
    }
    // Trace-level invariant: factual coverage requires owner satisfaction.
    if (trace.finalAction === 'answer') {
      assert.equal(trace.evidenceCoverage.sourceOwnerSatisfied, true, 'answered with wrong-owner evidence');
    }
  });
}

// ═════════════════ Cross-cutting contamination scenarios ═══════════════════

test('SCENARIO E: prior assistant "ESP32" claim cannot override current Jetson evidence', async () => {
  const contract = kernel.build(kernelInputFor('document_grounded_seminar', 'What controller does the system use?'));
  assert.equal(contract.requestedProperty, 'processor_or_controller');
  assert.ok(contract.forbiddenSources.includes('prior_assistant_claim'));
  const calls = new Set();
  const pack = await orchestrator.buildEvidencePack({
    question: 'What controller does the system use?',
    contract,
    retrievers: trackedRetrievers(calls),
  });
  // Document evidence wins: property satisfied by the Jetson snippet.
  assert.equal(pack.coverage.propertySatisfied, true);
  assert.ok(!JSON.stringify(pack.items).includes(SENTINELS.PRIOR_ASSISTANT));
  // And the claim layer marks the prior claim contradicted by the doc.
  assert.equal(co.claimContradictedByEvidence({ claimText: 'The project uses ESP32.' }, pack), true);
});

test('PROMPT RENDER: doc-grounded prompt prefix contains ZERO profile/hindsight sentinels', async () => {
  const contract = kernel.build(kernelInputFor('document_grounded_seminar', 'What are the four phases of the project?'));
  const calls = new Set();
  const pack = await orchestrator.buildEvidencePack({
    question: 'What are the four phases of the project?',
    contract,
    retrievers: trackedRetrievers(calls),
  });
  const prompt = co.renderContextOsPromptPrefix(contract, pack);
  assert.ok(prompt.includes(SENTINELS.DOCUMENT), 'document evidence must be present');
  for (const s of [SENTINELS.PROFILE, SENTINELS.HINDSIGHT, SENTINELS.PRIOR_ASSISTANT, SENTINELS.JD]) {
    assert.ok(!prompt.includes(s), `sentinel leaked into prompt: ${s}`);
  }
});

test('PROMPT RENDER: interview prompt contains profile but ZERO document sentinels', async () => {
  const contract = kernel.build(kernelInputFor('interview', 'What is my best project?'));
  const calls = new Set();
  const pack = await orchestrator.buildEvidencePack({
    question: 'What is my best project?',
    contract,
    retrievers: trackedRetrievers(calls),
  });
  const prompt = co.renderContextOsPromptPrefix(contract, pack);
  assert.ok(prompt.includes(SENTINELS.PROFILE), 'profile evidence must be present');
  assert.ok(!prompt.includes(SENTINELS.DOCUMENT), 'document sentinel leaked into interview prompt');
  assert.ok(!prompt.includes(SENTINELS.HINDSIGHT));
});

test('TRANSCRIPT in doc-grounded prompt appears ONLY inside referent_context', async () => {
  const contract = kernel.build(kernelInputFor('document_grounded_seminar', 'What are the phases they asked about?'));
  const calls = new Set();
  const pack = await orchestrator.buildEvidencePack({
    question: 'What are the phases they asked about?',
    contract,
    retrievers: trackedRetrievers(calls),
  });
  const xml = co.renderEvidencePackForPrompt(pack);
  const idx = xml.indexOf(SENTINELS.TRANSCRIPT);
  if (idx !== -1) {
    const refStart = xml.indexOf('<referent_context');
    const refEnd = xml.indexOf('</referent_context>');
    assert.ok(refStart !== -1 && idx > refStart && idx < refEnd, 'transcript sentinel outside referent_context');
  }
});

test('JD REQUIREMENT cannot become a candidate fact (validator matrix)', () => {
  const jdItem = {
    evidenceId: 'jd1', sourceKind: 'profile_jd', sourceId: 'jd', sourceOwner: 'profile',
    authority: 'evidence', trustLevel: 'profile_verified',
    text: `${SENTINELS.JD}: the role requires 5 years of Kubernetes experience.`,
    supports: { property: 'role_requirement' }, score: { final: 0.9 }, reasonIncluded: 'test',
  };
  const pack = {
    turnId: 't', sourceOwner: 'profile', requestedProperty: 'candidate_experience',
    items: [jdItem], rejected: [], conflicts: [], answerPolicy: 'answer',
    coverage: { hasDirectEvidence: true, propertySatisfied: false, entityMatched: true, sourceOwnerSatisfied: true, confidence: 0.9 },
  };
  const v = co.validateEvidenceForProperty(pack);
  assert.equal(v.ok, false, 'JD requirement leaked as candidate experience');
});

test('AMBIGUOUS TERM SWEEP: source-owned nouns route by mode; general clarifies (multi-universe)', () => {
  // Source-owned NOUNS: in a strict mode they resolve to that owner; in a
  // general multi-universe mode they clarify.
  const sourceOwnedNouns = ['project', 'system', 'model', 'dataset', 'method', 'phase', 'stage', 'result', 'experiment', 'hardware', 'software', 'company', 'role', 'experience'];
  for (const term of sourceOwnedNouns) {
    const q = `Tell me about the ${term}.`;
    const doc = kernel.build(kernelInputFor('document_grounded_seminar', q));
    const meeting = kernel.build(kernelInputFor('meeting', q));
    const general = kernel.build(kernelInputFor('general', q));
    assert.equal(doc.sourceOwner, 'reference_files', `doc mode, term=${term}`);
    assert.equal(meeting.sourceOwner, 'transcript', `meeting mode, term=${term}`);
    assert.equal(general.sourceOwner, 'clarify', `general mode, term=${term}`);
  }
});

test('H1 fix: bare deictics/adjectives do NOT force clarify in general mode', () => {
  // current/latest/this/that/it name no source-owned thing → answer normally,
  // even with multiple universes present (avoids false-clarify on general Qs).
  for (const term of ['current', 'latest', 'this', 'that', 'it']) {
    const q = `Tell me about the ${term} thing.`;
    const general = kernel.build(kernelInputFor('general', q));
    assert.equal(general.sourceOwner, 'unknown', `general mode must answer, not clarify, for bare "${term}"`);
  }
});

test('CLARIFY LINE: general ambiguous question yields the three-way source question', () => {
  const line = co.buildAmbiguousSourceClarification();
  assert.match(line, /uploaded document.*resume.*meeting/is);
});

test('HINDSIGHT ISOLATION: doc-grounded turn never invokes the hindsight retriever even when configured', async () => {
  const contract = kernel.build(kernelInputFor('document_grounded_seminar', 'What did we discuss about the phases last time?'));
  const calls = new Set();
  await orchestrator.buildEvidencePack({
    question: 'What did we discuss about the phases last time?',
    contract,
    retrievers: trackedRetrievers(calls),
  });
  assert.ok(!calls.has('hindsight'));
});

test('MIXED OWNERSHIP is strict: no hindsight, no prior claims, no screen/browser', () => {
  const c = kernel.build({ ...kernelInputFor('interview', 'How should I answer their question about scaling?'), sourceAuthority: 'profile_plus_transcript' });
  for (const k of ['hindsight_memory', 'prior_assistant_claim', 'screen_context', 'browser_dom']) {
    assert.ok(c.forbiddenSources.includes(k), `${k} must be forbidden in profile/mixed ownership`);
  }
});
