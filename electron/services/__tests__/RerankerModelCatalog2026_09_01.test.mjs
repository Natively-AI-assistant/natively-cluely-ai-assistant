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
const { statusOf, listCatalogStatus, installCatalogModel, removeCatalogModel, modelDirectory } =
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

test('an unsupported entry, if there is one, says why and is never activatable', () => {
  // Ettin used to live here: its ONNX graph emits last_hidden_state rather than
  // logits, so it looked unusable. Core now applies the Sentence-Transformers
  // head itself (rag/sentenceTransformerHead.ts), so the list may legitimately
  // be empty. The CONTRACT is what matters — an entry Core cannot execute must
  // explain itself rather than offering a button that cannot work.
  for (const m of RERANKER_MODEL_CATALOG.filter(m => !m.supported)) {
    assert.ok(m.unsupportedReason && m.unsupportedReason.length > 20, `${m.id} must explain itself`);
    assert.equal(m.modelId, undefined, `${m.id} must not be pointable at the runtime`);
  }
});

test('a model whose head is outside the graph ships the files needed to apply it', () => {
  // A backbone-only export plus a tokenizer would install cleanly and then
  // score nothing. The module chain has to come with it.
  for (const m of RERANKER_MODEL_CATALOG) {
    if (m.runtime !== 'onnx' || !m.supported) continue;
    const paths = m.files.map(f => f.repoPath);
    if (!paths.includes('modules.json')) continue;   // an ordinary cross-encoder
    for (const needed of ['1_Pooling/config.json', '2_Dense/config.json', '2_Dense/model.safetensors',
                          '3_LayerNorm/model.safetensors', '4_Dense/config.json', '4_Dense/model.safetensors']) {
      assert.ok(paths.includes(needed), `${m.id} declares modules.json but not ${needed}`);
    }
    assert.equal(m.dtype, 'fp32', `${m.id} ships onnx/model.onnx, which is the fp32 variant`);
  }
});

test('a configPatch only ever targets a file with no declared hash', () => {
  // Patching a verified file would leave bytes on disk that no longer match
  // what was checked, and the next install would look corrupt.
  for (const m of RERANKER_MODEL_CATALOG) {
    if (!m.configPatch) continue;
    const cfg = m.files.find(f => f.repoPath === 'config.json');
    assert.ok(cfg, `${m.id} declares a configPatch but never downloads config.json`);
    assert.equal(cfg.sha256, null, `${m.id} patches a config.json that carries a sha256`);
  }
});

test('jina v2 declares the model_type transformers.js needs', () => {
  // Its config.json ships no model_type and points auto_map at custom Python
  // modelling code. transformers.js cannot execute that and fails with
  // "Unsupported model type: null" — measured, before this was added.
  const jina = RERANKER_MODEL_CATALOG.find(m => m.id === 'jina-reranker-v2-multilingual');
  assert.ok(jina, 'jina v2 is expected in the catalogue');
  assert.equal(jina.configPatch?.model_type, 'xlm-roberta');
  assert.equal(jina.supported, true);
  assert.equal(jina.license.commercialUseRestricted, true, 'CC-BY-NC must be flagged');
});

test('a supported GGUF entry is runnable by Core, not by an extension', () => {
  // Core runs GGUF in-process through llama.cpp now, so a supported entry needs
  // no extension and no binary on PATH. It must also never be handed to the
  // ONNX runtime.
  for (const m of RERANKER_MODEL_CATALOG.filter(m => m.runtime === 'gguf' && m.supported)) {
    assert.equal(m.modelId, undefined, `${m.id} must never reach the ONNX runtime`);
    assert.equal(m.dtype, undefined, 'dtype is an ONNX concept');
    assert.equal(m.files.length, 1, 'a GGUF model is one file');
    assert.match(m.files[0].repoPath, /\.gguf$/);
    assert.ok(m.files[0].sha256, 'the weights must be verifiable');
  }
});

test('an unsupported GGUF entry explains itself instead of naming a workaround', () => {
  // Both jina and qwen3 are qwen3-architecture generative models that llama.cpp
  // refuses to RANK. Qwen3 is now scored the other way (yes/no token
  // probabilities, see qwenRerankPrompt.ts) and is supported; Jina is not,
  // because its protocol needs a patched llama.cpp and per-token hidden states.
  const unsupported = RERANKER_MODEL_CATALOG.filter(m => m.runtime === 'gguf' && !m.supported);
  assert.ok(unsupported.some(m => m.id.startsWith('jina')), 'jina is expected to remain unsupported');
  for (const m of unsupported) {
    // Keyed on the substance, not a phrase: it must name what the model needs
    // that this build cannot provide. Jina is listwise and needs per-token
    // hidden states; llama.cpp gives pooled embeddings and logits.
    assert.match(m.unsupportedReason, /hidden state|ranking head/i, `${m.id} must say why`);
  }
});

test('a GGUF entry declares how it is scored, because guessing is not degradable', () => {
  // Handing a causal LM to the ranking API is a refusal; handing a ranking
  // model the yes/no prompt is a meaningless number. Neither degrades.
  for (const m of RERANKER_MODEL_CATALOG.filter(m => m.runtime === 'gguf' && m.supported)) {
    assert.ok(m.scoring === 'rank' || m.scoring === 'yes-no', `${m.id} must declare its scoring`);
  }
  assert.equal(RERANKER_MODEL_CATALOG.find(m => m.id === 'qwen3-reranker-0.6b-q4km').scoring, 'yes-no');
  assert.equal(RERANKER_MODEL_CATALOG.find(m => m.id === 'bge-reranker-v2-m3-q4km').scoring, 'rank');
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
  // Driven through a synthetic entry rather than a real id: every catalogue
  // entry is supported today, and pointing this at one would start a real
  // multi-hundred-megabyte download instead of testing the refusal.
  const root = tmp();
  const unsupported = RERANKER_MODEL_CATALOG.find(m => !m.supported);
  if (!unsupported) return;   // nothing unsupported to refuse
  const res = await installCatalogModel(unsupported.id, () => {}, new AbortController().signal, { rootOverride: root });
  assert.equal(res.ok, false);
  assert.match(res.error, /scoring head|ranking head|hidden state|not supported/i);
});

test('an unsupported GGUF model is refused before any download', async () => {
  // jina/qwen3 GGUFs are qwen3-architecture generative models: llama.cpp
  // refuses to rank them, so downloading ~400MB would buy nothing.
  const res = await installCatalogModel('jina-reranker-v3.5-q4km', () => {}, new AbortController().signal, { rootOverride: tmp() });
  assert.equal(res.ok, false);
  assert.match(res.error, /ranking head|hidden state|not supported/i);
});

test('an unknown id is refused', async () => {
  const res = await installCatalogModel('no-such-model', () => {}, new AbortController().signal, { rootOverride: tmp() });
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
  const res = removeCatalogModel('ms-marco-minilm-l6', tmp());
  assert.equal(res.ok, true);
});

test('a GGUF model CAN be removed now that Core installs it', () => {
  const res = removeCatalogModel('bge-reranker-v2-m3-q4km', tmp());
  assert.equal(res.ok, true);
});
