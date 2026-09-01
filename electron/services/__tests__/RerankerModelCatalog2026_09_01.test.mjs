/**
 * The direct-install catalogue.
 *
 * The point of these tests is that a catalogue is a set of CLAIMS about remote
 * files, and a wrong claim is only discovered when a user has already spent
 * several hundred megabytes. So: every pinned revision is a full commit sha,
 * every declared size adds up, and — the one that actually bit — nothing is
 * marked runnable unless its ONNX graph really exposes a scoring output.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const { RERANKER_MODEL_CATALOG, findCatalogModel } =
  require(path.join(repoRoot, 'dist-electron/electron/rag/rerankerModelCatalog.js'));
const { statusOf, listCatalogStatus, installOnnxModel, removeOnnxModel, modelDirectory } =
  require(path.join(repoRoot, 'dist-electron/electron/services/reranking/localModelInstaller.js'));

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'natively-cat-'));

// ── the claims must be well-formed ────────────────────────────────────────

test('every entry pins a full 40-character commit sha', () => {
  // A branch name or a short sha lets a repo change under a resumed download.
  for (const m of RERANKER_MODEL_CATALOG) {
    assert.match(m.revision, /^[0-9a-f]{40}$/, `${m.id} has revision ${m.revision}`);
  }
});

test('declared totals equal the sum of the declared files', () => {
  for (const m of RERANKER_MODEL_CATALOG) {
    const sum = m.files.reduce((n, f) => n + f.bytes, 0);
    assert.equal(m.bytes, sum, `${m.id}: bytes ${m.bytes} != sum ${sum}`);
  }
});

test('a declared sha256 is a real digest, never a placeholder', () => {
  for (const m of RERANKER_MODEL_CATALOG) {
    for (const f of m.files) {
      if (f.sha256 === null) continue;   // legitimately absent: not an LFS object
      assert.match(f.sha256, /^[0-9a-f]{64}$/, `${m.id}/${f.repoPath}`);
    }
  }
});

test('the big weights file always carries a hash', () => {
  // Hugging Face publishes digests for LFS objects, which is every weights
  // file. A weights entry with no hash would mean the download is unverified.
  for (const m of RERANKER_MODEL_CATALOG) {
    const biggest = [...m.files].sort((a, b) => b.bytes - a.bytes)[0];
    assert.ok(biggest.sha256, `${m.id}: the largest file ${biggest.repoPath} has no sha256`);
  }
});

test('ids and repos are unique', () => {
  const ids = RERANKER_MODEL_CATALOG.map(m => m.id);
  assert.equal(new Set(ids).size, ids.length);
  const repos = RERANKER_MODEL_CATALOG.map(m => m.repo);
  assert.equal(new Set(repos).size, repos.length);
});

// ── supported vs listed ───────────────────────────────────────────────────

test('a supported ONNX entry declares what the runtime needs to load it', () => {
  for (const m of RERANKER_MODEL_CATALOG) {
    if (m.runtime !== 'onnx' || !m.supported) continue;
    assert.ok(m.modelId, `${m.id} needs a modelId`);
    assert.ok(m.dtype, `${m.id} needs a dtype`);
    // transformers.js resolves <root>/<org>/<name>/, so the two must agree or
    // the runtime looks in a directory the installer never wrote to.
    assert.equal(m.modelId, m.repo, `${m.id}: modelId must match repo`);
    // dtype selects the file: q8 -> model_quantized.onnx, fp32 -> model.onnx.
    const expected = m.dtype === 'q8' ? 'onnx/model_quantized.onnx' : 'onnx/model.onnx';
    assert.ok(m.files.some(f => f.repoPath === expected),
      `${m.id}: dtype ${m.dtype} needs ${expected}, files are ${m.files.map(f => f.repoPath).join(', ')}`);
    // transformers.js needs the tokenizer alongside the weights.
    assert.ok(m.files.some(f => f.repoPath === 'tokenizer.json'), `${m.id} must ship tokenizer.json`);
  }
});

test('an unsupported entry says why, and is never activatable', () => {
  // Ettin publishes a BACKBONE-only ONNX export (graph output
  // `last_hidden_state`, not `logits`); its scoring head is a separate
  // Sentence-Transformers module chain. Listing it without this would offer a
  // download that cannot produce a score.
  const unsupported = RERANKER_MODEL_CATALOG.filter(m => !m.supported);
  assert.ok(unsupported.length > 0, 'the Ettin entries are expected here');
  for (const m of unsupported) {
    assert.ok(m.unsupportedReason && m.unsupportedReason.length > 20, `${m.id} must explain itself`);
    assert.equal(m.modelId, undefined, `${m.id} must not be pointable at the runtime`);
  }
});

test('a GGUF entry names the extension and binary that run it', () => {
  for (const m of RERANKER_MODEL_CATALOG.filter(m => m.runtime === 'gguf')) {
    assert.ok(m.extensionId, `${m.id} needs an extensionId — Core has no llama.cpp`);
    assert.ok(m.requiresBinary, `${m.id} must name the binary it needs`);
    assert.equal(m.modelId, undefined, 'a GGUF model must never be handed to the ONNX runtime');
  }
});

test('a non-commercial model is flagged and requires acknowledgement', () => {
  const jina = findCatalogModel('jina-reranker-v3.5-q4km');
  assert.equal(jina.license.spdx, 'CC-BY-NC-4.0');
  assert.equal(jina.license.commercialUseRestricted, true);
  assert.equal(jina.license.requiresAcknowledgement, true,
    'the LicenseLedger gate is what stops it loading unacknowledged');
});

// ── install refusals ──────────────────────────────────────────────────────

test('installing an unsupported model is refused before any download', async () => {
  const root = tmp();
  const res = await installOnnxModel('ettin-reranker-32m', () => {}, new AbortController().signal, { rootOverride: root });
  assert.equal(res.ok, false);
  assert.match(res.error, /scoring head|not supported/i);
  // Nothing may have been written.
  assert.equal(fs.existsSync(path.join(root, 'cross-encoder')), false);
});

test('installing a GGUF model through the ONNX path is refused', async () => {
  const res = await installOnnxModel('jina-reranker-v3.5-q4km', () => {}, new AbortController().signal, { rootOverride: tmp() });
  assert.equal(res.ok, false);
  assert.match(res.error, /gguf/i);
});

test('an unknown id is refused', async () => {
  const res = await installOnnxModel('no-such-model', () => {}, new AbortController().signal, { rootOverride: tmp() });
  assert.equal(res.ok, false);
});

// ── status ────────────────────────────────────────────────────────────────

test('a half-present model reads as partial, never installed', () => {
  // transformers.js given a tokenizer but no weights fails at LOAD time, long
  // after the UI would have said Ready.
  const root = tmp();
  const model = findCatalogModel('ms-marco-minilm-l6');
  const dir = modelDirectory(model, root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tokenizer.json'), 'x');

  const status = statusOf(model, root);
  assert.equal(status.state, 'partial');
  assert.ok(status.missing.includes('onnx/model_quantized.onnx'));
});

test('an empty root reads as not-installed for everything', () => {
  const root = tmp();
  for (const m of listCatalogStatus(root)) {
    assert.equal(m.status.state, 'not-installed', m.id);
  }
});

test('the install directory is nested per org and name, not one literal segment', () => {
  const root = tmp();
  const dir = modelDirectory(findCatalogModel('ms-marco-minilm-l6'), root);
  // A directory literally named "Xenova/ms-marco-..." would be wrong on Windows
  // and would not match resolveModelPath()'s lookup either.
  assert.equal(dir, path.join(root, 'Xenova', 'ms-marco-MiniLM-L-6-v2'));
});

test('removing a model that is not installed is harmless', () => {
  const res = removeOnnxModel('ms-marco-minilm-l6', tmp());
  assert.equal(res.ok, true);
});

test('a GGUF model cannot be removed through the local-model path', () => {
  const res = removeOnnxModel('jina-reranker-v3.5-q4km', tmp());
  assert.equal(res.ok, false);
});
