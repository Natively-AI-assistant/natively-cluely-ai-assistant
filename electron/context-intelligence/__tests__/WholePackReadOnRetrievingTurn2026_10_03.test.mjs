// A pack that fits the prompt is read whole when a turn reads the files (2026-10-03).
//
// Measured on the evidence-rich benchmark: nine modes, each holding a realistic
// pack of 6–9 files (2,300–9,800 tokens) uploaded as PDF / DOCX / text. Every
// file parsed and indexed, and the fact the answer needed was in the prompt on
// 99 of 199 reference-file turns: a turn packs at most 8 passages and
// 1,500–2,400 evidence tokens, and the retriever had offered more candidates
// than were packed on 92 of the 111 turns that missed.
//
// Between SMALL_CORPUS_MAX_TOKENS and WHOLE_PACK_MAX_TOKENS the port now hands
// every file over entire on a turn that retrieves; the plan's item cap grows
// by the file count and its token budget by the pack size, on top of what the
// turn had. (Until 2026-10-04 a FAST turn read nothing from a pack this size; it now reads it.)

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = (p) => import(pathToFileURL(path.resolve(process.cwd(), 'dist-electron/electron', p)).href);
const { orchestrate, decide, MULTI_FILE_EVIDENCE, WHOLE_PACK_ITEM_OVERHEAD } = await dist('context-intelligence/orchestration/orchestrator.js');
const { MODE_POLICIES } = await dist('context-intelligence/policies/mode-policy-registry.js');
const { createModeRetrievalPort, referenceCorpusTokens, isSmallReferenceCorpus, isWholePackCorpus, SMALL_CORPUS_MAX_TOKENS, WHOLE_PACK_MAX_TOKENS } = await dist('context-intelligence/retrieval/mode-retrieval-port.js');

const filler = (n) => 'The quarterly review covered staffing, tooling and the support rota in the usual detail. '.repeat(n);
// Nine files, about 1,000 tokens each: a pack of ~9,000 tokens, like the measured ones.
const PACK = Array.from({ length: 9 }, (_, i) => ({
  id: `f${i + 1}`, fileName: `policy-${i + 1}.txt`,
  content: `Policy document ${i + 1}.\n${filler(42)}\n${i === 6 ? 'A camera bought directly can be returned for any reason within 60 days of the delivery date.' : `Section ${i + 1} ends here.`}`,
}));
const PACK_TOKENS = referenceCorpusTokens(PACK);

let seq = 0;
const req = (modeId, q, extra = {}) => ({
  requestId: `w${++seq}`, requestSequence: seq, surface: 'what-to-answer', modeId, scope: { userId: 'local' },
  sessionId: `ws-${seq}`, transcriptQuestion: q, hasAttachedDocuments: true, attachedSourceCount: PACK.length,
  attachedFileNames: PACK.map((f) => f.fileName), attachedCorpusTokens: PACK_TOKENS, ...extra,
});
const mk = (files, calls, modeId = 'call-center') => createModeRetrievalPort({
  modesManager: { retrieveHybridRaw: async () => { calls.n++; return { chunks: [{ sourceId: files[0].id, text: 'one chunk', chunkIndex: 3, score: 0.2 }] }; } },
  modeInfo: { id: 'm1' }, files, tokenBudget: 1800, userId: 'local', allowedSourceTypes: MODE_POLICIES[modeId].allowedSourceTypes,
});

describe('pack size', () => {
  test('the measured pack is not small, and fits', () => {
    assert.ok(PACK_TOKENS > SMALL_CORPUS_MAX_TOKENS && PACK_TOKENS <= WHOLE_PACK_MAX_TOKENS, String(PACK_TOKENS));
    assert.equal(isSmallReferenceCorpus(PACK), false);
    assert.equal(isWholePackCorpus(PACK), true);
  });
  test('boundary, and unknown size', () => {
    assert.equal(isWholePackCorpus([{ content: 'x'.repeat(WHOLE_PACK_MAX_TOKENS * 4) }]), true);
    assert.equal(isWholePackCorpus([{ content: 'x'.repeat(WHOLE_PACK_MAX_TOKENS * 4 + 8) }]), false);
    assert.equal(isWholePackCorpus([{ content: 'abcd' }, { content: '  ' }]), false, 'a file with no text yet: size unknown');
    assert.equal(isWholePackCorpus([]), false);
  });
});

describe('decide(): the plan makes room for the whole pack on a turn that retrieves', () => {
  const Q = 'I bought a camera from you three weeks ago. Can I still send it back under the return policy?';
  test('item cap = the turn\'s own cap + one per file; budget = the turn\'s own budget + the pack', () => {
    const d = decide(req('call-center', Q));
    assert.ok(d.retrievalPlan.shouldRetrieve);
    const baseCap = Math.max(MODE_POLICIES['call-center'].retrievalPolicy.maximumAcceptedEvidence, MULTI_FILE_EVIDENCE.accepted);
    assert.ok(d.retrievalPlan.maximumAcceptedEvidence >= baseCap + PACK.length, String(d.retrievalPlan.maximumAcceptedEvidence));
    const baseTokens = Math.max(MODE_POLICIES['call-center'].contextBudget.evidenceTokens, MULTI_FILE_EVIDENCE.tokens);
    assert.ok((d.retrievalPlan.evidenceTokens ?? 0) >= baseTokens + PACK_TOKENS + WHOLE_PACK_ITEM_OVERHEAD * PACK.length, String(d.retrievalPlan.evidenceTokens));
  });
  test('a pack larger than the threshold changes nothing in the plan', () => {
    const big = decide(req('call-center', Q, { attachedCorpusTokens: WHOLE_PACK_MAX_TOKENS + 1 }));
    const none = decide(req('call-center', Q, { attachedCorpusTokens: null }));
    assert.equal(big.retrievalPlan.maximumAcceptedEvidence, none.retrievalPlan.maximumAcceptedEvidence);
    assert.equal(big.retrievalPlan.evidenceTokens, none.retrievalPlan.evidenceTokens);
  });
  test('a small corpus keeps exactly the plan it had', () => {
    const d = decide(req('team-meet', "What's the crash-free bar?", { attachedSourceCount: 1, attachedCorpusTokens: 180 }));
    assert.equal(d.retrievalPlan.maximumAcceptedEvidence, MODE_POLICIES['team-meet'].retrievalPolicy.maximumAcceptedEvidence);
  });
  // 2026-10-04: reversed. Ten of 333 benchmark turns on main read nothing from a loaded pack because the classifier
  // answered them from general knowledge; such a turn now reads a pack that fits (LoadedPackReachesEveryTurn2026_10_04).
  test('a general-knowledge turn reads a pack this size too, with the same room', () => {
    for (const modeId of ['general', 'sales', 'team-meet', 'call-center']) {
      const d = decide(req(modeId, 'What is a mutex?'));
      assert.equal(d.retrievalPlan.shouldRetrieve, true, modeId);
      assert.ok(d.retrievalPlan.sourceTypes.includes('REFERENCE_FILE'), modeId);
      assert.ok(d.retrievalPlan.evidenceTokens >= PACK_TOKENS, modeId);
    }
  });
  test('profile-only documents are not a pack', () => {
    const d = decide(req('looking-for-work', 'Walk me through your last project', { attachedSourceCount: 0, profileOnlyDocuments: true, attachedCorpusTokens: 0 }));
    assert.equal(d.retrievalPlan.maximumAcceptedEvidence, MODE_POLICIES['looking-for-work'].retrievalPolicy.maximumAcceptedEvidence);
  });
});

describe('orchestrate(): every file of the pack reaches the evidence, and the retriever is not asked', () => {
  const Q = 'I bought a camera from you three weeks ago. Can I still send it back under the return policy?';
  test('nine files in, nine files packed, the answering line among them', async () => {
    const calls = { n: 0 };
    const r = await orchestrate(req('call-center', Q), mk(PACK, calls));
    assert.equal(calls.n, 0, 'no hybrid retrieval (no embed / rerank round trip)');
    const ids = new Set(r.evidence.filter((e) => e.sourceType !== 'MEETING_TRANSCRIPT').map((e) => e.sourceId));
    assert.equal(ids.size, PACK.length, JSON.stringify([...ids]));
    assert.ok(r.evidence.some((e) => /within 60 days of the delivery date/.test(e.content)), 'the 7th file, whole');
  });
  test('a pack past the threshold goes through the retriever as before', async () => {
    const calls = { n: 0 };
    const files = PACK.map((f) => ({ ...f, content: f.content + filler(60) })); // ~22,000 tokens
    assert.equal(isWholePackCorpus(files), false);
    await orchestrate(req('call-center', Q, { attachedCorpusTokens: referenceCorpusTokens(files) }), mk(files, calls));
    assert.ok(calls.n >= 1);
  });
  test('opt-out flag keeps retrieval', async () => {
    const calls = { n: 0 };
    const port = createModeRetrievalPort({
      modesManager: { retrieveHybridRaw: async () => { calls.n++; return { chunks: [] }; } },
      modeInfo: { id: 'm1' }, files: PACK, tokenBudget: 1800, userId: 'local', wholeSmallCorpus: false,
    });
    await port.retrieve?.({ decision: decide(req('call-center', Q)) });
    assert.ok(calls.n >= 1);
  });
});
