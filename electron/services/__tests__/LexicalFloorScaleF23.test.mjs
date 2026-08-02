// F23 regression — the lexical fallback must not reuse the COMBINED-score floor.
//
// `combinedScore = FTS_WEIGHT * fts + (1 - FTS_WEIGHT) * vector`, so a bare
// ftsScore and a combined score are on different scales. Filtering
// `ftsScore >= MIN_COMBINED_SCORE` required the lexical arm alone to clear a bar
// calibrated for lexical AND vector together.
//
// Measured consequence: on a resume question whose answer IS in the corpus
// ("How many retailers did PriceX cover?") the retriever produced
// fts = 0.109 / vector = 0.478 / combined = 0.330 — comfortably above the 0.15
// combined floor — and the lexical path still returned ZERO chunks, reporting
// topScore 0 and reasons ["no_candidates","lexical_degraded"]. Every keyless
// install (bundled local embedder, no cloud key) therefore had silently inert
// reference files on manual questions.
//
// The crash mitigation that routes local-provider manual turns to lexical
// (hotfix 2026-07-09, ONNX arena pressure) is deliberately NOT reverted here.
// Only the mis-scaled threshold is corrected.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const { ModeHybridRetriever } = await import(
  path.resolve(process.cwd(), 'dist-electron/electron/services/modes/ModeHybridRetriever.js')
);

const P = ModeHybridRetriever.prototype;

// Mirrors ModeHybridRetriever.wordsOf.
const wordsOf = (t) => String(t).toLowerCase()
  .replace(/['’]s\b/g, '').replace(/['’]/g, '')
  .replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2);

const candidate = (text) => ({ sourceId: 'f1', fileName: 'lfw_resume.txt', text, chunkIndex: 0, ftsScore: 0, vectorScore: 0 });

describe('F23 — lexical floor is on the lexical scale', () => {
  // The exact text and query that produced the zero-result failure.
  const RESUME = 'Evin J — Resume Summary Senior product engineer with 8 years experience across '
    + 'consumer and developer tooling. Built PriceX, a price-comparison website; scaled Natively to '
    + '10k users in the first 90 days. Founder, PriceX (2022–2024). Price-comparison website '
    + 'covering 14 retailers; sold to a strategic acquirer.';
  const QUERY = 'How many retailers did PriceX cover?';

  test('the real fts score for this pair is BELOW the combined floor', () => {
    const fts = P.computeFtsScore.call({}, RESUME, new Set(wordsOf(QUERY)));
    assert.ok(fts > 0, 'the chunk does match lexically');
    assert.ok(fts < 0.15, `fts ${fts.toFixed(3)} must be below MIN_COMBINED_SCORE for this test to mean anything`);
  });

  test('lexical retrieval ADMITS it at the default floor', () => {
    const out = P.performLexicalRetrieval.call(
      { computeFtsScore: P.computeFtsScore },
      [candidate(RESUME)],
      new Set(wordsOf(QUERY)),
    );
    assert.equal(out.length, 1,
      'a genuine lexical match must not be rejected by a threshold meant for combined scores');
  });

  test('noise is still rejected — the floor was corrected, not removed', () => {
    const out = P.performLexicalRetrieval.call(
      { computeFtsScore: P.computeFtsScore },
      [candidate('Completely unrelated content about gardening and weather patterns.')],
      new Set(wordsOf(QUERY)),
    );
    assert.equal(out.length, 0, 'a zero-overlap chunk must still be dropped');
  });

  test('an explicit combined-scale threshold is converted, not applied raw', () => {
    // Passing the combined-scale floor explicitly must behave like the default,
    // not re-introduce the bug at the call sites.
    const admitted = P.performLexicalRetrieval.call(
      { computeFtsScore: P.computeFtsScore },
      [candidate(RESUME)],
      new Set(wordsOf(QUERY)),
      0.15 * 0.4,
    );
    assert.equal(admitted.length, 1);
  });
});
