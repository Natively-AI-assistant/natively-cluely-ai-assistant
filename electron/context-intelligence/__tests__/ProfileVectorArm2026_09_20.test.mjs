// Semantic arm for the V3 profile path (2026-09-20; design:
// experiments/retrieval-scale/PI-VECTOR-ARM-DESIGN.md, owner-approved).
// The profile port ranked with BM25 only, so a paraphrase with no shared
// vocabulary had no route to its chunk — live, those misses came back as WRONG
// answers ("I wasn't at Oakhaven", an invented salary), not refusals.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.cwd(), 'dist-electron/electron');
const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const { createProfileRetrievalPort } = await load('context-intelligence/retrieval/profile-retrieval-port.js');
const { orchestrate } = await load('context-intelligence/orchestration/orchestrator.js');
const { resolveModePolicy } = await load('context-intelligence/policies/mode-policy-registry.js');
const { semanticChunks } = await load('services/modes/semanticChunker.js');
const { profilePseudoFiles, buildProfileRawRetriever, indexProfileRawText } = await load('services/knowledge/v3ProfileSources.js');

const MODE = 'looking-for-work';
const policy = resolveModePolicy(MODE);
// 80 pod sections: with a small document every chunk fits in the evidence and BM25 "finds" the
// line by default — the first version of this control passed for that reason alone.
// Every 7th pod also carries the pager: a phrase with real idf that TWELVE chunks share — the
// look-alikes the interleave test needs. (Words shared by all 80 chunks weigh ~nothing under BM25.)
const JD = ['# Job description', '', ...Array.from({ length: 80 }, (_, i) => `### Team profile: pod ${i}\n\nThe pod owns the billing reconciler for ledger ${i} and currently has ${4 + i} engineers.${i % 7 === 0 ? ' It carries the pager rotation for settlement escalations overnight.' : ''}\n`),
  '### Minimum qualifications', '', '- 9+ years building distributed backend systems, at least 3 of them operating a ledger in production.', ''].join('\n');
const docs = [{ kind: 'jd', sourceId: 'p-jd', versionId: 'hashA', fileName: 'jd.md', structured: null, rawText: JD }];
const req = (q) => ({ requestId: 'r', requestSequence: 1, surface: 'manual_chat', modeId: MODE, scope: { userId: 'u' }, sessionId: `s-${Math.random()}`, manualQuestion: q, hasAttachedDocuments: true, profileOnlyDocuments: true });
// A paraphrase that shares NO content word with the line that answers it, but does name the job.
const Q = 'For this role, how senior does someone need to be?';
const port = (rawRetriever) => createProfileRetrievalPort({ docs, allowedSourceTypes: policy.allowedSourceTypes, profileSources: policy.profileSources, userId: 'u', ...(rawRetriever ? { rawRetriever } : {}) });
// The semantic retriever's chunk is recognisable by text only IT returns — so the assertions do
// not depend on whether BM25 happens to find the same line. (Two earlier versions of this control
// asserted "BM25 cannot reach the paraphrased line" and were wrong both times: on a small document
// every chunk fits, and on a large one the raw-text intent boost from 2026-09-19 finds it.)
const SEMANTIC_TEXT = '[context: Minimum qualifications] - 9+ years building distributed backend systems. <<via-semantic-arm>>';
const semantic = async () => [{ sourceId: 'p-jd', text: SEMANTIC_TEXT, chunkIndex: 81, score: 0.82 }];
const viaSemantic = (r) => r.evidence.find((e) => e.content.includes('<<via-semantic-arm>>'));

describe('profile port with a semantic raw retriever', () => {
  test('control: without a retriever nothing arrives via the semantic arm, and raw text is BM25 windows', async () => {
    const r = await orchestrate(req(Q), port(null));
    assert.equal(viaSemantic(r), undefined);
    assert.ok(r.evidence.length > 0);
  });
  test('the semantic arm\'s chunk reaches the evidence, typed and sourced as the PROFILE document', async () => {
    const hit = viaSemantic(await orchestrate(req(Q), port(semantic)));
    assert.ok(hit, 'semantic chunk missing from evidence');
    assert.equal(hit.sourceId, 'p-jd');
    assert.equal(hit.sourceType, 'JOB_DESCRIPTION');
  });
  // The first cut REPLACED the BM25 raw chunks with the semantic arm's. It failed its own ship gate:
  // on plain-text job descriptions, lexical questions fell from 100% to 91–95% (run-profile.mjs
  // --vectors --plain), because when the hybrid ranker missed an obvious chunk, BM25's hit was
  // discarded with the rest.
  test('a lexically obvious chunk survives when the semantic arm misses it — the arms are a UNION', async () => {
    const r = await orchestrate(req('How many engineers are in pod 3?'), port(semantic));
    assert.ok(r.evidence.some((e) => /pod 3\b/.test(e.content)), 'BM25 hit was silenced by the semantic arm');
  });
  // A plain union sorted by score is not enough: BM25 scores a word-sharing chunk far above what a
  // correct paraphrase hit scores in the hybrid blend, so twelve look-alikes fill the 6-item cap.
  // The first version of this test asked about a phrase ALL 80 chunks share — ~zero idf, so nothing
  // outranked the semantic hit and the test passed with the lift removed.
  test('a LOW-scored semantic hit still reaches the evidence past many high BM25 look-alikes — rank-matched interleave', async () => {
    const lowScored = async () => [{ sourceId: 'p-jd', text: SEMANTIC_TEXT, chunkIndex: 81, score: 0.2 }];
    const r = await orchestrate(req('Which pods carry the pager rotation for settlement escalations overnight?'), port(lowScored));
    const lookAlikes = r.evidence.filter((e) => /pager rotation/.test(e.content)).length;
    assert.ok(lookAlikes >= 4, `fixture: only ${lookAlikes} BM25 look-alikes in evidence`);
    assert.ok(viaSemantic(r), 'semantic hit was outranked by BM25 look-alikes');
    assert.ok(lookAlikes >= r.evidence.length - 1, 'the semantic arm took more than its interleaved share');
  });
  test('the same text from both arms is ONE evidence row, not two', async () => {
    const pod3 = semanticChunks(JD).find((c) => /pod 3\b/.test(c));
    assert.ok(pod3, 'fixture: no pod 3 chunk');
    const same = async () => [{ sourceId: 'p-jd', text: pod3, chunkIndex: 3, score: 0.5 }];
    const r = await orchestrate(req('How many engineers are in pod 3?'), port(same));
    assert.equal(r.evidence.filter((e) => /pod 3\b/.test(e.content)).length, 1);
  });
  test('a throwing or empty retriever falls back to the BM25 raw chunks — the turn still has evidence', async () => {
    for (const rr of [async () => { throw new Error('embed down'); }, async () => []]) {
      const r = await orchestrate(req('How many engineers are in pod 3?'), port(rr));
      assert.ok(r.evidence.some((e) => /pod 3/.test(e.content)), 'BM25 raw chunk missing');
    }
  });
  test('a chunk claiming an unknown source is dropped, never typed by guesswork', async () => {
    const r = await orchestrate(req(Q), port(async () => [{ sourceId: 'mode-file-7', text: '9+ years (from somewhere else)', chunkIndex: 0, score: 0.99 }]));
    assert.ok(!r.evidence.some((e) => /from somewhere else/.test(e.content)));
  });
});

describe('binding to the mode retriever', () => {
  test('pseudo-files: one per document with raw text, id carries kind + version, never the derived facts', () => {
    const files = profilePseudoFiles([...docs, { kind: 'fact', sourceId: 'p-fact', versionId: 'f', fileName: 'facts', rawText: 'x' }, { kind: 'resume', sourceId: 'p-r', versionId: 'r1', fileName: 'r.pdf', rawText: '  ' }]);
    assert.deepEqual(files.map((f) => f.id), ['profile:jd:hashA']);
    assert.equal(files[0].docSourceId, 'p-jd');
  });
  test('the retriever is asked for document-grounded, reranked results and its ids are mapped back', async () => {
    let seen = null;
    const mm = { retrieveHybridRaw: async (_m, files, o) => { seen = { files, o }; return { chunks: [{ sourceId: 'profile:jd:hashA', text: 'T', chunkIndex: 2, score: 0.4, rerankScore: 0.9 }, { sourceId: 'someone-elses-file', text: 'X', chunkIndex: 0, score: 1 }] }; } };
    const rr = buildProfileRawRetriever(mm, docs, { tokenBudget: 1800, rerankSurface: 'manual', meetingActive: () => false });
    const out = await rr('q', { topK: 12, timeoutMs: 900 });
    // The FIRST-STAGE score, not rerankScore: fusion caps rerank scores near 0.2, a different scale,
    // and preferring it pushed every reranked row under the port's relevance gate (review finding).
    assert.deepEqual(out, [{ sourceId: 'p-jd', text: 'T', chunkIndex: 2, score: 0.4 }]);
    assert.equal(seen.o.timeoutMs, 900); assert.equal(seen.o.queryEmbedRetryBudgetMs, 900);
    assert.equal(seen.o.forceDocumentGrounding, true); assert.equal(seen.o.allowRerank, true);
    assert.equal(seen.o.meetingActive, false); assert.equal(seen.o.tokenBudget, 1800);
    assert.deepEqual(seen.files.map((f) => f.id), ['profile:jd:hashA']);
  });
  test('no raw text or no retriever → null (the port keeps BM25)', () => {
    assert.equal(buildProfileRawRetriever({}, docs, { tokenBudget: 1, rerankSurface: 'live' }), null);
    assert.equal(buildProfileRawRetriever({ retrieveHybridRaw: async () => null }, [{ ...docs[0], rawText: '' }], { tokenBudget: 1, rerankSurface: 'live' }), null);
  });
  test('with NO active document every kind is pruned — deleting a résumé must not leave its text and vectors on disk', async () => {
    const calls = [];
    const mm = { indexReferenceFile: async (f) => { calls.push(['index', f.id]); }, pruneReferenceFileIndexesByPrefix: (prefix, keep) => { calls.push(['prune', prefix, keep]); return 1; } };
    assert.equal(await indexProfileRawText(mm, { getActiveProfileContext: undefined }), 0);
    // before AND after indexing, for both kinds, keeping nothing
    assert.deepEqual(calls, [['prune', 'profile:resume:', ''], ['prune', 'profile:jd:', ''], ['prune', 'profile:resume:', ''], ['prune', 'profile:jd:', '']]);
  });
  test('runs are serialised: a second run does not start while the first is still indexing', async () => {
    const order = []; let release;
    const gate = new Promise((r) => { release = r; });
    const mm = { indexReferenceFile: async () => {}, pruneReferenceFileIndexesByPrefix: (prefix) => { order.push(prefix); return 0; } };
    const slow = { ...mm, pruneReferenceFileIndexesByPrefix: (prefix) => { order.push('slow:' + prefix); return 0; }, indexReferenceFile: async () => { await gate; } };
    const a = indexProfileRawText(slow, { getActiveProfileContext: undefined });
    const b = indexProfileRawText(mm, { getActiveProfileContext: undefined });
    release(); await Promise.all([a, b]);
    assert.ok(order.lastIndexOf('slow:profile:jd:') < order.indexOf('profile:resume:'), order.join(' '));
  });
});

describe('review fixes to the interleave (2026-09-20)', () => {
  const PARA = 'Tell me about coaching teenagers at the weekend.';
  const R = ['# Résumé', '', ...Array.from({ length: 40 }, (_, i) => `### Project Alder-${i}\n\nRebuilt the billing reconciler for ledger ${i} with a team of ${3 + i} engineers.\n`),
    '### Outside work', '', 'Runs a robotics club for secondary-school pupils on Saturdays at Makerspace Alfama.', ''].join('\n');
  const rdocs = [{ kind: 'resume', sourceId: 'p-r', versionId: 'v1', fileName: 'r.md', structured: { identity: { name: 'A B' }, experience: [{ company: 'X', role: 'Engineer', start_date: '2019-01', end_date: null, bullets: [] }], projects: [], skills: {}, education: [] }, rawText: R }];
  const rport = (rr) => createProfileRetrievalPort({ docs: rdocs, allowedSourceTypes: policy.allowedSourceTypes, profileSources: policy.profileSources, userId: 'u', rawRetriever: rr });
  const HIT = '[context: Outside work] Runs a robotics club for secondary-school pupils on Saturdays at Makerspace Alfama.';
  test('PURE paraphrase: every BM25 raw score is 0, and the arm\'s hit still reaches the evidence (floor above boost-only)', async () => {
    const r = await orchestrate(req(PARA), rport(async () => [{ sourceId: 'p-r', text: HIT, chunkIndex: 41, score: 0.26 }]));
    assert.ok(r.evidence.some((e) => /robotics club/.test(e.content)), r.evidence.map((e) => `${e.finalScore.toFixed(2)} ${e.content.slice(0, 50)}`).join('\n'));
  });
  test('an IRRELEVANT row the retriever was obliged to return is not lifted', async () => {
    const r = await orchestrate(req(PARA), rport(async () => [{ sourceId: 'p-r', text: HIT, chunkIndex: 41, score: 0.5 }, { sourceId: 'p-r', text: '[context: Project Alder-3] Rebuilt the billing reconciler for ledger 3 with a team of 6 engineers. <<obliged>>', chunkIndex: 3, score: 0.12 }]));
    assert.ok(!r.evidence.some((e) => e.content.includes('<<obliged>>') && e.finalScore >= 0.39), 'a 0.12 row was lifted');
  });
  test('the arm has a deadline: a stalled retriever costs the arm, not the turn', async () => {
    const t0 = Date.now();
    const r = await orchestrate(req('How many engineers are on Project Alder-7?'), rport(() => new Promise(() => {})));
    assert.ok(Date.now() - t0 < 3000, `turn took ${Date.now() - t0} ms`);
    assert.ok(r.evidence.some((e) => /Alder-7\b/.test(e.content)), 'BM25 evidence was held back by the stalled arm');
  });
});
