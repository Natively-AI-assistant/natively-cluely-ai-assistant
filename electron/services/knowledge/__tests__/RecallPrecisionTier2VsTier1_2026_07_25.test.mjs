// electron/services/knowledge/__tests__/RecallPrecisionTier2VsTier1_2026_07_25.test.mjs
//
// Phase 6 Slice 5 (context-rebuild, docs/context-rebuild/05_MIGRATION_PLAN.md
// "Slice 5"): THE required-before-shipping recall/precision A/B named by
// 04_TARGET_ARCHITECTURE_REVIEW.md §4/Q3 as this slice's single hard
// pre-requisite — "before item 1 [retiring Tier 1 vector search as an
// answer-time path] ships, not after."
//
// The review's own named example: "Have I demonstrated Kubernetes
// experience?" against a résumé bullet reading "container orchestration on
// EKS" — zero lexical token overlap. This test drives the REAL, exported
// Tier 2 lexical scorer (`queryOkfCards`, OkfRetriever.ts) against exactly
// this scenario with a REALISTIC 8-card résumé (not a trivial single-card
// case), and contrasts it against Tier 1's mechanism (`getRelevantNodes`,
// HybridSearchEngine.ts, 60% cosine-similarity-weighted).
//
// FINDING, empirically verified (not assumed) while building this test: the
// target card's ONLY score contribution is `queryOkfCards`'s unconditional
// per-card CONFIDENCE_BOOST (+0.15 for `confidence:'high'`, which is what a
// real ingested experience card with bullet content actually gets — see
// ProfileCardTemplates.ts's `confidence: bullets.length > 0 ? 'high' :
// 'medium'`) — NOT genuine relevance. In a realistic 8-card résumé where
// several OTHER, completely irrelevant cards (a frontend-engineer role, an
// internship, a hackathon achievement) happen to share generic words like
// "demonstrated"/"experience" with the question, those cards score HIGHER
// (0.211-0.291) than the genuinely relevant target (0.15, tied dead-last
// with the Skills and Education cards) — the target is ranked 8th of 8 and
// falls out of a realistic topN:6. This is a genuine recall (and precision)
// failure in a realistic scenario, not a contrived edge case, and it is
// STRUCTURAL: the confidence floor provides no discriminating signal, and
// there is no lexical mechanism to score the "container orchestration on
// EKS" ≈ "Kubernetes" relationship at all.
//
// Per the plan's own named fallback for exactly this outcome ("if lexical-
// only recall regresses materially, the fallback is a narrow, Tier-2-scoped
// vector lookup — never touching Tier 1 again — rather than silently
// walking back to Tier 1's hybrid search"), Slice 5's item 1 (retiring
// Tier 1 vector search entirely, with NO Tier 2 vector fallback) does NOT
// ship as originally scoped. See 05_MIGRATION_PLAN.md's Slice 5 STATUS note
// for the full disposition.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);
const { queryOkfCards } = require(path.resolve(repoRoot, 'dist-electron/electron/services/knowledge/OkfRetriever.js'));
const { classifyQuestion } = require(path.resolve(repoRoot, 'dist-electron/electron/services/knowledge/QuestionClassifier.js'));
const { getRelevantNodes } = require(path.resolve(repoRoot, 'dist-electron/premium/electron/knowledge/HybridSearchEngine.js'));

const KUBERNETES_QUESTION = 'Have I demonstrated Kubernetes experience?';

// Worded to have genuinely ZERO lexical overlap with "kubernetes" — "EKS"
// (Elastic Kubernetes Service) is Kubernetes-adjacent terminology a human
// reader recognizes, but shares no token with "kubernetes" itself.
const TARGET_CARD_BODY =
  'Built and operated container orchestration on EKS clusters, deploying containerized microservices for production traffic with automated rolling deployments and autoscaling.';

function makeCard(overrides = {}) {
  return {
    id: 'x', packId: 'pack-1', sourceId: 'resume-1', type: 'candidate_experience',
    title: 't', slug: 's', conceptId: 'c', body: 'b', sourcePages: [], sourceSections: [],
    sourceQuotes: [], entities: [], tags: [], relatedCardIds: [],
    // 'high' matches ProfileCardTemplates.ts's real default for any
    // experience card with bullet content — NOT an inflated choice.
    confidence: 'high', generatedFrom: 'structured_profile', sourceChecksum: 'x',
    userEdited: false, approvalStatus: 'approved', updatedAt: new Date(0).toISOString(), cardVersion: 1,
    ...overrides,
  };
}

// A realistic 8-card résumé: the target (Kubernetes-relevant, unlabeled as
// such) plus 7 cards spanning typical categories, several of which
// naturally use words like "demonstrated"/"experience" without being
// remotely about Kubernetes — exactly the confounders a real résumé has.
function realisticPack() {
  const target = makeCard({ id: 'target', title: 'Backend Engineer, Riverline', body: TARGET_CARD_BODY, entities: ['Riverline'] });
  const cards = [
    makeCard({ id: 'c1', title: 'Data Analyst, Initech', body: 'Built SQL dashboards and Python ETL pipelines, demonstrating strong experience with data engineering practices for the finance team.', entities: ['Initech'] }),
    makeCard({ id: 'c2', title: 'Frontend Engineer, Acme', body: 'Developed React components and demonstrated experience building accessible, responsive user interfaces for e-commerce.', entities: ['Acme'] }),
    makeCard({ id: 'c3', title: 'Skills', type: 'candidate_skills', body: 'Proficient in Python, SQL, Tableau, and JavaScript for data analysis and visualization.' }),
    makeCard({ id: 'c4', title: 'Education', type: 'candidate_education', body: 'B.S. in Computer Science, State University, 2018.' }),
    target,
    makeCard({ id: 'c5', title: 'Intern, Globex', body: 'Assisted senior engineers, gaining hands-on experience with internal tooling and demonstrated reliability on every assigned task.', entities: ['Globex'] }),
    makeCard({ id: 'c6', title: 'Project: SQL-Copilot', type: 'candidate_project', body: 'A query assistant for analysts, showcasing experience with LLM-based tooling and demonstrated impact on team velocity.' }),
    makeCard({ id: 'c7', title: 'Achievement: Hackathon Winner', type: 'candidate_achievement', body: 'Won first place, demonstrating strong experience under pressure and rapid prototyping skill.' }),
  ];
  return { cards, packVersion: 1 };
}

describe('Tier 2 (queryOkfCards, pure lexical) fails to recall a zero-lexical-overlap paraphrase in a realistic multi-card résumé', () => {
  test('the target card scores ONLY the confidence floor (0.15) — identical to two totally unrelated cards (Skills, Education)', () => {
    const pack = realisticPack();
    const classification = classifyQuestion(KUBERNETES_QUESTION);
    const results = queryOkfCards(pack, KUBERNETES_QUESTION, classification, { topN: 100, minScore: -1 });
    const byId = Object.fromEntries(results.map((r) => [r.card.id, r.score]));
    assert.equal(Number(byId.target.toFixed(2)), 0.15);
    assert.equal(byId.target, byId.c3, 'target ties with the Skills card — no discriminating signal at all');
    assert.equal(byId.target, byId.c4, 'target ties with the Education card — no discriminating signal at all');
  });

  test('irrelevant cards sharing generic words ("demonstrated"/"experience") with the question OUTRANK the genuinely relevant target', () => {
    const pack = realisticPack();
    const classification = classifyQuestion(KUBERNETES_QUESTION);
    const results = queryOkfCards(pack, KUBERNETES_QUESTION, classification, { topN: 100, minScore: -1 });
    const byId = Object.fromEntries(results.map((r) => [r.card.id, r.score]));
    // c2 (Frontend Engineer), c5 (Intern), c6 (SQL-Copilot project) — none
    // are about Kubernetes/EKS/container orchestration at all.
    assert.ok(byId.c2 > byId.target, 'an unrelated frontend-engineer card outranks the relevant target');
    assert.ok(byId.c5 > byId.target, 'an unrelated internship card outranks the relevant target');
    assert.ok(byId.c6 > byId.target, 'an unrelated project card outranks the relevant target');
  });

  test('at a realistic topN:6, the target card falls out of the returned results entirely — a genuine recall failure', () => {
    const pack = realisticPack();
    const classification = classifyQuestion(KUBERNETES_QUESTION);
    const results = queryOkfCards(pack, KUBERNETES_QUESTION, classification, { topN: 6 });
    assert.equal(results.find((r) => r.card.id === 'target'), undefined, 'the relevant card must be MISSING from a realistic top-6 result set');
    assert.equal(results.length, 6);
  });

  test('control: a LEXICALLY-OVERLAPPING phrasing of the SAME question DOES recall the target fine — Tier 2 is not broken, just structurally blind to this paraphrase', () => {
    const pack = realisticPack();
    const question = 'Tell me about your container orchestration and EKS experience.';
    const classification = classifyQuestion(question);
    const results = queryOkfCards(pack, question, classification, { topN: 6 });
    const target = results.find((r) => r.card.id === 'target');
    assert.ok(target, 'the same card WITH lexical overlap must be recalled — confirms Tier 2 works within its actual capability');
    // Meaningfully above the confidence-floor-only score (0.15) from the
    // zero-overlap case above — real lexical signal, not just noise.
    assert.ok(target.score > 0.25, `expected a real lexical-match score above the confidence floor, got ${target?.score}`);
  });
});

describe('Tier 1 (getRelevantNodes, embedding-weighted) recalls the SAME content given a realistic embedding similarity', () => {
  function cosineSimilarity(a, b) {
    const dot = a.reduce((s, v, i) => s + v * b[i], 0);
    const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
    return dot / (magA * magB);
  }

  // No live embedding provider is reachable in this test environment. These
  // vectors are HANDCRAFTED to land at cosine similarity 0.8 — a realistic
  // approximation for this class of semantically-related-but-lexically-
  // disjoint technical term pair (EKS literally stands for "Elastic
  // KUBERNETES Service"), not a value inflated to make the test pass.
  const QUESTION_EMBEDDING = [1, 0, 0, 0, 0];
  const TARGET_EMBEDDING = [0.8, 0.6, 0, 0, 0]; // cosine(Q,T) = 0.8/1 = 0.8
  const DISTRACTOR_EMBEDDING = [0, 0, 1, 0, 0]; // orthogonal — an unrelated skill/role

  test('sanity: the handcrafted embeddings land at exactly the intended 0.8 similarity', () => {
    const sim = cosineSimilarity(QUESTION_EMBEDDING, TARGET_EMBEDDING);
    assert.ok(Math.abs(sim - 0.8) < 1e-9, `expected cosine similarity 0.8, got ${sim}`);
  });

  test('getRelevantNodes recalls the target ContextNode given this realistic embedding similarity — Tier 1 closes the gap Tier 2 cannot', async () => {
    const targetNode = {
      id: 'node-1', source_type: 'resume', category: 'experience',
      title: 'Backend Engineer, Riverline', organization: 'Riverline',
      text_content: TARGET_CARD_BODY, tags: [], embedding: TARGET_EMBEDDING,
      duration_months: 18, end_date: null,
    };
    const distractorNode = {
      id: 'node-2', source_type: 'resume', category: 'skills',
      title: 'Skills', organization: '', text_content: 'Proficient in Python, SQL, and Tableau.',
      tags: [], embedding: DISTRACTOR_EMBEDDING, duration_months: 0, end_date: null,
    };
    const embedFn = async () => QUESTION_EMBEDDING;
    const results = await getRelevantNodes(KUBERNETES_QUESTION, [targetNode, distractorNode], embedFn);
    const targetResult = results.find((r) => r.node.id === 'node-1');
    assert.ok(targetResult, 'Tier 1\'s embedding-weighted scoring must recall the target node given a realistic semantic similarity, unlike Tier 2');
    assert.ok(targetResult.score > 0.4, `expected a meaningfully positive score (60% weight × 0.8 similarity = 0.48), got ${targetResult.score}`);
    const distractorResult = results.find((r) => r.node.id === 'node-2');
    assert.ok(
      !distractorResult || targetResult.score > distractorResult.score,
      'the semantically-relevant target must outscore the orthogonal (unrelated) distractor',
    );
  });
});
