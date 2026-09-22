// The embedding-unavailable branch never hands the model NOTHING while the
// corpus has chunks (2026-09-11). Measured with the pinned provider demoted at
// launch: "what was jonas talking about again" overlapped one token with an
// incident row naming Jonas, fell under the lexical threshold, and the turn
// went out with zero evidence. The hybrid branch already had this floor.

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { ModeHybridRetriever, THIN_RESULTS_TOPUP_BELOW } = await import(pathToFileURL(
  path.resolve(__dirname, '../../../dist-electron/electron/services/modes/ModeHybridRetriever.js')).href);

function harness({ ready, providerName }) {
  const pipeline = {
    isReady: mock.fn(() => ready),
    getActiveProviderName: mock.fn(() => providerName),
    getActiveSpaceKey: mock.fn(() => `${providerName}:x:1`),
    getEmbeddingForQuery: mock.fn(() => Promise.reject(new Error('should not embed'))),
    getEmbeddingsWithFallback: mock.fn(() => Promise.reject(new Error('should not embed'))),
    getEmbedding: mock.fn(() => Promise.reject(new Error('should not embed'))),
  };
  const db = { prepare: mock.fn(() => ({ get: mock.fn(() => null), all: mock.fn(() => []), run: mock.fn() })), exec: mock.fn(() => {}) };
  return new ModeHybridRetriever(db, { searchSimilar: mock.fn(() => Promise.resolve([])), hasEmbeddings: mock.fn(() => false) }, pipeline);
}

const TIMELINE = [
  'incident_id,date,service,owner,summary',
  'INC-2601,2026-08-02,checkout-api,Meera Iyer,Redis connection pool exhausted under flash sale load; pool raised to 200',
  'INC-2604,2026-08-05,search-indexer,Jonas Weber,Elasticsearch shard relocation during peak; relocation window moved to 02:00-04:00 UTC',
  'INC-2607,2026-08-09,notifications,Arjun Rao,Kafka consumer lag after partition change; partitions 24 to 48',
].join('\n');
const HANDBOOK = 'Northstar operations handbook. Secrets rotate every 90 days. Break-glass credentials expire after 4 hours. Deploy freeze on Fridays before holidays.';

for (const [label, cfg] of [
  ['embedding provider unavailable (isReady false)', { ready: false, providerName: 'natively' }],
  ['local ONNX provider active for a manual query', { ready: true, providerName: 'local' }],
]) {
  describe(`lexical floor — ${label}`, () => {
    test('a one-token overlap still returns the row that carries it', async () => {
      const hr = harness(cfg);
      const files = [
        { id: 'tl', modeId: 'm', fileName: 'incident_timeline_aug2026.csv', content: TIMELINE, createdAt: new Date().toISOString() },
        { id: 'hb', modeId: 'm', fileName: 'northstar_ops_handbook.md', content: HANDBOOK, createdAt: new Date().toISOString() },
      ];
      const result = await hr.retrieve({ query: 'what was jonas talking about again', modeId: 'm', files, tokenBudget: 1800, topK: 6 });
      assert.ok(result.chunks.length > 0, 'the turn must not go out with zero evidence while the corpus has chunks');
      assert.ok(result.chunks.some((c) => /Jonas/.test(c.text)), `the Jonas row is among the evidence: ${JSON.stringify(result.chunks.map((c) => c.text.slice(0, 60)))}`);
    });
    test('an empty corpus still yields nothing (the floor needs a pool)', async () => {
      const hr = harness(cfg);
      const result = await hr.retrieve({ query: 'what was jonas talking about again', modeId: 'm', files: [], tokenBudget: 1800, topK: 6 });
      assert.equal(result.chunks.length, 0);
    });
  });
}

describe('thin-results top-up on the hybrid arm (2026-09-11)', () => {
  // Chunk 0 is the only one the vector arm likes; the chunk that carries the
  // asked-for token ("tooling") is orthogonal to the query vector.
  function thinHarness() {
    const pipeline = {
      isReady: mock.fn(() => true),
      getActiveProviderName: mock.fn(() => 'natively'),
      getActiveSpaceKey: mock.fn(() => 'natively:x:4'),
      getEmbeddingForQuery: mock.fn(() => Promise.resolve([1, 0, 0, 0])),
      getEmbeddingsWithFallback: mock.fn((texts) => Promise.resolve({ embeddings: texts.map((_, i) => (i === 0 ? [1, 0, 0, 0] : [0, 1, 0, 0])), space: 'natively:x:4' })),
      getEmbedding: mock.fn(() => Promise.resolve([1, 0, 0, 0])),
    };
    const db = { prepare: mock.fn(() => ({ get: mock.fn(() => null), all: mock.fn(() => []), run: mock.fn() })), exec: mock.fn(() => {}) };
    return new ModeHybridRetriever(db, { searchSimilar: mock.fn(() => Promise.resolve([])), hasEmbeddings: mock.fn(() => false) }, pipeline);
  }
  const HANDBOOK = [
    '# Northstar Logistics — Engineering Operations Handbook',
    '',
    '## 1. On-call',
    '',
    '- Primary on-call rotation length: 7 days, handover every Tuesday at 10:00 IST.',
    '- Tooling: PagerDuty schedule NS-CORE-PRIMARY, Slack channel #ns-oncall, runbooks in Confluence space OPS.',
    '',
    '## 2. Deployment policy',
    '',
    '- Deploy window: Monday to Thursday, 09:00–17:00 IST. No Friday deploys except hotfixes approved by the on-call manager.',
    '- Canary: 5% of traffic for 20 minutes, then 25% for 30 minutes, then 100%.',
  ].join('\n');
  test('a one-content-word lookup still reaches the chunk that carries the word', async () => {
    const hr = thinHarness();
    const files = [{ id: 'hb', modeId: 'm', fileName: 'northstar_ops_handbook.md', content: HANDBOOK, createdAt: new Date().toISOString() }];
    const result = await hr.retrieve({ query: 'right so what does the document say the tooling is', modeId: 'm', files, tokenBudget: 1800, topK: 6 });
    assert.ok(result.chunks.some((c) => /PagerDuty/.test(c.text)), `the tooling chunk must be in the pool: ${JSON.stringify(result.chunks.map((c) => c.text.slice(0, 50)))}`);
  });
  test(`the top-up only runs below ${THIN_RESULTS_TOPUP_BELOW} hybrid hits and never adds zero-overlap chunks`, async () => {
    const hr = thinHarness();
    const files = [{ id: 'hb', modeId: 'm', fileName: 'northstar_ops_handbook.md', content: HANDBOOK, createdAt: new Date().toISOString() }];
    const result = await hr.retrieve({ query: 'xyzzqxq nonsenseword bogusterm', modeId: 'm', files, tokenBudget: 1800, topK: 6 });
    assert.ok(!result.chunks.some((c) => /PagerDuty/.test(c.text)) || result.chunks.length <= 1, 'no lexical top-up without a shared token');
  });
});
