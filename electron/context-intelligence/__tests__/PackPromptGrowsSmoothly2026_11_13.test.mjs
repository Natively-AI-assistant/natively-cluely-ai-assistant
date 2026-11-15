// F-LAT-09 (live-pipeline forensics, 2026-11-13; settled 2026-11-14 by a graded
// real-app A/B). Packs up to WHOLE_PACK_MAX_TOKENS (24,000) are read whole: in
// the A/B that kept every needed passage in front of the model and answered
// fastest, where a 10,000 threshold with retrieval lost two-section questions.
// A pack LARGER than that is retrieved, and now with LARGE_PACK_EVIDENCE_TOKENS
// (10,000) instead of the policy's 1,600-2,400: s13b's 154k file carried 34-41k
// characters per turn, and the bigger budget put more of the needed passages
// in (20 of 24 asks against 18 of 24 on a 37k-token pack).
//
// Run: npm run build:electron && NATIVELY_RAG_LOCAL_RERANK=off node --test electron/context-intelligence/__tests__/PackPromptGrowsSmoothly2026_11_13.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);
const { orchestrate } = await load('orchestration/orchestrator.js');
const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');
const { composePrompt } = await load('generation/prompt-composer.js');
const { createModeRetrievalPort, referenceCorpusTokens, WHOLE_PACK_MAX_TOKENS, LARGE_PACK_EVIDENCE_TOKENS } = await load('retrieval/mode-retrieval-port.js');

const MODE = 'technical-interview';
const sentence = (i) => `Section ${i}: the ingest gateway batches spans, compresses them and forwards them to the query engine. `;
/** A pack of about `chars` characters with the planted fact in the middle. */
const pack = (chars) => {
  let s = '# Orion design\n';
  let planted = false;
  for (let i = 0; s.length < chars; i++) {
    s += sentence(i);
    if (!planted && s.length >= chars / 2) { s += '\n## Retention\nThe retention window for raw spans is 14 days.\n'; planted = true; }
  }
  return [{ id: 'ref_orion', fileName: 'orion-design.md', content: s }];
};
/** A retriever that returns the corpus in 2,400-character chunks, the planted one first, inside the asked budget. */
const retriever = (files) => ({
  retrieveHybridRaw: async (_m, _f, opts) => {
    const text = files[0].content;
    const chunks = [];
    for (let i = 0; i < text.length; i += 2400) chunks.push({ sourceId: files[0].id, fileName: files[0].fileName, text: text.slice(i, i + 2400), chunkIndex: i / 2400, score: 0.5 });
    chunks.sort((a, b) => Number(/14 days/.test(b.text)) - Number(/14 days/.test(a.text)));
    const out = []; let used = 0;
    for (const c of chunks.slice(0, opts.topK)) {
      const t = Math.ceil(c.text.length / 4) + (opts.perItemOverheadTokens ?? 0);
      if (used + t > opts.tokenBudget && out.length) break;
      out.push(c); used += t;
    }
    return { chunks: out };
  },
});

let seq = 0;
async function promptFor(chars) {
  const files = pack(chars);
  const policy = MODE_POLICIES[MODE];
  const req = {
    requestId: `r${++seq}`, requestSequence: seq, surface: 'what-to-answer', modeId: MODE, scope: { userId: 'local' },
    sessionId: `lat09-${seq}`, transcriptQuestion: 'What is the retention window for raw spans in the Orion design?',
    hasAttachedDocuments: true, attachedSourceCount: 1, attachedFileNames: [files[0].fileName], attachedCorpusTokens: referenceCorpusTokens(files),
  };
  const r = await orchestrate(req, createModeRetrievalPort({
    modesManager: retriever(files), modeInfo: { id: 'm' }, files, tokenBudget: policy.contextBudget.evidenceTokens,
    userId: 'local', allowedSourceTypes: policy.allowedSourceTypes,
  }));
  const c = composePrompt({ decision: r.decision, policy, evidence: r.evidence, attachedSourceCount: 1 });
  return { chars: c.system.length + c.user.length, evidence: c.packed.evidenceBlock.length, hasFact: /14 days/.test(c.packed.evidenceBlock), tokens: referenceCorpusTokens(files) };
}

const SIZES = [20_000, 40_000, 60_000, 90_000, 154_000];
const results = {};
for (const n of SIZES) results[n] = await promptFor(n);
console.log('[F-LAT-09] prompt chars by pack size:', JSON.stringify(Object.fromEntries(SIZES.map((n) => [n, results[n]]))));

describe('whole up to 24,000 tokens, a bounded larger retrieval above it', () => {
  test('the thresholds', () => {
    assert.equal(WHOLE_PACK_MAX_TOKENS, 24_000);
    assert.equal(LARGE_PACK_EVIDENCE_TOKENS, 10_000);
  });
  test('every size still puts the planted fact in the prompt', () => {
    for (const n of SIZES) assert.ok(results[n].hasFact, `${n}: ${JSON.stringify(results[n])}`);
  });
  test('packs up to 24,000 tokens reach the prompt whole', () => {
    for (const n of SIZES.filter((x) => results[x].tokens <= WHOLE_PACK_MAX_TOKENS)) {
      assert.ok(results[n].evidence >= n * 0.95, `${n}: evidence ${results[n].evidence}`);
    }
  });
  test('a pack above 24,000 tokens is retrieved with the larger budget, and bounded', () => {
    const big = results[154_000];
    assert.ok(big.tokens > WHOLE_PACK_MAX_TOKENS);
    // The old policy budget (1,600-2,400 tokens) carried under about 10k characters of evidence.
    assert.ok(big.evidence > 6_000 * 4, `evidence ${big.evidence}`);
    assert.ok(big.evidence <= (LARGE_PACK_EVIDENCE_TOKENS + 2_000) * 4, `evidence ${big.evidence}`);
  });
});
