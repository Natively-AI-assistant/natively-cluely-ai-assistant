// F-ACC-03 (live-pipeline forensics, 2026-11-13): V3 graded a fully supported
// document fact PARTIAL. P2-s16b, technical-interview mode in a live meeting,
// "What is the retention window for raw spans in Orion?" with the 14-day
// sentence in the whole pack: answerability=PARTIAL fallback=PARTIAL_SUPPORT.
//
// Cause: answerability groups claim requirements by SUBJECT, and the same clause
// arrived under two spellings. The classifier records a claim's clause from its
// LOWER-CASED question ("what is the retention window…") while claims without a
// clause fall back to the resolved question as asked ("What is the retention
// window…"). One clause became two subjects; the reference file satisfied one,
// the meeting claim alone sat in the other, and a supported fact read PARTIAL.
//
// Run: npm run build:electron && NATIVELY_RAG_LOCAL_RERANK=off node --test electron/context-intelligence/__tests__/SupportedDocFactIsFull2026_11_13.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);
const { orchestrate } = await load('orchestration/orchestrator.js');
const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');
const { createModeRetrievalPort, referenceCorpusTokens } = await load('retrieval/mode-retrieval-port.js');

const filler = (n) => 'The ingest gateway batches spans and forwards them to the query engine with compression. '.repeat(n);
const DOC = `# Orion design\n${filler(300)}\n## Retention\nThe retention window for raw spans is 14 days. Aggregated rollups are kept for 400 days in the cold tier.\n${filler(300)}`;
const FILES = [{ id: 'ref_1', fileName: 'orion-design.md', content: DOC }];
let seq = 0;
const ask = (q, extra = {}) => orchestrate({
  requestId: `r${++seq}`, requestSequence: seq, surface: 'what-to-answer', modeId: 'technical-interview',
  scope: { userId: 'local' }, sessionId: `acc03-${seq}`, transcriptQuestion: q,
  hasAttachedDocuments: true, attachedSourceCount: 1, attachedFileNames: ['orion-design.md'],
  attachedCorpusTokens: referenceCorpusTokens(FILES), inLiveMeeting: true, ...extra,
}, createModeRetrievalPort({
  modesManager: { retrieveHybridRaw: async () => ({ chunks: [] }) }, modeInfo: { id: 'm' }, files: FILES,
  tokenBudget: 1600, userId: 'local', allowedSourceTypes: MODE_POLICIES['technical-interview'].allowedSourceTypes,
}));

describe('a document fact in the pack is FULL, not PARTIAL', () => {
  test('the s16b retention question, live meeting, whole pack', async () => {
    const r = await ask('What is the retention window for raw spans in Orion?');
    assert.ok(r.evidence.some((e) => /14 days/.test(e.content)), 'the fact is in the evidence');
    assert.equal(r.answerability, 'FULL');
  });
  test('a genuinely two-part question still needs both parts', async () => {
    const r = await ask('What is the retention window for raw spans in Orion, and what did my manager at Stripe say about my promotion?');
    assert.notEqual(r.answerability, 'FULL');
  });
  test('a fact the pack does not hold is not upgraded', async () => {
    const r = await ask('What is the hourly billing rate for the Orion contract?');
    assert.notEqual(r.answerability, 'FULL');
  });
});
