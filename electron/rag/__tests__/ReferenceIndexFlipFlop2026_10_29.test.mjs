// A Windows customer uploaded 30 PDFs as reference files (2026-10-29): the app
// crashed three times during the upload, and for hours each file's status
// cycled indexed → not indexed → error → indexing → finished. Three faults in
// the embedding path, each reproduced here against the built pipeline:
//
//  1. The bundled on-device model ran whatever batch it was handed. Indexing
//     sizes its batches once per file for the provider active at the start
//     (32 Natively, 100 Gemini/OpenAI); after a fallback those batches reached
//     the on-device model whole. 100 aborts the process natively (SIGTRAP,
//     ModeHybridRetriever F22), so no try/catch could save the upload.
//  2. The batch retry re-read this.provider after its backoff. Two files index
//     at once; when the other promoted the fallback during the wait, the retry
//     embedded with the on-device model and labelled the 384-d vectors with
//     the primary's 2048-d space: "indexed", and scoring 0 against everything.
//  3. A single-text embed (résumé / JD ingest) promoted the fallback on ONE
//     failure, switching the whole app's space — every reference file then
//     read "not indexed", re-indexed into the stand-in, and flipped back when
//     the primary answered the reprobe.
//
// Run with: npm run build:electron && node --test electron/rag/__tests__/ReferenceIndexFlipFlop2026_10_29.test.mjs

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const dist = (p) => pathToFileURL(path.join(repoRoot, 'dist-electron/electron', p)).href;

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-index-flipflop-'));
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    return {
      app: { isPackaged: false, isReady: () => true, getAppPath: () => repoRoot, getPath: () => userData, getVersion: () => '0.0.0-test' },
      shell: { openPath: async () => '' },
      safeStorage: { isEncryptionAvailable: () => false },
    };
  }
  return origLoad.apply(this, arguments);
};

let EmbeddingPipeline, LocalEmbeddingProvider, BUNDLED_LOCAL_EMBEDDING, findEmbeddingCatalogModel, BUNDLED_CATALOG_ID;
before(async () => {
  ({ EmbeddingPipeline } = await import(dist('rag/EmbeddingPipeline.js')));
  ({ LocalEmbeddingProvider } = await import(dist('rag/providers/LocalEmbeddingProvider.js')));
  ({ BUNDLED_LOCAL_EMBEDDING } = await import(dist('rag/bundledLocalEmbedding.js')));
  ({ findEmbeddingCatalogModel, BUNDLED_CATALOG_ID } = await import(dist('rag/embeddingModelCatalog.js')));
});

const stubDb = { prepare: () => ({ run: () => {}, get: () => undefined, all: () => [] }) };

function pipelineWith(primary, fallback) {
  const pipe = new EmbeddingPipeline(stubDb, {});
  pipe['provider'] = primary;
  pipe['fallbackProvider'] = fallback;
  pipe['queryRetryBackoffMs'] = [1, 1, 1];
  return pipe;
}

function vectors(texts, dims) {
  return texts.map(() => new Array(dims).fill(0.1));
}

describe('1. the on-device model never runs an oversized batch', () => {
  /** A bundled provider whose worker is a recorder, so no ONNX loads. */
  function recordingProvider(provider) {
    const posted = [];
    provider.ensureLoaded = async () => {};
    provider.postToWorker = async (msg) => {
      posted.push(msg.texts.length);
      return { vectors: vectors(msg.texts, provider.dimensions), dimensions: provider.dimensions };
    };
    return posted;
  }

  test('the bundled recipe carries the measured-safe cap', () => {
    assert.equal(BUNDLED_LOCAL_EMBEDDING.maxBatchSize, 16);
  });

  test('a 100-text batch (Gemini/OpenAI sizing) reaches the worker 16 at a time', async () => {
    const provider = new LocalEmbeddingProvider();
    const posted = recordingProvider(provider);
    const out = await provider.embedBatch(Array.from({ length: 100 }, (_, i) => `chunk ${i}`));
    assert.equal(out.length, 100);
    assert.ok(Math.max(...posted) <= 16, `largest worker message: ${Math.max(...posted)}`);
    assert.equal(posted.reduce((a, b) => a + b, 0), 100);
  });

  test('the bundled model picked from the catalogue is capped too', async () => {
    const entry = findEmbeddingCatalogModel(BUNDLED_CATALOG_ID);
    assert.ok(entry?.bundled, 'catalogue lists the bundled model');
    const provider = new LocalEmbeddingProvider({ modelId: BUNDLED_CATALOG_ID });
    const posted = recordingProvider(provider);
    await provider.embedBatch(Array.from({ length: 32 }, (_, i) => `chunk ${i}`));
    assert.ok(Math.max(...posted) <= 16, `largest worker message: ${Math.max(...posted)}`);
  });
});

describe('2. a batch retry embeds with the provider it labels', () => {
  test('a promotion during the retry wait does not mislabel on-device vectors as the primary\'s', async () => {
    let primaryCalls = 0;
    const primary = {
      name: 'natively', space: 'natively:voyage-4:2048', dimensions: 2048,
      async embedBatch(texts) {
        primaryCalls++;
        if (primaryCalls === 1) throw Object.assign(new Error('429 Too Many Requests'), { status: 429, retryAfter: 0 });
        return vectors(texts, 2048);
      },
    };
    const fallback = {
      name: 'local', space: 'local:xenova/multilingual-e5-small:384', dimensions: 384,
      async embedBatch(texts) { return vectors(texts, 384); },
    };
    const pipe = pipelineWith(primary, fallback);

    const inflight = pipe.getEmbeddingsWithFallback(['¿Qué es una base de datos?']);
    // The other file's indexing promotes the fallback while this one waits to retry.
    await new Promise((r) => setTimeout(r, 0));
    pipe['promoteFallbackProvider'](fallback);
    const result = await inflight;

    assert.equal(result.space, primary.space);
    assert.equal(result.embeddings[0].length, 2048, 'vector width must match the space it is labelled with');
    assert.equal(primaryCalls, 2, 'the retry went to the primary');
  });
});

describe('3. one failed single embed does not switch the app\'s embedding space', () => {
  function singleProviders(failPrimary) {
    const primary = {
      name: 'natively', space: 'natively:voyage-4:2048', dimensions: 2048,
      async embed() { if (failPrimary()) throw new Error('ECONNRESET'); return new Array(2048).fill(0.1); },
      async embedBatch(texts) { return vectors(texts, 2048); },
    };
    const fallback = {
      name: 'local', space: 'local:xenova/multilingual-e5-small:384', dimensions: 384,
      async embed() { return new Array(384).fill(0.1); },
      async embedBatch(texts) { return vectors(texts, 384); },
    };
    return { primary, fallback };
  }

  test('a single failure fails that embed and keeps the primary active', async () => {
    const { primary, fallback } = singleProviders(() => true);
    const pipe = pipelineWith(primary, fallback);
    await assert.rejects(pipe.getEmbeddingWithFallback('Experiencia en Python'), /ECONNRESET/);
    assert.equal(pipe['provider'], primary, 'active space unchanged after one failure');
  });

  test('a sustained outage still promotes the fallback, labelled as the fallback', async () => {
    const { primary, fallback } = singleProviders(() => true);
    const pipe = pipelineWith(primary, fallback);
    let last;
    for (let i = 0; i < 5; i++) {
      last = await pipe.getEmbeddingWithFallback(`texto ${i}`).catch((e) => e);
    }
    assert.ok(!(last instanceof Error), 'the fifth consecutive failure is served by the fallback');
    assert.equal(last.space, fallback.space);
    assert.equal(last.embedding.length, 384);
    assert.equal(pipe['provider'], fallback, 'promoted only after the streak');
    pipe['primaryReprobeTimer'] && clearInterval(pipe['primaryReprobeTimer']);
  });
});
