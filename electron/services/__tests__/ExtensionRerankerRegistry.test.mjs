/**
 * Phase 3: extension rerankers at the single rerank seam.
 *
 * The governing rule is that an enabled reranker extension REPLACES the
 * built-in reranker rather than running beside it. Everything here therefore
 * tests two things: who owns the seam, and that every failure mode yields
 * `null` so the caller keeps its existing ordering. A reranker failure must
 * never surface as an error and must never change safe-refusal behaviour.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const {
  RerankerRegistry, getRerankerRegistry, setRerankerRegistry, resetRerankerRegistry,
} = require(path.join(repoRoot, 'dist-electron/electron/services/reranking/RerankerRegistry.js'));

/** A stand-in ExtensionManager. */
function makeSource(overrides = {}) {
  return {
    extensions: [],
    loaded: [],
    list() { return this.extensions; },
    running() { return this.loaded; },
    async load(id) { this.loaded.push(id); },
    async rerank(_id, _q, candidates) {
      // Default: perfect reverse ordering, one result per candidate.
      return candidates.map((c, i) => ({ id: c.id, score: 1 - i / candidates.length, rank: i + 1 }));
    },
    ...overrides,
  };
}

function rerankerExt(id, enabled = true, type = 'reranker') {
  return { id, enabled, manifest: { type } };
}

function makeRegistry(overrides = {}) {
  const outcomes = [];
  const warnings = [];
  const registry = new RerankerRegistry({
    isEnabled: () => true,
    source: makeSource(),
    onOutcome: (o) => outcomes.push(o),
    logger: { warn: (m) => warnings.push(String(m)) },
    ...overrides,
  });
  return { registry, outcomes, warnings };
}

// ── who owns the seam ─────────────────────────────────────────────────────

test('with the flag off the built-in reranker keeps the seam', () => {
  const source = makeSource();
  source.extensions = [rerankerExt('jina')];
  const { registry } = makeRegistry({ isEnabled: () => false, source });
  assert.equal(registry.activeExtensionId(), null);
  assert.equal(registry.resolvePort(), null, 'null means "use the built-in"');
});

test('the flag alone changes nothing without an installed, enabled reranker', () => {
  // Both gates must pass, which is what makes the flag safe to flip.
  const empty = makeSource();
  assert.equal(makeRegistry({ source: empty }).registry.resolvePort(), null);

  const disabled = makeSource();
  disabled.extensions = [rerankerExt('jina', false)];
  assert.equal(makeRegistry({ source: disabled }).registry.resolvePort(), null);

  const wrongType = makeSource();
  wrongType.extensions = [rerankerExt('some-tool', true, 'exporter')];
  assert.equal(makeRegistry({ source: wrongType }).registry.resolvePort(), null);

  assert.equal(makeRegistry({ source: null }).registry.resolvePort(), null);
});

test('one enabled reranker takes the seam', () => {
  const source = makeSource();
  source.extensions = [rerankerExt('jina'), rerankerExt('ettin', false)];
  const { registry } = makeRegistry({ source });
  assert.equal(registry.activeExtensionId(), 'jina');
  assert.equal(typeof registry.resolvePort().rerank, 'function');
});

test('two enabled rerankers is refused rather than silently resolved', () => {
  // Picking one would reorder the user's evidence by whichever sorted first.
  const source = makeSource();
  source.extensions = [rerankerExt('jina'), rerankerExt('ettin')];
  const { registry, warnings } = makeRegistry({ source });
  assert.equal(registry.activeExtensionId(), null);
  assert.match(warnings.join(' '), /refusing to choose/);
});

test('a source that throws does not propagate into retrieval', () => {
  const source = makeSource({ list() { throw new Error('registry file unreadable'); } });
  const { registry } = makeRegistry({ source });
  assert.equal(registry.activeExtensionId(), null);
});

// ── the seam contract ─────────────────────────────────────────────────────

test('the port returns the seam shape, sorted by score descending', async () => {
  const source = makeSource({
    async rerank(_id, _q, candidates) {
      const scores = { 0: 0.1, 1: 0.9, 2: 0.5 };
      return candidates.map((c) => ({ id: c.id, score: scores[c.id], rank: 0 }));
    },
  });
  source.extensions = [rerankerExt('jina')];
  const { registry, outcomes } = makeRegistry({ source });

  const result = await registry.resolvePort().rerank('q', ['a', 'b', 'c']);
  assert.deepEqual(result, [
    { index: 1, score: 0.9 },
    { index: 2, score: 0.5 },
    { index: 0, score: 0.1 },
  ]);
  assert.equal(outcomes[0].fallback, false);
  assert.equal(outcomes[0].rerankerId, 'jina');
  assert.equal(outcomes[0].candidateCount, 3);
  assert.equal(typeof outcomes[0].latencyMs, 'number');
});

test('an INCOMPLETE ranking is rejected wholesale, not applied partially', async () => {
  // ModeHybridRetriever.rankScore(c, true) returns -Infinity for a candidate
  // with no rerankScore, so a partial ranking would silently sink every
  // unscored chunk below every scored one. Keeping the pre-rerank order is the
  // honest fallback.
  const source = makeSource({
    async rerank(_id, _q, candidates) {
      return candidates.slice(0, 1).map((c) => ({ id: c.id, score: 1, rank: 1 }));
    },
  });
  source.extensions = [rerankerExt('jina')];
  const { registry, outcomes } = makeRegistry({ source });

  assert.equal(await registry.resolvePort().rerank('q', ['a', 'b', 'c']), null);
  assert.equal(outcomes[0].fallback, true);
  assert.match(outcomes[0].reason, /incomplete or invalid/);
});

test('a malformed ranking is rejected', async () => {
  const cases = {
    'duplicate index': (c) => c.map(() => ({ id: '0', score: 1, rank: 1 })),
    'index out of range': (c) => c.map((_, i) => ({ id: String(i + 99), score: 1, rank: 1 })),
    'non-numeric id': (c) => c.map(() => ({ id: 'not-a-number', score: 1, rank: 1 })),
    'NaN score': (c) => c.map((x) => ({ id: x.id, score: Number.NaN, rank: 1 })),
    'Infinity score': (c) => c.map((x) => ({ id: x.id, score: Infinity, rank: 1 })),
    'not an array': () => ({ nope: true }),
  };
  for (const [label, shape] of Object.entries(cases)) {
    const source = makeSource({ async rerank(_i, _q, c) { return shape(c); } });
    source.extensions = [rerankerExt('jina')];
    const { registry } = makeRegistry({ source });
    assert.equal(await registry.resolvePort().rerank('q', ['a', 'b']), null, `${label} should fall back`);
  }
});

// ── failure modes all fall back, never throw ──────────────────────────────

test('a hanging reranker is bounded and aborted, even though the doc-grounded path has no budget', async () => {
  // LLMHelper.ts:3032 passes budgetMs: null when forceDocumentGrounding, so
  // nothing upstream bounds this wait. The ceiling has to be enforced here.
  let aborted = false;
  const source = makeSource({
    async rerank(_id, _q, _c, _k, signal) {
      signal.addEventListener('abort', () => { aborted = true; });
      return new Promise(() => {}); // never settles
    },
  });
  source.extensions = [rerankerExt('jina')];
  const { registry, outcomes } = makeRegistry({ source, timeoutMs: 30 });

  assert.equal(await registry.resolvePort().rerank('q', ['a', 'b']), null);
  assert.equal(aborted, true, 'the extension must be told to stop');
  assert.equal(outcomes[0].fallback, true);
  assert.match(outcomes[0].reason, /timed out after 30ms/);
});

test('a failing extension falls back to the BUILT-IN, not to no reranking', async () => {
  // The extension REPLACES the built-in at the seam. Before this, an extension
  // that fails every call left the user with cosine order — strictly worse than
  // the bundled model they displaced by installing it. And that is the normal
  // case, not an edge one: a published extension can throw on every rerank and
  // still look installed and enabled.
  const source = makeSource({ async rerank() { throw new Error('scoreBatch not implemented'); } });
  source.extensions = [rerankerExt('ettin-reranker')];
  const outcomes = [];
  const registry = new RerankerRegistry({
    isEnabled: () => true,
    source,
    builtInPort: () => ({ rerank: async () => [{ index: 1, score: 0.9 }, { index: 0, score: 0.1 }] }),
    onOutcome: (o) => outcomes.push(o),
    logger: { warn: () => {} },
  });

  const order = await registry.resolvePort().rerank('q', ['a', 'b']);
  assert.deepEqual(order?.map((o) => o.index), [1, 0], 'the built-in must still rank');
  // The failure is still reported, so it is a visible degradation not a silent one.
  assert.equal(outcomes.at(-1).fallback, true);
  assert.match(outcomes.at(-1).reason, /scoreBatch not implemented/);
});

test('with no built-in available the seam still keeps the existing order', async () => {
  const source = makeSource({ async rerank() { throw new Error('boom'); } });
  source.extensions = [rerankerExt('broken')];
  const registry = new RerankerRegistry({
    isEnabled: () => true, source, builtInPort: () => null, logger: { warn: () => {} },
  });
  assert.equal(await registry.resolvePort().rerank('q', ['a', 'b']), null);
});

test('a throwing reranker falls back instead of surfacing an error', async () => {
  const source = makeSource({ async rerank() { throw new Error('model not loaded'); } });
  source.extensions = [rerankerExt('jina')];
  const { registry, outcomes } = makeRegistry({ source });

  assert.equal(await registry.resolvePort().rerank('q', ['a', 'b']), null);
  assert.equal(outcomes[0].fallback, true);
  assert.match(outcomes[0].reason, /model not loaded/);
});

test('a reranker returning null falls back', async () => {
  const source = makeSource({ async rerank() { return null; } });
  source.extensions = [rerankerExt('jina')];
  const { registry, outcomes } = makeRegistry({ source });
  assert.equal(await registry.resolvePort().rerank('q', ['a']), null);
  assert.match(outcomes[0].reason, /no ranking/);
});

test('an extension that is not running is loaded on first use', async () => {
  const source = makeSource();
  source.extensions = [rerankerExt('jina')];
  const { registry } = makeRegistry({ source });

  await registry.resolvePort().rerank('q', ['a', 'b']);
  assert.deepEqual(source.loaded, ['jina'], 'load() should be called once');

  source.loaded = ['jina'];
  await registry.resolvePort().rerank('q', ['a', 'b']);
  assert.deepEqual(source.loaded, ['jina'], 'already-running extensions are not re-loaded');
});

test('an empty candidate list falls back without calling the extension', async () => {
  let called = false;
  const source = makeSource({ async rerank() { called = true; return []; } });
  source.extensions = [rerankerExt('jina')];
  const { registry } = makeRegistry({ source });
  assert.equal(await registry.resolvePort().rerank('q', []), null);
  assert.equal(called, false);
});

// ── seam wiring ───────────────────────────────────────────────────────────

test('ModeHybridRetriever consults the registry before the built-in, and only without a test override', () => {
  // Structural guard, kept deliberately loose so ordinary reformatting does not
  // break it. The behaviour it protects: an extension REPLACES the built-in at
  // this seam, so productionReranker must be suppressed when a port is present.
  const src = fs.readFileSync(
    path.join(repoRoot, 'electron/services/modes/ModeHybridRetriever.ts'), 'utf8',
  );
  assert.match(src, /RerankerRegistry/, 'the seam must consult the registry');
  assert.match(src, /getRerankerRegistry\(\)\s*\.\s*resolvePort\(\)/);
  // The extension port suppresses the built-in singleton.
  assert.match(src, /const productionReranker\s*=\s*\(this\.rerankerOverride\s*\|\|\s*extensionPort\)\s*\?\s*null/);
  // And the test override still wins over both.
  assert.match(src, /const extensionPort\s*=\s*this\.rerankerOverride\s*\?\s*null/);
});

test('the flag is registered, defaults OFF, and has a convenience reader', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/intelligence/intelligenceFlags.ts'), 'utf8');
  assert.match(src, /\|\s*'extensionRerankers'/, 'must be in the key union');
  assert.match(
    src,
    /extensionRerankers:\s*\{[^}]*env:\s*'NATIVELY_EXTENSION_RERANKERS'[^}]*default:\s*false[^}]*\}/,
    'must default OFF',
  );
  assert.match(src, /isExtensionRerankersEnabled/);
});

test('the doc-grounded telemetry reports the real topK and budget, not literals', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/LLMHelper.ts'), 'utf8');
  // Positive assertions only. A whole-file `doesNotMatch(/topKUsed:\s*12/)`
  // would be a false-failure generator in a 7000-line file: any unrelated
  // telemetry block, or a comment mentioning the old literal, would trip it.
  assert.match(src, /topKUsed:\s*DOC_GROUNDED_TOP_K/);
  assert.match(src, /tokenBudgetUsed:\s*DOC_GROUNDED_TOKEN_BUDGET/);
});


// ── process-wide accessor (the path Phase 5 app wiring will use) ──────────

test('setRerankerRegistry actually replaces the process-wide instance', () => {
  // "reset then processSingleton(factory)" is NOT a setter: processSingleton
  // ignores its factory when the key already exists, so anything repopulating
  // the key in between would silently keep the old registry.
  resetRerankerRegistry();
  const first = getRerankerRegistry();
  assert.equal(getRerankerRegistry(), first, 'the accessor must be stable');

  const source = makeSource();
  source.extensions = [rerankerExt('jina')];
  const replacement = new RerankerRegistry({ isEnabled: () => true, source });

  setRerankerRegistry(replacement);
  assert.equal(getRerankerRegistry(), replacement);
  assert.equal(getRerankerRegistry().activeExtensionId(), 'jina');

  // Replacing twice must land on the second one, not silently keep the first.
  const second = new RerankerRegistry({ isEnabled: () => false, source });
  setRerankerRegistry(second);
  assert.equal(getRerankerRegistry(), second);
  assert.equal(getRerankerRegistry().activeExtensionId(), null);

  resetRerankerRegistry();
});

test('the default registry leaves the seam to the built-in reranker', () => {
  // Nothing constructs ExtensionManager yet, so the default source is null.
  // This is why wiring the seam is behaviour-preserving today.
  resetRerankerRegistry();
  assert.equal(getRerankerRegistry().resolvePort(), null);
  resetRerankerRegistry();
});
