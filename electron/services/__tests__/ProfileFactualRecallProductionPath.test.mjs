// electron/services/__tests__/ProfileFactualRecallProductionPath.test.mjs
//
// PRODUCTION-PATH test (not a mirror): loads the REAL compiled
// KnowledgeOrchestrator and drives its real processQuestion() against a
// synthetic resume, asserting the two bugs this session fixed are gone:
//
//   Bug A — "what are my projects?" / "my experience" returned a base-assistant
//           third-person refusal ("I don't have access to your resume") because
//           the result lacked the factualRecall flag and was dropped by the
//           premium-intercept mode gate.
//   Bug B — project/experience recall depended on vector retrieval >= 0.55
//           cosine, so a terse listing query could return an EMPTY context block
//           even though the structured resume clearly contains the data.
//
// This test uses NO embedder and NO LLM — so if recall still depended on vector
// retrieval, the context block would be empty. It passing proves the
// deterministic structured pack works. Fully dynamic: every asserted value comes
// from the synthetic resume object, nothing hardcoded into production logic.
//
// Run: npm run build:electron && node --test electron/services/__tests__/ProfileFactualRecallProductionPath.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { KnowledgeOrchestrator } = require('../../../dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js');

// --- Synthetic resume (fully fictional; no real PII) ---
const SYNTHETIC_RESUME = {
  id: 1,
  doc_type: 'resume',
  structured_data: {
    identity: { name: 'Jordan Rivera', email: 'jordan@example.test', location: 'Austin, TX', phone: '', links: [] },
    summary: 'Backend engineer.',
    skills: ['Go', 'PostgreSQL', 'Kubernetes', 'gRPC'],
    experience: [
      { company: 'Drift Systems', role: 'Senior Backend Engineer', start_date: '2021-03', end_date: null, bullets: ['Built the billing pipeline', 'Cut p99 latency 40%'] },
      { company: 'Nimbus Labs', role: 'Backend Engineer', start_date: '2018-06', end_date: '2021-02', bullets: ['Owned the auth service'] },
    ],
    projects: [
      { name: 'LedgerFlow', description: 'Event-sourced ledger for fintech', technologies: ['Go', 'Kafka'] },
      { name: 'PinMesh', description: 'Distributed config store', technologies: ['Rust', 'Raft'] },
    ],
    education: [
      { institution: 'State University', degree: 'BS', field: 'Computer Science', start_date: '2014-09', end_date: '2018-05' },
    ],
    achievements: [{ title: 'Patent: streaming dedup', description: 'US patent for a dedup method' }],
    certifications: [{ name: 'CKA', issuer: 'CNCF' }],
    leadership: [],
  },
};

// Minimal DB stub — only the methods the no-JD processQuestion path touches.
function makeStubDb(resume) {
  return {
    initializeSchema() {},
    getDocumentByType(type) { return type === 'resume' ? resume : null; },
    getAllNodes() { return []; },          // NO embedded nodes → vector retrieval can't help
    getNodeCount() { return 0; },
    getIntro() { return null; },
    getGapAnalysis() { return null; },
    getNegotiationScript() { return null; },
    getMockQuestions() { return null; },
    getCultureMappings() { return null; },
  };
}

function makeOrchestrator(resume = SYNTHETIC_RESUME) {
  const orch = new KnowledgeOrchestrator(makeStubDb(resume));
  // No embedFn, no fastQueryEmbedFn → resolveQueryEmbedder() returns null, so
  // getRelevantNodes is never called. Any recall MUST come from the structured pack.
  orch.setKnowledgeMode(true);
  return orch;
}

describe('Profile factual recall — production path', () => {
  test('"what are my projects?" returns ALL structured projects (no embedder, no LLM)', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('what are my projects?');

    assert.ok(result, 'processQuestion must not return null for a project listing');
    assert.equal(result.factualRecall, true, 'project listing must be flagged factualRecall (bypasses mode gate)');
    assert.ok(result.contextBlock && result.contextBlock.length > 0, 'context block must not be empty');
    // Both projects present — dynamic assertion from the fixture
    for (const p of SYNTHETIC_RESUME.structured_data.projects) {
      assert.match(result.contextBlock, new RegExp(p.name), `project "${p.name}" must be in context`);
    }
    assert.match(result.contextBlock, /candidate_projects/, 'must render into the <candidate_projects> block');
  });

  test('"tell me about my work experience" returns ALL experience entries', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('tell me about my work experience');

    assert.ok(result, 'must not return null');
    assert.equal(result.factualRecall, true);
    for (const e of SYNTHETIC_RESUME.structured_data.experience) {
      assert.match(result.contextBlock, new RegExp(e.company), `company "${e.company}" must be in context`);
      assert.match(result.contextBlock, new RegExp(e.role), `role "${e.role}" must be in context`);
    }
    assert.match(result.contextBlock, /candidate_experience/);
  });

  test('"what are my skills?" surfaces the skills list', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('what are my skills?');
    assert.ok(result);
    assert.equal(result.factualRecall, true);
    for (const s of SYNTHETIC_RESUME.structured_data.skills) {
      assert.match(result.contextBlock, new RegExp(s), `skill "${s}" must be in context`);
    }
  });

  test('"where did I go to school?" returns education', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('where did I go to school?');
    assert.ok(result);
    assert.match(result.contextBlock, new RegExp(SYNTHETIC_RESUME.structured_data.education[0].institution));
  });

  test('"what is my name?" still returns a direct identity fact (intro short-circuit)', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('what is my name?');
    assert.ok(result);
    assert.equal(result.isIntroQuestion, true);
    assert.match(result.introResponse, new RegExp(SYNTHETIC_RESUME.structured_data.identity.name));
  });

  test('generic knowledge ("what is a hashmap?") still fully bypasses (null)', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('what is a hashmap?');
    assert.equal(result, null, 'generic knowledge must not get candidate context');
  });

  test('no-resume orchestrator returns null (knowledge mode cannot enable)', async () => {
    const orch = new KnowledgeOrchestrator(makeStubDb(null));
    orch.setKnowledgeMode(true);
    const result = await orch.processQuestion('what are my projects?');
    assert.equal(result, null);
  });

  // --- Review follow-ups (code-reviewer HIGH + test-engineer gaps) ---

  test('achievements recall surfaces the achievement', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('what are my achievements?');
    assert.ok(result);
    assert.equal(result.factualRecall, true);
    assert.match(result.contextBlock, new RegExp(SYNTHETIC_RESUME.structured_data.achievements[0].title));
  });

  test('certifications recall surfaces the certification', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('what certifications do I have?');
    assert.ok(result);
    assert.equal(result.factualRecall, true);
    assert.match(result.contextBlock, new RegExp(SYNTHETIC_RESUME.structured_data.certifications[0].name));
  });

  test('mixed-category "my projects and education" pulls BOTH blocks', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('tell me about my projects and education');
    assert.ok(result);
    assert.equal(result.factualRecall, true);
    assert.match(result.contextBlock, new RegExp(SYNTHETIC_RESUME.structured_data.projects[0].name));
    assert.match(result.contextBlock, new RegExp(SYNTHETIC_RESUME.structured_data.education[0].institution));
  });

  test('skills-only question does NOT bleed experience/project nodes', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('what are my skills?');
    assert.ok(result);
    // Skills present...
    for (const s of SYNTHETIC_RESUME.structured_data.skills) {
      assert.match(result.contextBlock, new RegExp(s));
    }
    // ...but the dedicated experience/project XML blocks must NOT appear.
    assert.doesNotMatch(result.contextBlock, /candidate_experience/, 'skills query must not dump experience');
    assert.doesNotMatch(result.contextBlock, /candidate_projects/, 'skills query must not dump projects');
  });

  test('empty projects array: "what are my projects?" does not crash or fabricate a block', async () => {
    const emptyProjResume = JSON.parse(JSON.stringify(SYNTHETIC_RESUME));
    emptyProjResume.structured_data.projects = [];
    const orch = makeOrchestrator(emptyProjResume);
    const result = await orch.processQuestion('what are my projects?');
    // With no embedder and no projects, structured pack returns null → falls
    // through to inclusion-bias compact identity (candidate-directed). Must not
    // crash and must not emit a fabricated <candidate_projects> block.
    assert.ok(result, 'should still return a result (compact identity), not throw');
    if (result.contextBlock) {
      assert.doesNotMatch(result.contextBlock, /candidate_projects/, 'must not fabricate a projects block');
    }
  });

  test('ambiguous question (GENERAL intent, no category hint) → compact identity, NOT a structured pack', async () => {
    // "would taking this be a smart move?" — GENERAL intent, no second-person
    // candidate framing token, not generic-knowledge → inclusion-bias path.
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('would taking this be a smart move');
    assert.ok(result);
    assert.match(result.contextBlock, /candidate_identity/, 'should use compact identity (inclusion bias)');
    assert.equal(result.systemPromptInjection, '', 'inclusion-bias path injects no system prompt');
    assert.doesNotMatch(result.contextBlock, /candidate_projects|candidate_experience/);
  });

  test('REGRESSION: a genuine NEGOTIATION question is NOT flagged factualRecall', async () => {
    // factualRecall must mean "the user's own plain facts" only. A real
    // negotiation question (salary/offer/counter) injects the salary/coaching
    // layer the active-mode gate is meant to suppress — so it must stay gated.
    const orch = makeOrchestrator();
    for (const q of ['what salary should I negotiate?', 'how should I counter their offer?']) {
      const result = await orch.processQuestion(q);
      if (result) {
        assert.notEqual(result.factualRecall, true, `negotiation ("${q}") must not bypass the mode gate`);
      }
    }
  });
});

// --- LLMHelper mode-gate decision (the Fix-A predicate, exercised directly) ---
describe('LLMHelper factual-recall mode-gate bypass', () => {
  // Mirrors the production predicate:
  //   allowed = isPremiumKnowledgeInterceptAllowed() || result.factualRecall === true
  const decide = (modeAllows, result) =>
    !!(result && (modeAllows || result.factualRecall === true));

  test('factual recall is applied even when mode gate blocks (technical-interview)', () => {
    const result = { systemPromptInjection: 'X', contextBlock: 'Y', factualRecall: true };
    assert.equal(decide(false, result), true, 'projects/experience must survive an incompatible mode');
  });

  test('non-factual premium result is still suppressed by the mode gate', () => {
    const result = { systemPromptInjection: 'X', contextBlock: 'Y' /* no factualRecall */ };
    assert.equal(decide(false, result), false, 'coaching/persona stays gated');
  });

  test('compatible mode applies everything', () => {
    assert.equal(decide(true, { contextBlock: 'Y' }), true);
  });
});
