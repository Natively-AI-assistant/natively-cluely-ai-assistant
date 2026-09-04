/**
 * The model you select is the model that runs — for both embedding and rerank.
 *
 * Two separate failures sat behind this, and neither produced an error:
 *
 *  1. A chosen RERANKER barely ran. The seam treats reranking as a
 *     low-confidence escalation, so it only fired when `computeConfidence()`
 *     tripped. Measured against the running app over 36 doc-grounded
 *     retrievals across 9 queries: it tripped ONCE. A downloaded, selected,
 *     successfully-tested reranker did nothing on 35 of 36 queries.
 *
 *  2. A chosen local reranker was not even NAMED correctly — see
 *     RerankerStatusReportsSelection2026_09_04.
 *
 * The embedding side was already correct, and is pinned here too so it stays
 * that way: a manual choice filters the candidate chain to that provider, and
 * the chosen model AND its measured width reach the provider's constructor.
 * Getting the width wrong does not throw — it writes vectors under a space key
 * they do not belong to, and the index silently stops matching.
 *
 * Run: `node --test electron/services/__tests__/ActiveModelIsTheOneUsed2026_09_04.test.mjs`
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

const seam = fs.readFileSync(path.join(repoRoot, 'electron/services/modes/ModeHybridRetriever.ts'), 'utf8');
const resolver = fs.readFileSync(path.join(repoRoot, 'electron/rag/EmbeddingProviderResolver.ts'), 'utf8');

const { isRerankerExplicitlySelected } =
  require(path.join(repoRoot, 'dist-electron/electron/services/reranking/rerankerConfig.js'));

/** Drive the predicate against a seeded settings store, the way the app reads it. */
function withSettings(reranker, fn) {
  const previous = globalThis.__nativelySettingsManagerV1__;
  const store = { reranker };
  globalThis.__nativelySettingsManagerV1__ = {
    get: (k) => store[k],
    set: (k, v) => { store[k] = v; return true; },
  };
  try { return fn(); } finally { globalThis.__nativelySettingsManagerV1__ = previous; }
}

// ── the reranker actually runs ────────────────────────────────────────────

test('an explicit choice makes reranking unconditional, not an escalation', () => {
  // The whole bug: `if (lowConfidence)` alone. The gate is right for the
  // bundled default and wrong for a model the user went and picked.
  assert.match(seam, /const shouldRerank = lowConfidence \|\| explicitlySelected/,
    'reranking must also run when the user chose the reranker');
  assert.doesNotMatch(seam, /\n\s*if \(lowConfidence\) \{/,
    'gating on lowConfidence alone is the defect this test exists for');
});

test('the decision is reported in the trace, so "did not run" is observable', () => {
  // Without this, "the gate never tripped", "ran and agreed with retrieval" and
  // "ran and returned nothing" are indistinguishable from outside.
  assert.match(seam, /markH4HybridStage\('rerank_gate', \{[\s\S]{0,200}explicitlySelected/,
    'the gate trace must say whether the choice was explicit');
  assert.match(seam, /markH4HybridStage\('rerank_gate', \{[\s\S]{0,200}shouldRerank/);
});

test('no selection means the bundled default keeps its escalation behaviour', () => {
  // A user who never opened the panel must not start paying rerank latency
  // because this changed.
  withSettings({ provider: 'local' }, () => {
    assert.equal(isRerankerExplicitlySelected(), false);
  });
  withSettings({ provider: 'local', localModelId: null }, () => {
    assert.equal(isRerankerExplicitlySelected(), false);
  });
});

test('an unknown or unsupported local id is NOT an explicit choice', () => {
  // Such a selection falls back to the bundled model at the seam, so counting
  // it would spend the escalation on the model the user did not pick.
  withSettings({ provider: 'local', localModelId: 'no-such-model' }, () => {
    assert.equal(isRerankerExplicitlySelected(), false);
  });
});

test('a selected local model counts only once it is INSTALLED', () => {
  // Same rule, other direction: naming a half-downloaded model would make the
  // seam escalate to something that cannot score.
  //
  // Asserted on the RULE as well as the data, because the data is a property of
  // whichever machine runs this: on a developer box where every catalogue model
  // happens to be installed, dropping the installed check changes no outcome
  // and a purely data-driven test passes on the bug.
  const config = fs.readFileSync(
    path.join(repoRoot, 'electron/services/reranking/rerankerConfig.ts'), 'utf8');
  const fn = config.slice(config.indexOf('export function isRerankerExplicitlySelected'));
  assert.match(fn.slice(0, fn.indexOf('\n}')), /statusOf\(entry\)\.state === 'installed'/,
    'an uninstalled selection falls back to the bundled model at the seam');

  const { RERANKER_MODEL_CATALOG } =
    require(path.join(repoRoot, 'dist-electron/electron/rag/rerankerModelCatalog.js'));
  const { statusOf } = require(path.join(repoRoot, 'dist-electron/electron/services/reranking/localModelInstaller.js'));
  for (const m of RERANKER_MODEL_CATALOG.filter(m => m.supported)) {
    const installed = statusOf(m).state === 'installed';
    withSettings({ provider: 'local', localModelId: m.id }, () => {
      assert.equal(isRerankerExplicitlySelected(), installed,
        `${m.id} is ${installed ? 'installed' : 'not installed'} but the predicate disagreed`);
    });
  }
});

test('the predicate never throws, whatever the settings hold', () => {
  // It decides whether reranking runs. Throwing here would take retrieval with
  // it, which is a far worse outcome than not escalating.
  for (const bad of [null, undefined, 42, 'nonsense', { localModelId: {} }, { provider: 7 }]) {
    withSettings(bad, () => {
      assert.equal(typeof isRerankerExplicitlySelected(), 'boolean', `threw or returned non-boolean for ${JSON.stringify(bad)}`);
    });
  }
});

// ── the embedding model is the one that gets used ─────────────────────────

test('a manual embedding choice narrows the chain to that provider', () => {
  assert.match(resolver, /config\.embeddingMode === 'manual' && chosen/,
    'manual mode must filter the candidate chain');
  assert.match(resolver, /candidates\.filter\(c => c\.name === chosen\)/,
    'and filter it to the chosen provider, not merely reorder');
});

test('the chosen MODEL and its measured width reach the provider', () => {
  // Provider alone is not enough: constructing voyage-4 when voyage-3.5 was
  // chosen, or guessing a width, writes vectors under the wrong space key and
  // the index quietly stops matching.
  for (const [label, re] of [
    ['voyage', /new VoyageEmbeddingProvider\(\{\s*apiKey: config\.voyageKey!, model: voyModel, dimensions: voyDims,/],
    ['openrouter', /new OpenRouterEmbeddingProvider\(\{\s*apiKey: config\.openrouterKey!, model: orModel, dimensions: orDims,/],
  ]) {
    assert.match(resolver, re, `${label} must be constructed with the configured model and width`);
  }
});

test('an unmeasured width means NO candidate, never a guess', () => {
  // The failure this prevents has no error: a guessed width stamps a space key
  // over real vectors, and every later search misses.
  const guarded = [...resolver.matchAll(/if \(typeof \w+Dims === 'number' && Number\.isInteger\(\w+Dims\) && \w+Dims > 0\)/g)];
  assert.ok(guarded.length >= 2,
    `expected every width-bearing provider to be guarded, found ${guarded.length}`);
  assert.match(resolver, /skipping it rather than assuming a width|no measured width means NO/i);
});
