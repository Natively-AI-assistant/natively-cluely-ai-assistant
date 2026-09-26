// Test Connection must measure the workload production actually runs (2026-09-14).
//
// describeRerankLatencyFit is the ONLY place the app tells a user their reranker
// is too slow to affect answers ("Measured at 2052ms, over the 1200ms live
// budget"). It judges the latency the Test Connection probe measured — and that
// probe sent THREE SHORT SENTENCES:
//
//     'Paris is the capital and most populous city of France.'
//     'The Rhine is a river in Central and Western Europe.'
//     'Photosynthesis converts light energy into chemical energy.'
//
// Production sends up to RERANK_CANDIDATE_POOL chunks of ~225 tokens each, in
// ONE call for every hosted port (batchSize = MAX_SAFE_INTEGER). A hosted model
// that probes at 900ms on three sentences can comfortably blow the 3000ms live
// budget on the real pool — and the user was told it fits. The fit warning was
// calibrated against a workload nothing ever runs.
//
// Second defect in the same probe: the answer-bearing document was at index 0
// and the check was `rankedFirst === 0`, so a reranker that returned its input
// order unchanged — the exact failure a ranking check exists to catch — passed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(process.cwd());
const { buildRerankProbe } = require(
  path.join(repoRoot, 'dist-electron/electron/services/reranking/rerankProbe.js'));
const { RERANK_CANDIDATE_POOL } = require(
  path.join(repoRoot, 'dist-electron/electron/services/modes/rerankPool.js'));

const words = (s) => s.trim().split(/\s+/).length;

describe('the probe is the production workload', () => {
  test('it sends as many passages as the pool it is measuring', () => {
    assert.equal(buildRerankProbe(RERANK_CANDIDATE_POOL).documents.length, RERANK_CANDIDATE_POOL);
    assert.equal(buildRerankProbe(5).documents.length, 5);
  });

  test('passages are production length, not one-liners', () => {
    // Production chunks measure ~225 tokens (semanticChunker: merge floor ~100,
    // soft target ~350). A probe passage below ~150 words measures nothing the
    // real pool will cost.
    for (const doc of buildRerankProbe(RERANK_CANDIDATE_POOL).documents) {
      assert.ok(words(doc) >= 150,
        `probe passage is ${words(doc)} words; production chunks are ~170: ${doc.slice(0, 70)}…`);
    }
  });

  test('a pool of 1 still carries the answer', () => {
    const probe = buildRerankProbe(1);
    assert.equal(probe.documents.length, 1);
    assert.equal(probe.expectedIndex, 0);
  });

  test('it is deterministic — two runs are comparable measurements', () => {
    assert.deepEqual(buildRerankProbe(12), buildRerankProbe(12));
  });
});

describe('the ranking check cannot be passed by doing nothing', () => {
  test('the answer is not the first document', () => {
    const probe = buildRerankProbe(RERANK_CANDIDATE_POOL);
    assert.ok(probe.expectedIndex > 0,
      'with the answer at index 0, a reranker returning its input order unchanged '
      + 'scores rankedExpectedFirst: true');
  });

  test('exactly one document answers the query', () => {
    const probe = buildRerankProbe(RERANK_CANDIDATE_POOL);
    const answering = probe.documents.filter((d) => /\bParis\b/.test(d));
    assert.equal(answering.length, 1, 'a second answer-bearing passage makes the check ambiguous');
    assert.equal(probe.documents.indexOf(answering[0]), probe.expectedIndex);
  });

  test('the query is still a question with one obvious right answer', () => {
    assert.match(buildRerankProbe(3).query, /capital/i);
  });
});

describe('the handler uses it', () => {
  const ipc = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
  // ONLY the reranker:test handler. The local-model ACTIVATION self-test
  // further down also ranks two sentences, and correctly so: it asks "did the
  // model load and return usable scores", and its latency feeds no warning.
  const start = ipc.indexOf("safeHandle('reranker:test'");
  assert.ok(start > 0, 'the reranker:test handler must still exist');
  const end = ipc.indexOf('safeHandle(', start + 20);
  const code = ipc.slice(start, end > 0 ? end : undefined)
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  test('reranker:test builds its payload from the probe, sized by the real pool', () => {
    assert.match(code, /buildRerankProbe\(resolveRerankPoolSize\(\)\)/);
    assert.ok(!/'Paris is the capital and most populous city of France\.'/.test(code),
      'the three-sentence payload must be gone from the handler');
  });

  test('the ranking verdict compares against the probe expectation, not 0', () => {
    assert.ok(!/rankedFirst === 0/.test(code),
      'hardcoding index 0 is what let an identity-order reranker pass');
    assert.match(code, /rankedExpectedFirst: rankedFirst === (probe\.)?expectedIndex/);
  });
});
