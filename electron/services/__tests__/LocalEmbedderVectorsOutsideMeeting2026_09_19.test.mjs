// The bundled embedder's vectors are queried when NO meeting is running
// (2026-09-19, owner's decision). The 2026-07-09 hotfix forced lexical-only
// retrieval for the local provider to avoid ONNX pressure stacked with local STT
// during a live meeting — but under forceDocumentGrounding `hasTranscript` is
// always false, so it applied to EVERY V3 turn and a key-less user's vectors were
// built and never queried (offline, 70k tokens: 149 vs 160 of 162).

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron', p)).href);
const { ModeHybridRetriever } = await dist('services/modes/ModeHybridRetriever.js');
const { createModeRetrievalPort } = await dist('context-intelligence/retrieval/mode-retrieval-port.js');
const { decide } = await dist('context-intelligence/orchestration/orchestrator.js');
const { resolveModePolicy } = await dist('context-intelligence/policies/mode-policy-registry.js');

const DOC = ['# Notes', '', '## Retention', '', 'Audit logs are retained for 400 days; debug logs for 21 days.', '', '## Expenses', '', 'Employees may expense up to 85 euros per month for home internet.', ''].join('\n');
const FILES = [{ id: 'f', modeId: 'm', fileName: 'notes.md', content: DOC, createdAt: new Date().toISOString() }];
function retriever(provider) {
  const embeds = { query: 0 };
  const hr = new ModeHybridRetriever(
    { prepare: mock.fn(() => ({ get: mock.fn(() => null), all: mock.fn(() => []), run: mock.fn() })), exec: mock.fn(() => {}) },
    { searchSimilar: async () => [], hasEmbeddings: () => false },
    { isReady: () => true, getActiveProviderName: () => provider, getActiveSpaceKey: () => `${provider}:x:4`,
      getEmbeddingForQuery: async () => { embeds.query++; return [1, 0, 0, 0]; }, getEmbedding: async () => [1, 0, 0, 0],
      getEmbeddingsWithFallback: async (t) => ({ embeddings: t.map(() => [1, 0, 0, 0]), space: `${provider}:x:4` }) });
  return { hr, embeds };
}
const ask = (hr, meetingActive) => hr.retrieve({ query: 'how long are audit logs kept', modeId: 'm', files: FILES, tokenBudget: 1500, topK: 20, forceDocumentGrounding: true, allowRerank: false, ...(meetingActive === undefined ? {} : { meetingActive }) });

describe('local provider', () => {
  test('meeting running → lexical-only, no query embed (the hotfix stands)', async () => {
    const { hr, embeds } = retriever('local');
    const r = await ask(hr, true);
    assert.equal(r.usedHybrid, false); assert.equal(embeds.query, 0);
  });
  test('UNKNOWN meeting state → still lexical-only (conservative default)', async () => {
    const { hr, embeds } = retriever('local');
    const r = await ask(hr, undefined);
    assert.equal(r.usedHybrid, false); assert.equal(embeds.query, 0);
  });
  test('explicitly NO meeting → the vectors are queried', async () => {
    const { hr, embeds } = retriever('local');
    const r = await ask(hr, false);
    assert.equal(r.usedHybrid, true); assert.ok(embeds.query > 0);
  });
});

test('a hosted provider is unaffected by the flag either way', async () => {
  for (const state of [true, false, undefined]) {
    const { hr } = retriever('natively');
    assert.equal((await ask(hr, state)).usedHybrid, true, `meetingActive=${state}`);
  }
});

describe('mode port forwards the state, read at RETRIEVAL time', () => {
  const policy = resolveModePolicy('general');
  const d = decide({ requestId: 'r', requestSequence: 1, surface: 'manual_chat', modeId: 'general', scope: { userId: 'u' }, sessionId: 's', manualQuestion: 'How long are audit logs retained?', hasAttachedDocuments: true, attachedFileNames: ['notes.md'] });
  const build = (meetingActive) => {
    const box = { seen: 'never-called' };
    const port = createModeRetrievalPort({ modesManager: { retrieveHybridRaw: async (_m, _f, o) => { box.seen = o.meetingActive; return { chunks: [] }; } }, modeInfo: { id: 'm' }, files: FILES, allowedSourceTypes: policy.allowedSourceTypes, tokenBudget: 1500, userId: 'u', ...(meetingActive ? { meetingActive } : {}) });
    return { port, box };
  };
  const seenWith = async (meetingActive) => { const { port, box } = build(meetingActive); await port.retrieve({ decision: d }); return box.seen; };
  test('a function is evaluated when the turn retrieves, not when the port is built', async () => {
    let live = true;                       // the live engine resolves this AFTER building the port
    const { port, box } = build(() => live);
    live = false;                          // …and only then does the turn retrieve
    await port.retrieve({ decision: d });
    assert.equal(box.seen, false);
  });
  test('absent → not forwarded (unknown); a throwing function → treated as a meeting', async () => {
    assert.equal(await seenWith(undefined), undefined);
    assert.equal(await seenWith(() => { throw new Error('tdz'); }), true);
  });
});
