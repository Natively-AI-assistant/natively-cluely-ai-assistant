// electron/rag/__tests__/LocalRerankerModel.test.mjs
//
// REAL-MODEL smoke test for the bundled bge-reranker (smart-retrieval Phase 1/3).
// Loads the actual ONNX cross-encoder from resources/models via the compiled
// LocalReranker and asserts it ranks a relevant passage above an irrelevant one.
//
// SKIPS (does not fail) when the model isn't present on disk — keeps CI green on
// machines/builds that haven't run `node scripts/download-models.js`. When the
// model IS bundled (the shipping case), this proves the dtype/local_files_only
// load path and the logits→ranking contract end-to-end.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const modelOnnx = path.join(repoRoot, 'resources/models/Xenova/bge-reranker-base/onnx/model_quantized.onnx');
const MODEL_PRESENT = fs.existsSync(modelOnnx);

async function loadReranker() {
  try {
    const dist = path.resolve(repoRoot, 'dist-electron/electron/rag/LocalReranker.js');
    return await import(pathToFileURL(dist).href);
  } catch {
    return await import(pathToFileURL(path.resolve(__dirname, '../LocalReranker.ts')).href);
  }
}

describe('LocalReranker — real bundled model', () => {
  test('ranks a relevant passage above an irrelevant one', { skip: !MODEL_PRESENT ? 'reranker model not downloaded' : false }, async () => {
    const { getLocalReranker } = await loadReranker();
    const reranker = getLocalReranker();

    const available = await reranker.isAvailable();
    assert.equal(available, true, 'bundled reranker should load');

    const query = 'What is the capital of France?';
    const passages = [
      'Bananas are a good source of potassium and grow in tropical climates.',
      'Paris is the capital and most populous city of France.',
      'The mitochondria is the powerhouse of the cell.',
    ];
    const results = await reranker.rerank(query, passages);
    assert.ok(Array.isArray(results) && results.length === passages.length, 'returns a score per passage');
    // Descending by score; the Paris passage (index 1) must be ranked first.
    assert.equal(results[0].index, 1, 'the relevant (Paris) passage ranks first');
    assert.ok(results[0].score > results[results.length - 1].score, 'scores are ordered descending');
  });

  test('empty inputs return null (no throw)', async () => {
    const { getLocalReranker } = await loadReranker();
    const reranker = getLocalReranker();
    assert.equal(await reranker.rerank('', ['x']), null);
    assert.equal(await reranker.rerank('q', []), null);
  });
});
