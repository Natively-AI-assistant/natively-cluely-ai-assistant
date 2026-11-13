// electron/context-intelligence/__tests__/WholePackThreshold24k2026_10_09.test.mjs
//
// A reference pack is read whole up to 24,000 tokens (2026-10-09; 12,000 since 2026-10-03).
// Measured on four realistic packs of about 20,700 tokens, 361 questions, deepseek-flash, the bundled embedding
// model: with pieces retrieved the answer was right on 54.3 % of the questions and 48 % of the facts it needed were
// in the request; with the pack read whole 87.0 % and all of them, and a spoken turn's first word came 0.76 s
// earlier (no retrieval, no awaited rerank). The claim pass's material cap moves with the threshold, so the pass
// still sees what the answer saw.
//
// 2026-11-13 (F-LAT-09, live-pipeline forensics): the threshold is 10,000 tokens. At 24,000 the prompt FELL as a
// pack grew past it (a 60k-character file cost 85-92k characters per turn, a 154k one 34-41k). A pack like the
// 20,700-token one below is now RETRIEVED with an evidence budget of the whole-pack size instead of read whole;
// see PackPromptGrowsSmoothly2026_11_13. The measurements above are kept as the record of the trade-off.
//
// Run: npm run build:electron && node --test electron/context-intelligence/__tests__/WholePackThreshold24k2026_10_09.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = (p) => import(pathToFileURL(path.resolve(process.cwd(), 'dist-electron/electron', p)).href);
const { orchestrate, decide, MULTI_FILE_EVIDENCE, WHOLE_PACK_ITEM_OVERHEAD } = await dist('context-intelligence/orchestration/orchestrator.js');
const { MODE_POLICIES } = await dist('context-intelligence/policies/mode-policy-registry.js');
const { createModeRetrievalPort, referenceCorpusTokens, isWholePackCorpus, WHOLE_PACK_MAX_TOKENS, LARGE_PACK_EVIDENCE_TOKENS } = await dist('context-intelligence/retrieval/mode-retrieval-port.js');
const { PROFILE_WHOLE_MAX_TOKENS } = await dist('context-intelligence/retrieval/profile-retrieval-port.js');
const { CLAIM_VERIFIER_MATERIAL_MAX_CHARS } = await dist('llm/claimVerifier.js');

const filler = (n) => 'The quarterly review covered staffing, tooling and the support rota in the usual detail. '.repeat(n);
// Thirteen files, about 1,600 tokens each: a pack of about 20,700 tokens, like the measured ones.
const PACK = Array.from({ length: 13 }, (_, i) => ({
  id: `f${i + 1}`, fileName: `policy-${i + 1}.txt`,
  content: `Policy document ${i + 1}.\n${filler(72)}\n${i === 11 ? 'A camera bought directly can be returned for any reason within 60 days of the delivery date.' : `Section ${i + 1} ends here.`}`,
}));
const PACK_TOKENS = referenceCorpusTokens(PACK);

let seq = 0;
const Q = 'I bought a camera from you three weeks ago. Can I still send it back under the return policy?';
const req = (extra = {}) => ({
  requestId: `t${++seq}`, requestSequence: seq, surface: 'what-to-answer', modeId: 'call-center', scope: { userId: 'local' },
  sessionId: `ts-${seq}`, transcriptQuestion: Q, hasAttachedDocuments: true, attachedSourceCount: PACK.length,
  attachedFileNames: PACK.map((f) => f.fileName), attachedCorpusTokens: PACK_TOKENS, ...extra,
});
const mk = (files, calls) => createModeRetrievalPort({
  modesManager: { retrieveHybridRaw: async () => { calls.n++; return { chunks: [{ sourceId: files[0].id, text: 'one chunk', chunkIndex: 3, score: 0.2 }] }; } },
  modeInfo: { id: 'm1' }, files, tokenBudget: 1800, userId: 'local', allowedSourceTypes: MODE_POLICIES['call-center'].allowedSourceTypes,
});

describe('the threshold', () => {
  test('is 10,000 tokens (24,000 from 2026-10-09 to 2026-11-13)', () => {
    assert.equal(WHOLE_PACK_MAX_TOKENS, 10000);
  });
  test('a pack of about 20,700 tokens no longer fits; one of 10,000 does', () => {
    assert.ok(PACK_TOKENS > 19000 && PACK_TOKENS < 22500, String(PACK_TOKENS));
    assert.equal(isWholePackCorpus(PACK), false);
    assert.equal(isWholePackCorpus([{ content: 'x'.repeat(10000 * 4) }]), true);
    assert.equal(isWholePackCorpus([{ content: 'x'.repeat(10001 * 4) }]), false);
  });
  test('the claim pass is shown a full pack and the whole profile, with room for the rest of the request', () => {
    assert.ok((WHOLE_PACK_MAX_TOKENS + PROFILE_WHOLE_MAX_TOKENS) * 4 + 10_000 <= CLAIM_VERIFIER_MATERIAL_MAX_CHARS);
  });
});

describe('a turn that reads the files, with a 20,700-token pack loaded', () => {
  test('the plan gives the retrieval the whole-pack-size budget', () => {
    const d = decide(req());
    assert.ok(d.retrievalPlan.shouldRetrieve);
    assert.ok((d.retrievalPlan.evidenceTokens ?? 0) >= LARGE_PACK_EVIDENCE_TOKENS, String(d.retrievalPlan.evidenceTokens));
    const baseTokens = Math.max(MODE_POLICIES['call-center'].contextBudget.evidenceTokens, MULTI_FILE_EVIDENCE.tokens);
    assert.ok((d.retrievalPlan.evidenceTokens ?? 0) < baseTokens + PACK_TOKENS, 'not the whole pack');
  });
  test('the retriever is asked, with that budget', async () => {
    const calls = { n: 0, budget: 0 };
    const port = createModeRetrievalPort({
      modesManager: { retrieveHybridRaw: async (_m, _f, o) => { calls.n++; calls.budget = o.tokenBudget; return { chunks: [{ sourceId: PACK[11].id, text: PACK[11].content, chunkIndex: 0, score: 0.9 }] }; } },
      modeInfo: { id: 'm1' }, files: PACK, tokenBudget: 1800, userId: 'local', allowedSourceTypes: MODE_POLICIES['call-center'].allowedSourceTypes,
    });
    const r = await orchestrate(req(), port);
    assert.ok(calls.n >= 1);
    assert.ok(calls.budget >= LARGE_PACK_EVIDENCE_TOKENS, String(calls.budget));
    assert.ok(r.evidence.some((e) => /within 60 days of the delivery date/.test(e.content)));
  });
  test('a pack past 24,000 tokens goes through the retriever too', async () => {
    const calls = { n: 0 };
    const files = PACK.map((f) => ({ ...f, content: f.content + filler(20) }));
    await orchestrate(req({ attachedCorpusTokens: referenceCorpusTokens(files) }), mk(files, calls));
    assert.ok(calls.n >= 1);
  });
});
