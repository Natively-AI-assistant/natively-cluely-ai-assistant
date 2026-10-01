// The meeting retrieval port bounds its query embedding by the turn's
// retrieval budget (live 2026-09-27, looking for work): a stalled embed
// endpoint retried 3 times with backoff and one live answer waited 11 s on
// meeting retrieval, while the mode port gave up after one attempt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron');
const load = (p) => import(pathToFileURL(path.join(base, 'context-intelligence', p)).href);
const require = createRequire(import.meta.url);
const { createMeetingRetrievalPort } = await load('retrieval/meeting-retrieval-port.js');
const { decide } = await load('orchestration/orchestrator.js');
const { RAGRetriever } = require(path.join(base, 'rag/RAGRetriever.js'));

const meetingDecision = () => decide({
  requestId: 'p', requestSequence: 1, surface: 'manual_chat', modeId: 'team-meet',
  scope: { userId: 'u', modeId: 'team-meet', meetingId: 'm1' }, sessionId: 's',
  manualQuestion: 'What did we decide about the rollout?',
});

test('the port hands the retrieval budget to the retriever', async () => {
  const seen = [];
  const port = createMeetingRetrievalPort({
    retriever: { retrieve: async (_q, opts) => { seen.push(opts); return { chunks: [] }; } },
    currentMeetingId: 'm1', userId: 'u', tokenBudget: 2000,
  });
  const decision = meetingDecision();
  await port.retrieve({ decision });
  assert.ok(seen.length >= 1);
  assert.equal(seen[0].queryEmbedRetryBudgetMs, decision.retrievalPlan.timeoutMs);
});

test('the retriever passes the budget to the query embedding (and omits it when absent)', async () => {
  const embedOpts = [];
  const pipeline = { getEmbeddingForQuery: async (_t, o) => { embedOpts.push(o); return [0.1, 0.2]; }, getActiveSpaceKey: () => 'x' };
  const store = { searchSimilar: async () => [] };
  const r = new RAGRetriever(store, pipeline);
  await r.retrieve('what did we decide', { meetingId: 'm1', queryEmbedRetryBudgetMs: 1200 });
  await r.retrieve('what did we decide', { meetingId: 'm1' });
  assert.deepEqual(embedOpts[0], { retryBudgetMs: 1200 });
  assert.equal(embedOpts[1], undefined, 'no budget → the historical ladder, unchanged');
});
