/**
 * extraResources copies resources/models/ into the installer, and it does NOT
 * honour .gitignore.
 *
 * electron-builder's getFileMatchers() handles extraResources without injecting
 * the default ignores (fileMatcher.ts adds no node_modules exclusion and does
 * not call getDefaultIgnoredPatterns()). Anything sitting in that directory
 * ships, gitignored or not.
 *
 * MEASURED on a developer machine, 2026-09-04: resources/models held 814MB, of
 * which 553MB was Xenova/bge-reranker-large - the model deliberately un-bundled
 * that day, left behind by an earlier download-models run and gitignored, so a
 * clean checkout and CI never saw it. A local `npm run dist` would have shipped
 * it, and `dist:signed` uploads the artifact automatically.
 *
 * A filter fixes that, but an allow-list can fail the other way: omit a needed
 * path and the app ships with no embedder and no reranker. So this checks BOTH
 * directions against the canonical list in scripts/download-models.js.
 *
 * Run: node --test electron/rag/__tests__/BundledModelsShipWithoutStowaways2026_09_04.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const entry = (pkg.build.extraResources ?? []).find(r => r.from === 'resources/models/');

/** The files download-models.js guarantees, read from the script itself. */
function canonicalFiles() {
  const src = fs.readFileSync(path.join(repoRoot, 'scripts/download-models.js'), 'utf8');
  const grab = (name) => {
    const i = src.indexOf('const ' + name + ' = [');
    assert.notEqual(i, -1, name + ' is gone from download-models.js');
    const block = src.slice(i, src.indexOf('];', i));
    return [...block.matchAll(/'([^']+\/[^']+)'/g)].map(m => m[1]);
  };
  const files = [...grab('REQUIRED_MODEL_FILES'), ...grab('OPTIONAL_MODEL_FILES')];
  // Nine since 2026-09-05: the four mobilebert-uncased-mnli files left with the
  // intent classifier. The floor guards the regex above going blind, not the
  // catalogue size, so it tracks the real count.
  assert.ok(files.length >= 9, 'expected the full model list, found ' + files.length);
  return files;
}

/**
 * Deliberately NOT a general glob engine.
 *
 * Every pattern here is a directory subtree, so the match is a prefix test and
 * needs no regex. A general converter is where these matchers go wrong - the
 * asar one silently matched nothing because its escape pass mangled the regex
 * its own expansion had just produced. An unsupported pattern throws instead of
 * quietly returning false, which would have read as "correctly excluded".
 */
function matches(pattern, relPath) {
  if (pattern === '**' || pattern === '**/*') return true;
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return relPath === prefix || relPath.startsWith(prefix + '/');
  }
  if (!pattern.includes('*')) return pattern === relPath;
  throw new Error('unsupported glob shape in extraResources filter: ' + pattern);
}
const shipped = (relPath) => (entry.filter ?? ['**/*']).some(p => matches(p, relPath));

test('the models entry is filtered at all', () => {
  assert.ok(entry, 'resources/models/ is not in extraResources');
  assert.ok(Array.isArray(entry.filter) && entry.filter.length > 0,
    'without a filter, everything in resources/models/ ships, including gitignored strays');
});

test('every file download-models.js requires is still shipped', () => {
  // The failure mode of an allow-list: an installer with no embedder.
  for (const rel of canonicalFiles()) {
    assert.ok(shipped(rel), rel + ' would NOT be copied into the installer by the filter');
  }
});

test('a model that is not bundled does not ride along', () => {
  for (const rel of [
    'Xenova/bge-reranker-large/onnx/model_quantized.onnx',
    'Xenova/bge-reranker-large/config.json',
    'Xenova/some-future-experiment/onnx/model.onnx',
  ]) {
    assert.equal(shipped(rel), false, rel + ' would be shipped - the filter is too broad');
  }
});

test('the matcher itself works, or this file proves nothing', () => {
  assert.equal(matches('Xenova/ms-marco-MiniLM-L-6-v2/**', 'Xenova/ms-marco-MiniLM-L-6-v2/onnx/model_quantized.onnx'), true);
  assert.equal(matches('Xenova/ms-marco-MiniLM-L-6-v2/**', 'Xenova/bge-reranker-large/config.json'), false);
  // A prefix that is not a path boundary must not match.
  assert.equal(matches('Xenova/ms-marco/**', 'Xenova/ms-marco-MiniLM-L-6-v2/config.json'), false);
  assert.equal(matches('pipecat-ai/**', 'pipecat-ai/smart-turn-v3/smart-turn-v3.1-cpu.onnx'), true);
});
