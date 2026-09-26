// An exhaustive request widens the whole pipeline, once, from the plan
// (2026-09-07).
//
// MEASURED on Evin's own session (General mode, six attached files, Voyage
// reranker): "Find every place in the attached reference material where a
// specific latency number appears…" listed 8 of ~20 values. Every stage was
// sized for ONE fact: the plan accepted 6 chunks, the mode port asked the
// retriever for the normal token budget, the reranker pool was the user's 15
// candidates, and the composer said nothing about scanning everything. This
// suite pins each widening at the seam where it lives.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(process.cwd());
const base = path.resolve(repoRoot, 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);
const { classifyTurn } = await load('question/turn-classifier.js');
const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');
const { decide } = await load('orchestration/orchestrator.js');
const { createModeRetrievalPort } = await load('retrieval/mode-retrieval-port.js');
const { packContext } = await load('generation/context-packer.js');
const { composePrompt } = await load('generation/prompt-composer.js');

const FILES = ['00_target_jd_resume.md', '02_architecture_questions.md', '03_debugging_scenarios.md', '04_exact_retrieval_anchors.md'];
const classify = (q, over = {}) =>
  classifyTurn({ resolvedQuestion: q, policy: MODE_POLICIES.general, isFollowUp: false, hasAttachedDocuments: true, attachedFileNames: FILES, ...over });

const EXHAUSTIVE = [
  'Find every place in the attached reference material where a specific latency number appears. List the number, what it refers to, and the file/section where you found it.',
  'Give me every metric associated with reranker A and B, including the metric name, value and dataset.',
  'List all the fallbacks the reference architecture specifies.',
  'How many times is 145 ms mentioned across the files?',
  'Extract everything the documents say about timeouts.',
];
const ORDINARY = [
  'What was the p99 after the regression?',
  'What is the hourly rate in the SOW?',
  'Summarize the postmortem for me.',
  'If the reranker goes down, what should the system do?',
  'How would you prevent tenant cobalt from receiving tenant emerald\'s results?',
];

describe('the classifier flags an exhaustive request only when there is material to scan', () => {
  for (const q of EXHAUSTIVE) test(`exhaustive: ${q.slice(0, 60)}`, () => {
    const r = classify(q);
    assert.equal(r.exhaustive, true, r.reason);
    assert.equal(r.shouldRetrieve, true, r.reason);
  });
  for (const q of ORDINARY) test(`ordinary: ${q.slice(0, 60)}`, () => {
    assert.equal(classify(q).exhaustive, false);
  });
  test('with no documents attached the flag never sets', () => {
    assert.equal(classify(EXHAUSTIVE[0], { hasAttachedDocuments: false, attachedFileNames: [] }).exhaustive, false);
  });
  test('a bare follow-up never sets it', () => {
    assert.equal(classify('all of them?').exhaustive, false);
  });
});

const dec = (q) => decide({
  requestId: 'r', requestSequence: 1, surface: 'manual_chat', modeId: 'general',
  scope: { userId: 'u', modeId: 'general' }, sessionId: 's',
  manualQuestion: q, hasAttachedDocuments: true, attachedFileNames: FILES,
});

describe('the orchestrator widens the plan once', () => {
  test('exhaustive: ×2 candidates, ×3 accepted evidence, a longer timeout, and the flag', () => {
    const p = dec(EXHAUSTIVE[0]).retrievalPlan;
    const base = MODE_POLICIES.general.retrievalPolicy;
    assert.equal(p.exhaustive, true);
    assert.equal(p.maximumCandidates, base.maximumCandidates * 2);
    assert.equal(p.maximumAcceptedEvidence, base.maximumAcceptedEvidence * 3);
    assert.equal(p.timeoutMs, 2400);
  });
  test('an ordinary lookup keeps the policy numbers exactly', () => {
    const p = dec(ORDINARY[0]).retrievalPlan;
    const base = MODE_POLICIES.general.retrievalPolicy;
    assert.equal(p.exhaustive, undefined);
    assert.equal(p.maximumCandidates, base.maximumCandidates);
    assert.equal(p.maximumAcceptedEvidence, base.maximumAcceptedEvidence);
    assert.equal(p.timeoutMs, 1200);
  });
});

function chunksFor(n) {
  return Array.from({ length: n }, (_, i) => ({
    sourceId: FILES[i % FILES.length].replace(/\W/g, '_'), fileName: FILES[i % FILES.length], chunkIndex: i,
    text: `Timeout budget item ${i}: ${20 + i} ms for stage ${i}.`, score: 0.9 - i * 0.02, ftsScore: 0.2, vectorScore: 0.4, rerankScore: 0.9 - i * 0.02,
  }));
}
function portWith(calls, n = 24) {
  return createModeRetrievalPort({
    modesManager: { retrieveHybridRaw: async (_m, _f, opts) => { calls.push(opts); return { chunks: chunksFor(n), formattedContext: '', usedFallback: false, usedHybrid: true }; } },
    modeInfo: { id: 'general' },
    files: FILES.map((f) => ({ id: f.replace(/\W/g, '_'), fileName: f, content: `# ${f}\ncontent` })),
    tokenBudget: MODE_POLICIES.general.contextBudget.evidenceTokens,
    userId: 'u',
    rerankSurface: 'manual',
  });
}

describe('the mode port widens what it asks the retriever for', () => {
  test('exhaustive: tripled token budget, doubled rerank pool, the widened topK', async () => {
    const calls = [];
    const d = dec(EXHAUSTIVE[0]);
    await portWith(calls).retrieve({ decision: d });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tokenBudget, MODE_POLICIES.general.contextBudget.evidenceTokens * 3);
    assert.equal(calls[0].rerankPoolMultiplier, 2);
    assert.equal(calls[0].topK, d.retrievalPlan.maximumCandidates);
  });
  test('ordinary: the normal budget and no pool multiplier', async () => {
    const calls = [];
    await portWith(calls).retrieve({ decision: dec(ORDINARY[0]) });
    assert.equal(calls[0].tokenBudget, MODE_POLICIES.general.contextBudget.evidenceTokens);
    assert.equal(calls[0].rerankPoolMultiplier, undefined);
  });
  test('the port hands back up to the widened cap, not the old six', async () => {
    const d = dec(EXHAUSTIVE[0]);
    const { evidence } = await portWith([], 24).retrieve({ decision: d });
    assert.ok(evidence.length > 6, `only ${evidence.length} evidence items survived the port`);
    assert.ok(evidence.length <= d.retrievalPlan.maximumAcceptedEvidence);
  });
});

describe('the packer and composer follow the plan', () => {
  test('packContext keeps more than six items under the widened cap', async () => {
    const d = dec(EXHAUSTIVE[0]);
    const { evidence } = await portWith([], 24).retrieve({ decision: d });
    const p = packContext(d, evidence, { evidenceTokens: 100000, conversationTokens: 0, transcriptTokens: 0 });
    assert.ok(p.includedEvidenceIds.length > 6, `${p.includedEvidenceIds.length}`);
  });
  test('composePrompt adds the scan-everything section and triples the evidence budget', async () => {
    const d = dec(EXHAUSTIVE[0]);
    const { evidence } = await portWith([], 24).retrieve({ decision: d });
    const c = composePrompt({ decision: d, policy: MODE_POLICIES.general, evidence });
    assert.ok(c.sections.includes('exhaustive'), c.sections.join(','));
    assert.match(c.system, /EVERY occurrence/);
    assert.match(c.system, /source_name and section/);
    // More than six evidence blocks reach the prompt (the old cap was 6 and the
    // old budget would have dropped the rest).
    const blocks = (c.user.match(/<evidence /g) || []).length;
    assert.ok(blocks > 6, `only ${blocks} evidence blocks in the prompt`);
  });
  test('exhaustive evidence is grouped file by file in the prompt', async () => {
    const d = dec(EXHAUSTIVE[0]);
    const { evidence } = await portWith([], 24).retrieve({ decision: d });
    const p = packContext(d, evidence, { evidenceTokens: 100000, conversationTokens: 0, transcriptTokens: 0 });
    const names = [...p.evidenceBlock.matchAll(/source_name="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(names.length > 6);
    const runs = names.filter((n, i) => i === 0 || names[i - 1] !== n);
    assert.equal(new Set(runs).size, runs.length, `sources interleave: ${names.join(' > ')}`);
    const c = composePrompt({ decision: d, policy: MODE_POLICIES.general, evidence });
    assert.match(c.system, /file by file/);
  });

  test('an ordinary turn has no exhaustive section', async () => {
    const d = dec(ORDINARY[0]);
    const { evidence } = await portWith([], 8).retrieve({ decision: d });
    const c = composePrompt({ decision: d, policy: MODE_POLICIES.general, evidence });
    assert.ok(!c.sections.includes('exhaustive'));
  });
});

describe('the widening reaches the hybrid retriever (source assertions)', () => {
  const src = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');
  test('ModeContextRetriever forwards rerankPoolMultiplier; ModeHybridRetriever widens the pool with a 2× ceiling', () => {
    assert.match(src('electron/services/ModeContextRetriever.ts'), /rerankPoolMultiplier: options\.rerankPoolMultiplier,/);
    const h = src('electron/services/modes/ModeHybridRetriever.ts');
    assert.match(h, /this\.maybeRerankCandidates\(queryText, candidates, rerankPoolMultiplier\)/);
    assert.match(h, /Math\.min\(2 \* RERANK_CANDIDATE_POOL, resolveRerankPoolSize\(\) \* mult\)/);
  });
});
