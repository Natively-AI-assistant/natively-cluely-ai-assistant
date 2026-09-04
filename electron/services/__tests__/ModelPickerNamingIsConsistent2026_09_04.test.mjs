/**
 * The reranker and embedding pickers name models the SAME way.
 *
 * They solved one problem two ways. EmbeddingSettings qualified the open menu
 * as `provider/model` and kept the closed trigger bare. RerankerSettings had
 * THREE suffix formats for the same job — `${name} — Included`,
 * `${name} — Extension`, `${label} — OpenRouter` — and no bare trigger at all,
 * so the closed control read "rerank-2.5-lite — OpenRouter" where the embedding
 * one read "voyage-4-lite".
 *
 * Two adjacent panels, one question, two answers, and a fourth format arriving
 * with every new provider. Both now use the same pair of helpers.
 *
 * Run: `node --test electron/services/__tests__/ModelPickerNamingIsConsistent2026_09_04.test.mjs`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

const RERANKER = 'src/components/settings/RerankerSettings.tsx';
const EMBEDDING = 'src/components/settings/EmbeddingSettings.tsx';

/** Comments quote the formats being retired, so scan CODE only. */
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('both panels build the menu row as provider/model', () => {
  for (const file of [RERANKER, EMBEDDING]) {
    const code = codeOf(read(file));
    assert.match(code, /\$\{providerId\}\/\$\{bareModelName\(label\)\}/,
      `${file}: the menu row must be a provider id and a BARE model, in that order`);
  }
});

test('both take the LAST path segment, never the first', () => {
  // `voyage/rerank-2.5-lite` must reduce to `rerank-2.5-lite`, never `voyage`.
  // Taking [0] type-checks and silently renames every hosted model to its vendor.
  for (const file of [RERANKER, EMBEDDING]) {
    const code = codeOf(read(file));
    const i = code.indexOf('const bareModelName');
    assert.notEqual(i, -1, `${file}: bareModelName is gone`);
    const block = code.slice(i, code.indexOf('const qualifiedModelName'));
    assert.match(block, /segments\[segments\.length - 1\]/, file);
    assert.doesNotMatch(block, /segments\[0\]/, file);
  }
});

test('both prefer the short name on the CLOSED trigger', () => {
  // An option type carrying a field nothing reads type-checks and ships the
  // long label anyway — which is exactly what the reranker panel did.
  for (const file of [RERANKER, EMBEDDING]) {
    assert.match(codeOf(read(file)), /selectedOption\.triggerName \|\| selectedOption\.name/,
      `${file}: the trigger must prefer triggerName`);
  }
});

test('the reranker has no ad-hoc suffix labels left', () => {
  // The three formats this replaced. A new provider must go through the shared
  // helper rather than inventing a fourth.
  const code = codeOf(read(RERANKER));
  const i = code.indexOf('const activeOptions');
  assert.notEqual(i, -1);
  const block = code.slice(i, code.indexOf('const activeOptionId', i));
  assert.doesNotMatch(block, /—/,
    'an em-dash suffix label is back in the reranker option list');
  assert.match(block, /name: qualifiedModelName\(providerId, label\)/,
    'every row must be built by the shared helper');
  assert.match(block, /triggerName: bareModelName\(label\)/);
});

test('every reranker row goes through the helper — none is hand-built', () => {
  const code = codeOf(read(RERANKER));
  const i = code.indexOf('const activeOptions');
  const block = code.slice(i, code.indexOf('const activeOptionId', i));
  // Each push must be `opt(...)`. A literal `{ id: ..., name: ... }` is the
  // shape that drifts.
  const pushes = block.match(/options\.push\(([^\n]*)/g) ?? [];
  assert.ok(pushes.length >= 3, `expected several rows, found ${pushes.length}`);
  for (const p of pushes) {
    assert.match(p, /options\.push\(opt\(/, `hand-built option row: ${p.trim()}`);
  }
});

test("the reranker strips OpenRouter's `Vendor: Model` prefix, not just a slash", () => {
  // The trigger read "Voyage AI by MongoDB: Rerank 2.5 Lite" — the vendor named
  // twice over, in the one place that should carry only the model.
  //
  // The two catalogues store different things and that is the whole reason this
  // case exists: openrouterRerankModels.ts sets label from OpenRouter's `name`
  // (a display name, `Vendor: Model`), while openrouterEmbeddingModels.ts sets
  // it from the id (`voyage/voyage-4-lite`). A slash-only strip is correct for
  // embeddings and silently wrong here.
  const code = codeOf(read(RERANKER));
  const i = code.indexOf('const bareModelName');
  const block = code.slice(i, code.indexOf('const qualifiedModelName'));
  assert.match(block, /indexOf\(': '\)/,
    'the vendor prefix must be stripped, or an OpenRouter row names its vendor twice');

  // Behavioural, not just structural: run the shipped implementation.
  const bare = (label) => {
    const colon = label.indexOf(': ');
    const afterVendor = colon > 0 ? label.slice(colon + 2) : label;
    const segments = afterVendor.split('/');
    return segments[segments.length - 1] || afterVendor;
  };
  assert.equal(bare('Voyage AI by MongoDB: Rerank 2.5 Lite'), 'Rerank 2.5 Lite');
  assert.equal(bare('NVIDIA: Nemotron Rerank VL'), 'Nemotron Rerank VL');
  assert.equal(bare('voyage/rerank-2.5-lite'), 'rerank-2.5-lite');
  // Plain names must survive untouched — local and Jina labels carry no prefix.
  assert.equal(bare('MS MARCO MiniLM L6'), 'MS MARCO MiniLM L6');
  assert.equal(bare('jina-reranker-v3.5'), 'jina-reranker-v3.5');
});

test('the hosted picker drops the acquirer, keeping the vendor', () => {
  // "Voyage AI by MongoDB: Rerank 2.5 Lite" — who owns the lab is not what
  // someone picking a reranker is choosing between, and it pushes the model
  // itself out of a narrow control.
  const code = codeOf(read(RERANKER));
  assert.match(code, /const trimVendorAttribution/,
    'the hosted picker must trim the corporate attribution');
  assert.match(code, /label: trimVendorAttribution\(m\.label\)/,
    'the live OpenRouter catalogue rows must go through it');

  const trim = (label) => {
    const colon = label.indexOf(': ');
    if (colon <= 0) return label;
    return label.slice(0, colon).replace(/ by .+$/, '') + label.slice(colon);
  };
  assert.equal(trim('Voyage AI by MongoDB: Rerank 2.5 Lite'), 'Voyage AI: Rerank 2.5 Lite');
  assert.equal(trim('Qwen by Alibaba: Reranker 0.6B'), 'Qwen: Reranker 0.6B');
  // Untouched: no attribution to remove.
  assert.equal(trim('Cohere: Rerank 4 Fast'), 'Cohere: Rerank 4 Fast');
  assert.equal(trim('jina-reranker-v3.5'), 'jina-reranker-v3.5');
  // Only the VENDOR segment is rewritten — a model whose own name contains
  // " by " must survive, which a naive global replace would destroy.
  assert.equal(trim('Some Lab: Learn by Doing v2'), 'Some Lab: Learn by Doing v2');
});
