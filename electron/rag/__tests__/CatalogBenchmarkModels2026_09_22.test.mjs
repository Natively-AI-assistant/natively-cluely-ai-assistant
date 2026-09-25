// The local embedding catalog carries every model the 2026-09-21 benchmark brief
// named, with the recipe that benchmark verified (2026-09-22).
//
// Pooling and query/document prefixes are NOT cosmetic. An e5 model fed bare
// text, or an Arctic/BGE model mean-pooled without its query instruction,
// still returns plausible unit vectors, just measurably worse ones. The
// catalog's BGE entry had exactly that (mean pooling, no instruction), and the
// provider on main had no prefix support at all. This pins each catalog entry
// to the recipe in electron/rag/embeddingExperiments.ts, which is what the
// benchmark measured (docs/local-embedding-benchmark.md), and pins that the
// provider applies it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const electronId = require.resolve('electron');
require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { isPackaged: false, getAppPath: () => root, getPath: () => os.tmpdir() } } };
const dist = (p) => pathToFileURL(path.resolve(root, 'dist-electron/electron', p)).href;
const { EMBEDDING_MODEL_CATALOG, findEmbeddingCatalogModel, BUNDLED_CATALOG_ID } = await import(dist('rag/embeddingModelCatalog.js'));
const { EMBEDDING_EXPERIMENTS } = await import(dist('rag/embeddingExperiments.js'));
const { LocalEmbeddingProvider } = await import(dist('rag/providers/LocalEmbeddingProvider.js'));

// catalog id → benchmark registry key, for every model the brief named.
const BRIEF = {
  'minilm-l6-v2': 'minilm-baseline',
  'snowflake-arctic-embed-xs': 'arctic-xs',
  'snowflake-arctic-embed-s': 'arctic-s',
  'snowflake-arctic-embed-m': 'arctic-m',
  'bge-small-en-v1.5': 'bge-small-en',
  'e5-small-v2': 'e5-small-v2',
  'gte-small': 'gte-small',
  'nomic-embed-text-v1.5': 'nomic-v1.5',
  'multilingual-e5-small': 'multilingual-e5-small',
  // Round 3 (high-end tier), added on request and benchmarked the same way.
  'snowflake-arctic-embed-l-v2.0': 'arctic-l-v2',
  'mxbai-embed-large-v1': 'mxbai-large-v1',
  'qwen3-embedding-0.6b-onnx': 'qwen3-embedding-0.6b',
};
const HIGH_END = ['snowflake-arctic-embed-l-v2.0', 'mxbai-embed-large-v1', 'qwen3-embedding-0.6b-onnx'];

describe('every model the benchmark brief named is in the local catalog', () => {
  for (const [id, key] of Object.entries(BRIEF)) {
    test(`${id} matches the benchmarked recipe (${key})`, () => {
      const m = findEmbeddingCatalogModel(id);
      assert.ok(m, `${id} missing from EMBEDDING_MODEL_CATALOG`);
      const r = EMBEDDING_EXPERIMENTS[key];
      assert.ok(r, `${key} missing from the benchmark registry`);
      assert.equal(m.runtime, 'onnx');
      assert.equal(m.modelId, r.modelId);
      assert.equal(m.dimensions, r.dimensions);
      assert.equal(m.pooling, r.pooling, `${id}: pooling`);
      assert.equal(m.queryPrefix || '', r.queryPrefix, `${id}: query prefix`);
      assert.equal(m.documentPrefix || '', r.documentPrefix, `${id}: document prefix`);
      assert.equal(m.revision, r.revision, `${id}: pinned revision`);
      assert.match(m.revision, /^[0-9a-f]{40}$/);
    });
  }

  test('every new ONNX entry pins every file by sha256, and bytes add up', () => {
    for (const id of Object.keys(BRIEF).filter((i) => !['minilm-l6-v2', 'bge-small-en-v1.5'].includes(i))) {
      const m = findEmbeddingCatalogModel(id);
      assert.ok(m.files.some((f) => f.repoPath === 'onnx/model_quantized.onnx'), `${id}: q8 ONNX file`);
      for (const f of m.files) assert.match(f.sha256 ?? '', /^[0-9a-f]{64}$/, `${id}: ${f.repoPath} sha256`);
      assert.equal(m.bytes, m.files.reduce((a, f) => a + f.bytes, 0), `${id}: bytes total`);
    }
  });

  test('the high-end models carry a batch cap, memory headroom and (long-context) an input cap', () => {
    for (const id of HIGH_END) {
      const m = findEmbeddingCatalogModel(id);
      assert.ok(m.maxBatchSize > 0 && m.maxBatchSize <= 4, `${id}: batch cap (the 30s worker deadline, §8b)`);
      assert.ok(m.memoryHeadroomGB >= 0.5, `${id}: memory headroom from its measured peak RSS`);
      assert.equal(m.dimensions, 1024);
      assert.notEqual(m.bundled, true);
    }
    // Uncapped, a ~2400-token CSV chunk SIGTRAPped both long-context models.
    assert.equal(findEmbeddingCatalogModel('snowflake-arctic-embed-l-v2.0').maxInputTokens, 512);
    assert.equal(findEmbeddingCatalogModel('qwen3-embedding-0.6b-onnx').maxInputTokens, 512);
    // Batching changed Qwen3's q8 vectors (cosine 0.93-0.96 vs single), so one text per run.
    assert.equal(findEmbeddingCatalogModel('qwen3-embedding-0.6b-onnx').maxBatchSize, 1);
    assert.equal(findEmbeddingCatalogModel('nomic-embed-text-v1.5').maxBatchSize, 4, 'nomic SIGTRAPped at batch 16');
  });

  test('exactly one entry is bundled, and it is the model the app ships', () => {
    assert.deepEqual(EMBEDDING_MODEL_CATALOG.filter((m) => m.bundled).map((m) => m.id), [BUNDLED_CATALOG_ID]);
    assert.equal(BUNDLED_CATALOG_ID, 'multilingual-e5-small');
  });

  test('catalog ids are unique', () => {
    const ids = EMBEDDING_MODEL_CATALOG.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('the provider applies a catalog entry\'s prefixes', () => {
  /** A provider whose worker is a fake that records what text it was sent. */
  function recording(id) {
    const p = new LocalEmbeddingProvider(id ? { modelId: id } : undefined);
    const sent = [];
    p.loaded = true;
    p.postToWorker = async (msg) => { sent.push(msg); return { vectors: msg.texts.map(() => new Array(p.dimensions).fill(0)), dimensions: p.dimensions }; };
    return { p, sent };
  }

  test('e5-small-v2: "query: " on queries, "passage: " on documents', async () => {
    const { p, sent } = recording('e5-small-v2');
    await p.embedQuery('how long is the grace period');
    await p.embedBatch(['The grace period runs for seven days.']);
    assert.deepEqual(sent.map((m) => m.texts[0]), ['query: how long is the grace period', 'passage: The grace period runs for seven days.']);
    assert.equal(sent[0].pooling, 'mean');
  });

  test('Arctic S: the retrieval instruction on queries only, CLS pooling', async () => {
    const { p, sent } = recording('snowflake-arctic-embed-s');
    await p.embedQuery('q');
    await p.embedBatch(['d']);
    assert.deepEqual(sent.map((m) => m.texts[0]), ['Represent this sentence for searching relevant passages: q', 'd']);
    assert.equal(sent[0].pooling, 'cls');
  });

  test('Nomic: its task prefixes on both sides', async () => {
    const { p, sent } = recording('nomic-embed-text-v1.5');
    await p.embedQuery('q');
    await p.embedBatch(['d']);
    assert.deepEqual(sent.map((m) => m.texts[0]), ['search_query: q', 'search_document: d']);
  });

  test('GTE small is symmetric: no prefix either side', async () => {
    const { p, sent } = recording('gte-small');
    await p.embedQuery('q');
    await p.embedBatch(['d']);
    assert.deepEqual(sent.map((m) => m.texts[0]), ['q', 'd']);
  });

  test('the argument-less provider is the bundled model with its prefixes', async () => {
    const { p, sent } = recording(undefined);
    assert.equal(p.catalogId, 'multilingual-e5-small');
    await p.embedQuery('q');
    await p.embedBatch(['d']);
    assert.deepEqual(sent.map((m) => m.texts[0]), ['query: q', 'passage: d']);
  });

  test('an oversized batch is split into runs of at most maxBatchSize (profile ingest sends 10)', async () => {
    const { p, sent } = recording('nomic-embed-text-v1.5');
    const out = await p.embedBatch(Array.from({ length: 10 }, (_, i) => `d${i}`));
    assert.deepEqual(sent.map((m) => m.texts.length), [4, 4, 2]);
    assert.equal(out.length, 10);
    assert.equal(sent[0].texts[0], 'search_document: d0', 'prefix still applied per text');
  });

  test('the input-token cap reaches the worker on init and embed', async () => {
    const { p, sent } = recording('snowflake-arctic-embed-l-v2.0');
    await p.embedQuery('q');
    assert.equal(sent[0].maxInputTokens, 512);
    assert.equal(sent[0].texts[0], 'query: q');
    assert.equal(sent[0].pooling, 'cls');
  });

  test('a width mismatch from the worker is refused, not indexed', async () => {
    const p = new LocalEmbeddingProvider({ modelId: 'snowflake-arctic-embed-m' });
    p.loaded = true;
    p.postToWorker = async (msg) => ({ vectors: msg.texts.map(() => new Array(384).fill(0)), dimensions: 384 });
    await assert.rejects(p.embedBatch(['x']), /returned 384d but this provider advertises 768d/);
  });
});
