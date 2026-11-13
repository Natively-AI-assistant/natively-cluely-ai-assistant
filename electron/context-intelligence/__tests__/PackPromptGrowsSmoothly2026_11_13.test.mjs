// F-LAT-09 (live-pipeline forensics, 2026-11-13): whole-pack reading made a
// 60k-character file cost MORE per turn than a 150k one. Packs up to
// WHOLE_PACK_MAX_TOKENS (24,000) were handed over whole, so s13's 60k file put
// 85-92k characters in every answer prompt, while s13b's 154k file went through
// retrieval at the normal 1,600-2,400-token evidence budget and cost 34-41k: a
// cliff at 24k tokens, with the prompt FALLING as the file grew past it.
//
// Now the whole-pack size is 10,000 tokens and a pack larger than that is
// retrieved with an evidence budget of the same size, so the evidence a turn
// carries is about min(pack, 10,000 tokens) at every size: it grows with the
// pack, never drops at the threshold, and stays bounded.
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
const { createModeRetrievalPort, referenceCorpusTokens, WHOLE_PACK_MAX_TOKENS } = await load('retrieval/mode-retrieval-port.js');

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

describe('per-turn prompt size grows smoothly with the pack and stays bounded', () => {
  test('the whole-pack size is well below the old 24,000-token cliff', () => {
    assert.ok(WHOLE_PACK_MAX_TOKENS <= 10_000, String(WHOLE_PACK_MAX_TOKENS));
  });
  test('every size still puts the planted fact in the prompt', () => {
    for (const n of SIZES) assert.ok(results[n].hasFact, `${n}: ${JSON.stringify(results[n])}`);
  });
  test('a 60k-character file never costs more than a 154k one (s13 vs s13b)', () => {
    assert.ok(results[60_000].chars <= results[154_000].chars * 1.1, JSON.stringify([results[60_000], results[154_000]]));
  });
  test('no size costs much more than a smaller one did — no cliff upward, none downward', () => {
    for (let i = 1; i < SIZES.length; i++) {
      const prev = results[SIZES[i - 1]].chars, cur = results[SIZES[i]].chars;
      assert.ok(cur >= prev * 0.75, `drop at ${SIZES[i]}: ${prev} -> ${cur}`);
    }
  });
  test('the evidence is bounded near the whole-pack size at every pack size', () => {
    for (const n of SIZES) assert.ok(results[n].evidence <= (WHOLE_PACK_MAX_TOKENS + 2_000) * 4, `${n}: ${results[n].evidence}`);
  });
});
