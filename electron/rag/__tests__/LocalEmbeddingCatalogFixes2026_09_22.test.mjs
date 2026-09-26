// electron/rag/__tests__/LocalEmbeddingCatalogFixes2026_09_22.test.mjs
//
// Post-merge fixes for PR #582 (curated local embedding catalog + custom
// reranker endpoint). Each test was written against the merged code FIRST and
// failed there; see the commit message for the reproduction of each.
//
// Run via: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>

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

// A throwaway userData so SettingsManager can run under ELECTRON_RUN_AS_NODE,
// where the real `electron` export has no `app`.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pr582-fixes-'));
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: false,
        isReady: () => true,
        getAppPath: () => repoRoot,
        getPath: () => userData,
        getVersion: () => '0.0.0-test',
      },
      shell: { openPath: async () => '' },
      safeStorage: { isEncryptionAvailable: () => false },
    };
  }
  return origLoad.apply(this, arguments);
};

const MINILM_PRESENT = fs.existsSync(
  path.join(repoRoot, 'resources/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx'),
);

let SettingsManager, buildEmbeddingConfig, LocalEmbeddingProvider, EmbeddingProviderResolver;
before(async () => {
  ({ SettingsManager } = await import(dist('services/SettingsManager.js')));
  ({ buildEmbeddingConfig } = await import(dist('rag/embeddingConfigIdentity.js')));
  ({ LocalEmbeddingProvider } = await import(dist('rag/providers/LocalEmbeddingProvider.js')));
  ({ EmbeddingProviderResolver } = await import(dist('rag/EmbeddingProviderResolver.js')));
});

function pickCatalogModel(id) {
  // Exactly what embedding:use-local-model persists.
  const s = SettingsManager.getInstance();
  s.set('localEmbeddingModelId', id);
  s.set('embedding', { mode: 'manual', provider: 'local', localModelId: id, model: id, dimensions: 1024 });
}

describe('a catalog pick resolves as LOCAL, not as Ollama', () => {
  test('qwen3 catalog id is not routed to Ollama', () => {
    pickCatalogModel('qwen3-embedding-0.6b-q4');
    const cfg = buildEmbeddingConfig();
    assert.equal(cfg.embeddingProvider, 'local');
    assert.equal(cfg.ollamaEmbeddingModel, undefined, 'a catalog id is not an Ollama model name');
    assert.equal(cfg.localEmbeddingModelId, 'qwen3-embedding-0.6b-q4');
  });

  test('the bundled catalog id (minilm-l6-v2) is not routed to Ollama either', () => {
    pickCatalogModel('minilm-l6-v2');
    const cfg = buildEmbeddingConfig();
    assert.equal(cfg.embeddingProvider, 'local');
    assert.equal(cfg.ollamaEmbeddingModel, undefined);
  });

  test('an Ollama model picked on the Built-in card still routes to Ollama', () => {
    const s = SettingsManager.getInstance();
    s.set('localEmbeddingModelId', undefined);
    s.set('embedding', { mode: 'manual', provider: 'local', model: 'nomic-embed-text', dimensions: 768 });
    const cfg = buildEmbeddingConfig();
    assert.equal(cfg.embeddingProvider, 'ollama');
    assert.equal(cfg.ollamaEmbeddingModel, 'nomic-embed-text');
  });
});

describe('the selected catalog model reaches the provider through the config, not a settings back-channel', () => {
  test('resolver builds the local provider from config.localEmbeddingModelId', async () => {
    SettingsManager.getInstance().set('localEmbeddingModelId', undefined);
    const provider = await EmbeddingProviderResolver.resolve({
      embeddingMode: 'manual',
      embeddingProvider: 'local',
      localEmbeddingModelId: 'bge-small-en-v1.5',
    });
    assert.equal(provider.name, 'local');
    assert.equal(provider.catalogId, 'bge-small-en-v1.5');
  });

  test('a non-local pin that falls through stays on the bundled model even with a catalog pick configured', async () => {
    // OpenAI pinned with no key yields no candidate, so resolution reaches the
    // terminal local fallback. (Auto mode is not used here: it would pick up a
    // running Ollama on the test machine.)
    const provider = await EmbeddingProviderResolver.resolve({
      embeddingMode: 'manual',
      embeddingProvider: 'openai',
      localEmbeddingModelId: 'qwen3-embedding-4b-q4',
    });
    // The bundled model is multilingual-e5-small since 2026-09-22.
    assert.equal(provider.catalogId, 'multilingual-e5-small');
  });

  test('an argument-less LocalEmbeddingProvider (the pipeline fallback) is always the bundled model', () => {
    // A user on a hosted primary who once picked Qwen3-4B must not get a
    // 2.5 GB llama.cpp model as the "lightweight" offline fallback.
    SettingsManager.getInstance().set('localEmbeddingModelId', 'qwen3-embedding-4b-q4');
    const fallback = new LocalEmbeddingProvider();
    assert.equal(fallback.catalogId, 'multilingual-e5-small');
    assert.equal(fallback.model, 'Xenova/multilingual-e5-small');
    assert.equal(fallback.dimensions, 384);
    assert.equal(fallback.runtime, 'onnx');
  });
});

describe('GGUF vectors are unit-length', () => {
  test('finalizeGgufVector normalizes at native width (no truncation)', async () => {
    const { finalizeGgufVector } = await import(dist('rag/providers/ggufEmbeddingVector.js'));
    // Measured on real Qwen3-Embedding-0.6B output: L2 norm 118.17.
    const raw = Float32Array.from({ length: 1024 }, (_, i) => ((i % 7) - 3) * 3.7);
    const out = finalizeGgufVector(raw, 1024);
    assert.equal(out.length, 1024);
    assert.ok(Math.abs(Math.hypot(...out) - 1) < 1e-6, `norm ${Math.hypot(...out)}`);
  });

  test('finalizeGgufVector truncates (Matryoshka) and then normalizes', async () => {
    const { finalizeGgufVector } = await import(dist('rag/providers/ggufEmbeddingVector.js'));
    const raw = Float32Array.from({ length: 2560 }, (_, i) => (i % 5) + 1);
    const out = finalizeGgufVector(raw, 1024);
    assert.equal(out.length, 1024);
    assert.ok(Math.abs(Math.hypot(...out) - 1) < 1e-6);
  });
});

describe('probe / test providers respect the ONNX session gate', () => {
  test(
    'with every slot held, a probe provider fails fast instead of loading a session past the cap',
    { skip: !MINILM_PRESENT ? 'bundled MiniLM not downloaded' : false, timeout: 20_000 },
    async () => {
      const { acquireOnnxSlot } = await import(dist('utils/onnxThreadConfig.js'));
      const releases = [await acquireOnnxSlot('normal'), await acquireOnnxSlot('normal')];
      const probe = new LocalEmbeddingProvider({ modelId: 'minilm-l6-v2', slotWaitMs: 300 });
      try {
        await assert.rejects(probe.embed('probe'), /slot/i);
      } finally {
        releases.forEach((r) => r());
        await probe.dispose('test');
      }
    },
  );
});

describe('custom reranker privacy gate', () => {
  let cfg;
  before(async () => { cfg = await import(dist('services/reranking/rerankerConfig.js')); });

  test('private/loopback literals are private', () => {
    for (const u of ['http://localhost:1234', 'http://127.0.0.1:8080', 'http://10.0.0.5', 'http://192.168.1.20:1234',
      'http://172.16.4.2', 'http://169.254.1.1', 'http://[::1]:8080', 'http://[fd12:3456::1]/v1']) {
      assert.equal(cfg.isLoopbackOrPrivateHost(u), true, u);
    }
  });

  test('public DNS names that merely START with a private octet are NOT private', () => {
    for (const u of ['https://10.proxy.example.com', 'https://127.0.0.1.nip.io', 'https://192.168.attacker.net',
      'https://172.20.evil.io', 'https://169.254.example.org', 'https://fd00.example.com', 'https://8.8.8.8',
      'http://172.32.0.1']) {
      assert.equal(cfg.isLoopbackOrPrivateHost(u), false, u);
    }
  });

  test('the Test button applies the same gate as retrieval to a public custom endpoint', () => {
    const base = { localOnly: true, referenceFilesScopeAllowed: true };
    assert.equal(cfg.customRerankPrivacyBlock({ ...base, customEndpoint: 'https://rerank.example.com' }), 'local-only-mode');
    assert.equal(cfg.customRerankPrivacyBlock({ ...base, customEndpoint: 'http://localhost:1234' }), null);
    assert.equal(
      cfg.customRerankPrivacyBlock({ localOnly: false, referenceFilesScopeAllowed: false, customEndpoint: 'https://rerank.example.com' }),
      'reference-files-scope-denied',
    );
  });
});

describe('catalog downloads are pinned and verifiable', () => {
  test('every entry pins a commit and every weights file carries a sha256', async () => {
    const { EMBEDDING_MODEL_CATALOG } = await import(dist('rag/embeddingModelCatalog.js'));
    for (const m of EMBEDDING_MODEL_CATALOG) {
      assert.match(m.revision, /^[0-9a-f]{40}$/, `${m.id}: 'main' is a moving target`);
      for (const f of m.files) {
        if (/\.(gguf|onnx)$/.test(f.repoPath)) {
          assert.match(String(f.sha256), /^[0-9a-f]{64}$/, `${m.id}/${f.repoPath} is unverified`);
        }
      }
      assert.equal(m.bytes, m.files.reduce((n, f) => n + f.bytes, 0), `${m.id}: total != sum of files`);
    }
  });
});
