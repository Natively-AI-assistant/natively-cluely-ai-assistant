// electron/services/__tests__/PersonaFabricationFallbackProductionPath.test.mjs
//
// PRODUCTION-PATH test (not a mirror): loads the REAL compiled
// KnowledgeOrchestrator and drives its real processQuestion() to verify the
// persona-fabrication fix.
//
// THE BUG (found on the live Natively API, gemini-3.6-flash): a confident-
// persona candidate-directed question with NO category keyword
// ("answer like a confident ML engineer: why should they hire me?") matches no
// structured pack and embeds poorly, so retrieval returns ZERO nodes — a VOID.
// With a confident persona and no grounded facts the model INVENTS metrics
// ("improved model accuracy by 20%") to fill the void.
//
// THE FIX (layer 1, the only layer reachable without an LLM): when a candidate-
// directed question returns ZERO retrieval nodes, KnowledgeOrchestrator seeds
// REAL experience + achievement nodes from structured_data so the model has
// genuine material to cite instead of a void to fabricate into.
//
// This test uses NO embedder and NO LLM, so retrieval is structurally empty —
// exactly the condition that triggered the bug. If the fallback were absent the
// context block would be empty (the void). It being non-empty AND containing the
// fixture's own company/role/achievement proves the void is filled with REAL
// material. Fully dynamic: every asserted value comes from the synthetic resume.
//
// Run: npm run build:electron && node --test electron/services/__tests__/PersonaFabricationFallbackProductionPath.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { KnowledgeOrchestrator } = require('../../../dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js');

// --- Synthetic resume (fully fictional; no real PII; values differ from the
// other production-path test so a hardcoded match would fail) ---
const SYNTHETIC_RESUME = {
  id: 1,
  doc_type: 'resume',
  structured_data: {
    identity: { name: 'Priya Anand', email: 'priya@example.test', location: 'Seattle, WA', phone: '', links: [] },
    summary: 'ML engineer.',
    skills: ['Python', 'PyTorch', 'Ray', 'BigQuery'],
    experience: [
      { company: 'Heliotrope AI', role: 'Staff ML Engineer', start_date: '2020-08', end_date: null, bullets: ['Productionized the recommendations stack', 'Owned the offline eval harness'] },
      { company: 'Quorum Data', role: 'ML Engineer', start_date: '2017-01', end_date: '2020-07', bullets: ['Built the feature store'] },
    ],
    projects: [
      { name: 'TensorTrace', description: 'Model lineage tracker', technologies: ['Python', 'Neo4j'] },
    ],
    education: [
      { institution: 'Cascadia Institute', degree: 'MS', field: 'Machine Learning', start_date: '2015-09', end_date: '2016-12' },
    ],
    achievements: [{ title: 'Best Paper, NeurIPS workshop', description: 'Awarded for a sparse-attention method' }],
    certifications: [],
    leadership: [],
  },
};

function makeStubDb(resume) {
  return {
    initializeSchema() {},
    getDocumentByType(type) { return type === 'resume' ? resume : null; },
    getAllNodes() { return []; },          // NO embedded nodes
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
  // No embedFn / no fastQueryEmbedFn → resolveQueryEmbedder() returns null, so
  // getRelevantNodes is never called: retrieval is structurally EMPTY. This is
  // the exact void condition that produced the persona-fabrication bug.
  orch.setKnowledgeMode(true);
  return orch;
}

describe('Persona-fabrication zero-node fallback — production path', () => {
  test('"why should they hire me?" (no category keyword, empty retrieval) grounds REAL experience instead of a void', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('why should they hire me?');

    assert.ok(result, 'candidate-directed fit question must return a result, not null');
    assert.ok(result.contextBlock && result.contextBlock.length > 0,
      'context block must NOT be empty — an empty block is the void that induced fabrication');

    // The seeded fallback uses category "experience" → <candidate_experience>.
    assert.match(result.contextBlock, /candidate_experience/,
      'fallback must render real experience into the <candidate_experience> block');

    // Every real experience entry must be grounded — fully dynamic, from the fixture.
    for (const e of SYNTHETIC_RESUME.structured_data.experience) {
      assert.match(result.contextBlock, new RegExp(e.company), `company "${e.company}" must be grounded`);
      assert.match(result.contextBlock, new RegExp(e.role), `role "${e.role}" must be grounded`);
    }
    // Bullet content from the resume should appear (genuine material to cite).
    const firstBullet = SYNTHETIC_RESUME.structured_data.experience[0].bullets[0];
    assert.match(result.contextBlock, new RegExp(firstBullet.slice(0, 12)),
      'real bullet content must be present so the model cites it rather than inventing metrics');
  });

  test('the achievement is also seeded into <candidate_achievements>', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('make your case for why you are the right fit');
    assert.ok(result && result.contextBlock);
    assert.match(result.contextBlock, /candidate_achievements/,
      'real achievements must render into the <candidate_achievements> block');
    assert.match(result.contextBlock, new RegExp(SYNTHETIC_RESUME.structured_data.achievements[0].title));
  });

  test('the fallback leaks NO fabricated numbers — only resume-derived text appears', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('why should they hire me?');
    assert.ok(result && result.contextBlock);
    // The synthetic resume contains NO percentage metrics. The fallback must not
    // synthesize any. Any "<n>%" in the block would be invented.
    assert.doesNotMatch(result.contextBlock, /\d+\s?%/,
      'fallback must not introduce any percentage metric not present in the resume');
  });

  test('does NOT leak the negotiation/coaching or JD layer', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('why should they hire me?');
    assert.ok(result && result.contextBlock);
    assert.doesNotMatch(result.contextBlock, /salary_intelligence|gap_pivot_scripts|negotiation/i,
      'a fit question must not pull in the salary/negotiation coaching layer');
    assert.equal(result.liveNegotiationResponse, undefined, 'no live-negotiation response on a fit question');
  });

  // --- Guard: the fallback must NOT override genuine retrieval ---
  test('GUARD: when retrieval returns nodes, the fallback does NOT fire/override', async () => {
    // A category-keyword question ("what is my work experience") hits the
    // deterministic structured pack (fastPathNodes), so relevantNodes is
    // non-empty BEFORE the zero-node check — the fallback branch is skipped.
    // We assert the structured-pack path is in effect (factualRecall set, which
    // the zero-node fallback path never sets), proving the fallback did not take
    // over. Content is identical either way, so we verify the ROUTE not the text.
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('tell me about my work experience');
    assert.ok(result && result.contextBlock);
    assert.equal(result.factualRecall, true,
      'structured-pack route (real retrieval) must own this — fallback never sets factualRecall, so its absence here would prove override');
    for (const e of SYNTHETIC_RESUME.structured_data.experience) {
      assert.match(result.contextBlock, new RegExp(e.company));
    }
  });

  // --- Edge: empty experience AND achievements → no crash, no fabricated block ---
  test('EDGE: empty experience AND achievements → fallback returns [] → no crash, no fabricated block', async () => {
    const bare = JSON.parse(JSON.stringify(SYNTHETIC_RESUME));
    bare.structured_data.experience = [];
    bare.structured_data.achievements = [];
    const orch = makeOrchestrator(bare);
    const result = await orch.processQuestion('why should they hire me?');
    // Must not throw. With nothing to seed, no experience/achievement block.
    if (result && result.contextBlock) {
      assert.doesNotMatch(result.contextBlock, /candidate_experience|candidate_achievements/,
        'with no real experience/achievements, no such block may be fabricated');
      assert.doesNotMatch(result.contextBlock, /\d+\s?%/, 'must not invent metrics');
    }
  });

  // --- Dynamism: the fix is resume-derived, not keyed to any fixture value ---
  test('DYNAMISM: a totally different resume grounds ITS OWN values', async () => {
    const other = JSON.parse(JSON.stringify(SYNTHETIC_RESUME));
    other.structured_data.experience = [
      { company: 'Zephyr Logistics', role: 'Principal Engineer', start_date: '2019-01', end_date: null, bullets: ['Rebuilt the routing engine'] },
    ];
    other.structured_data.achievements = [{ title: 'Founder award', description: 'For the routing rewrite' }];
    const orch = makeOrchestrator(other);
    const result = await orch.processQuestion('why should they hire me?');
    assert.ok(result && result.contextBlock);
    assert.match(result.contextBlock, /Zephyr Logistics/);
    assert.match(result.contextBlock, /Principal Engineer/);
    assert.match(result.contextBlock, /Founder award/);
    // And none of the original fixture's values leak in.
    assert.doesNotMatch(result.contextBlock, /Heliotrope AI|Quorum Data/);
  });
});
