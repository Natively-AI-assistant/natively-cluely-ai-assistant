/**
 * What the catalogue RECOMMENDS has to follow what was measured.
 *
 * The catalogue recommended `bge-reranker-v2-m3-q4km` and nothing else. Against
 * a no-reranker baseline over 24 queries on a 40-passage pool with same-topic
 * distractors (docs/reranker-benchmark-2026-09-04.md) it scored MRR 0.8618
 * against the baseline's 0.8368 — the second-weakest working model in the
 * catalogue, and it moved three queries DOWN. It was chosen before any
 * benchmark existed, which is exactly what the architecture doc's rule
 * ("promotion to recommended requires a benchmark run") is meant to prevent.
 *
 * These assertions pin the OUTCOME of that run, so a future edit that promotes
 * a model on vibes has to delete a test that names numbers.
 *
 * Run: `node --test electron/services/__tests__/RerankerRecommendationFollowsTheBenchmark2026_09_04.test.mjs`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const { RERANKER_MODEL_CATALOG, findCatalogModel } =
  require(path.join(repoRoot, 'dist-electron/electron/rag/rerankerModelCatalog.js'));
const panel = fs.readFileSync(path.join(repoRoot, 'src/components/settings/RerankerSettings.tsx'), 'utf8');

/** MRR measured against a 0.8368 no-reranker baseline. Lower is worse. */
const MEASURED_MRR = {
  'jina-reranker-v3.5-q4km': 0.9514,
  'ettin-reranker-68m': 0.9205,
  'qwen3-reranker-0.6b-q4km': 0.9201,
  'jina-reranker-v2-multilingual': 0.9167,
  'ettin-reranker-150m': 0.9125,
  'ms-marco-minilm-l6': 0.8688,
  'bge-reranker-v2-m3-q4km': 0.8618,
  'bge-reranker-large': 0.8469,
  'mxbai-rerank-xsmall': 0.8394,
  'ettin-reranker-32m': 0.8299,
  // Not a catalogue entry — the BUNDLED default, which an empty selection
  // resolves to. Measured through the same sweep (`run-one.mjs builtin`).
  'Xenova/bge-reranker-base': 0.7558,
};
const BASELINE_MRR = 0.8368;

const recommended = () => RERANKER_MODEL_CATALOG.filter(m => m.recommended && m.supported);

test('every recommended model actually beat doing nothing', () => {
  // The floor. A model that loses to no reranker at all cannot carry a badge
  // telling people to download it.
  for (const m of recommended()) {
    const mrr = MEASURED_MRR[m.id];
    assert.ok(mrr !== undefined, `${m.id} is recommended but was never benchmarked`);
    assert.ok(mrr > BASELINE_MRR,
      `${m.id} scored MRR ${mrr} against a ${BASELINE_MRR} baseline — worse than no reranker`);
  }
});

test('nothing is recommended while a clearly better model of the same licence is not', () => {
  // The actual defect: bge-reranker-v2-m3 recommended at 0.8618 while
  // ettin-68m sat at 0.9205 under the same Apache licence, unrecommended.
  for (const m of recommended()) {
    const mine = MEASURED_MRR[m.id];
    const restricted = m.license.commercialUseRestricted;
    for (const other of RERANKER_MODEL_CATALOG) {
      if (other.id === m.id || !other.supported || other.recommended) continue;
      const theirs = MEASURED_MRR[other.id];
      if (theirs === undefined) continue;
      // Only compare within the same licence class: a stronger non-commercial
      // model is not an argument against recommending a commercial one.
      if (Boolean(other.license.commercialUseRestricted) !== Boolean(restricted)) continue;
      assert.ok(theirs <= mine,
        `${other.id} (MRR ${theirs}) beats recommended ${m.id} (MRR ${mine}) under the same licence`);
    }
  }
});

test('the specific models the benchmark chose', () => {
  const ids = recommended().map(m => m.id).sort();
  assert.deepEqual(ids, ['ettin-reranker-68m', 'jina-reranker-v3.5-q4km'],
    'the strongest local model, and the strongest one that is not licence-restricted');

  // And the one that was wrong is no longer carrying the badge.
  // `=== false`, not merely falsy: for these two the absence has to be a
  // recorded decision, because both are plausible-looking models somebody
  // would otherwise promote back.
  assert.equal(findCatalogModel('bge-reranker-v2-m3-q4km').recommended, false,
    'it measured second-weakest and moved three queries down');
  assert.equal(findCatalogModel('ettin-reranker-32m').recommended, false,
    'it is the one model that scored WORSE than no reranker');
});

test('a recommendation carries the evidence, not just the flag', () => {
  // A number in the source is checkable; "this one is good" is not.
  const src = fs.readFileSync(path.join(repoRoot, 'electron/rag/rerankerModelCatalog.ts'), 'utf8');
  for (const m of recommended()) {
    const i = src.indexOf(`id: '${m.id}'`);
    const window = src.slice(Math.max(0, i - 1400), i + 200);
    assert.match(window, /MRR 0\.\d{4}/,
      `${m.id} is recommended with no measured MRR recorded beside it`);
  }
});

// ── the single headline ───────────────────────────────────────────────────

test('"Best for this Mac" names a model by RULE, not by array position', () => {
  // Several entries carry the badge, and the headline used to be
  // `.find(m => m.recommended && m.supported)` — whichever sat earliest in the
  // catalogue array. Reordering the file would have silently changed the
  // headline recommendation.
  assert.doesNotMatch(panel, /catalogModels\.find\(m => m\.recommended && m\.supported\)\?\.name/,
    'the headline must not be decided by catalogue order');
  assert.match(panel, /recommended\.find\(m => !m\.license\?\.commercialUseRestricted\)/,
    'it must prefer a model the user can use without a licence problem');
});

test('the headline never lands on a non-commercial model while an open one is recommended', () => {
  // jina-reranker-v3.5 is the strongest local reranker measured and keeps its
  // badge — but it is CC-BY-NC, and a headline inside a paid product should not
  // recommend a licence the user probably cannot honour.
  const rec = recommended();
  const unrestricted = rec.find(m => !m.license.commercialUseRestricted);
  const headline = unrestricted ?? rec[0];
  assert.ok(headline, 'something must be recommended');
  assert.equal(headline.license.commercialUseRestricted, false, `headline ${headline.id} is licence-restricted`);
  assert.equal(headline.id, 'ettin-reranker-68m');

  // And the stronger restricted one is still offered, not hidden.
  const jina = findCatalogModel('jina-reranker-v3.5-q4km');
  assert.equal(jina.recommended, true);
  assert.equal(jina.license.commercialUseRestricted, true);
  assert.equal(jina.license.requiresAcknowledgement, true,
    'the licence gate is what makes recommending it acceptable at all');
});

test('the bundled default is not silently promoted into the catalogue', () => {
  // `Xenova/bge-reranker-base` is what an empty selection resolves to, so it is
  // the reranker most users actually run — and it is the WORST thing measured:
  // MRR 0.7558 against a 0.8368 baseline, moving 7 queries down against 3 up.
  // It is not broken (it ranks an obvious probe perfectly); it is a 2022-era
  // cross-encoder losing to same-vocabulary distractors.
  //
  // It keeps its place as the fallback, because something has to be there when
  // nothing is downloaded. What it must never become is a catalogue entry
  // carrying a Recommended badge.
  assert.ok(MEASURED_MRR['Xenova/bge-reranker-base'] < BASELINE_MRR,
    'the premise of this test changed — re-read the benchmark');
  assert.equal(RERANKER_MODEL_CATALOG.some(m => m.modelId === 'Xenova/bge-reranker-base'), false,
    'the bundled model must not appear in the downloadable catalogue');
  for (const m of recommended()) {
    assert.notEqual(m.modelId, 'Xenova/bge-reranker-base');
  }
});

test('a recommended model beats the bundled default it would replace', () => {
  // The point of downloading one at all. A recommendation that does not clear
  // the model already on disk is asking the user to spend megabytes for nothing.
  const bundled = MEASURED_MRR['Xenova/bge-reranker-base'];
  for (const m of recommended()) {
    assert.ok(MEASURED_MRR[m.id] > bundled,
      `${m.id} (MRR ${MEASURED_MRR[m.id]}) does not beat the bundled ${bundled}`);
  }
});
