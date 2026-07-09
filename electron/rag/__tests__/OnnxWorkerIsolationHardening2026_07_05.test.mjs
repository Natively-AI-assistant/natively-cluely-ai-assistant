// electron/rag/__tests__/OnnxWorkerIsolationHardening2026_07_05.test.mjs
//
// Regression coverage for the SIGTRAP crash hardening (2026-07-05).
//
// ROOT CAUSE (established via 9/9 real macOS crash reports at
// ~/Library/Logs/DiagnosticReports/Electron-2026-07-0[2,3,5]-*.ips): the app
// crashed on the MAIN THREAD inside ONNX Runtime's BFC allocator
// (BFCArena::Extend -> posix_memalign) during a live InferenceSession::Run()
// call. Whisper's streaming STT worker and IntentClassifier's zero-shot
// worker already ran their ONNX sessions inside a worker_threads.Worker;
// LocalEmbeddingProvider was the only one still calling pipeline()/embed()
// directly on the main process (its real-world trigger: Gemini embedding
// keys rate-limited -> EmbeddingPipeline falls back to
// LocalEmbeddingProvider -> ~100-chunk batch embed() runs main-thread ONNX
// inference concurrently with the other two live sessions -> crash within
// ~1s in every historical log). LocalReranker had the identical unsafe
// pattern (currently inert — no bundled model yet — fixed proactively).
//
// This file asserts three things, matching the agreed fix scope:
//   1. LocalEmbeddingProvider and LocalReranker no longer execute
//      pipeline()/from_pretrained() inference on the main thread — they
//      delegate to a dedicated worker_threads.Worker (source guard +
//      behavioral test with a mocked Worker).
//   2. The two new worker scripts (localEmbeddingWorker.ts,
//      localRerankerWorker.ts) host the actual model load + inference, and
//      set bounded ONNX SessionOptions.
//   3. All FOUR local ONNX loaders (LocalEmbeddingProvider's worker,
//      LocalReranker's worker, IntentClassifier's worker, Whisper's worker)
//      apply the shared bounded thread-count config
//      (electron/utils/onnxThreadConfig.ts) — mitigating the proven crash
//      surface (concurrent multi-session Run() calls contending for native
//      allocator/thread-pool resources) without fully serializing inference
//      across loaders (which would throttle Whisper's ~750ms real-time
//      streaming loop).
//
// Run via: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>
// (native onnxruntime-node / better-sqlite3 ABI convention for this repo).

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import Module from 'node:module';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

// 2026-07-06: Disable the shared ONNX gate (free-memory floor) for these
// tests — the test environment often has <2GB free, and these tests are
// validating worker isolation, NOT the gate. The gate has its own dedicated
// tests in gate-probe.mjs and onnxThreadConfig.test.mjs. Set the env BEFORE
// importing the compiled providers so the gate reads the override on its
// first call.
process.env.NATIVELY_ONNX_MIN_FREE_GB = '0';
process.env.NATIVELY_ONNX_MAX_CONCURRENT_SESSIONS = '99';

// ---------------------------------------------------------------------------
// 1 & 2. Source guards — cheap, deterministic, no build/mocking required.
// ---------------------------------------------------------------------------

describe('worker isolation — source guards', () => {
  test('LocalEmbeddingProvider delegates to worker_threads.Worker (no direct pipeline() call)', () => {
    const src = read('electron/rag/providers/LocalEmbeddingProvider.ts');
    assert.match(src, /import\s*\{\s*Worker\s*\}\s*from\s*'worker_threads'/, 'must import Worker');
    assert.match(src, /new Worker\(/, 'must construct a Worker instance');
    assert.doesNotMatch(src, /await pipeline\(/, 'must NOT call pipeline() directly on the main thread');
    assert.doesNotMatch(
      src,
      /new Function\(['"]return import\(["']@huggingface\/transformers["']\)['"]\)/,
      'the ESM transformers import must live in the worker file, not the main-thread provider',
    );
    // Public API preserved — callers (EmbeddingPipeline, EmbeddingProviderResolver) need no changes.
    assert.match(src, /async embed\(text: string\): Promise<number\[\]>/);
    assert.match(src, /async embedQuery\(text: string\): Promise<number\[\]>/);
    assert.match(src, /async embedBatch\(texts: string\[\]\): Promise<number\[\]\[\]>/);
    assert.match(src, /async isAvailable\(\): Promise<boolean>/);
  });

  test('LocalEmbeddingProvider worker script hosts the pipeline() call with bounded session options', () => {
    const src = read('electron/rag/providers/localEmbeddingWorker.ts');
    assert.match(src, /parentPort/, 'must run as a Worker (parentPort)');
    assert.match(src, /pipeline\(\s*['"]feature-extraction['"]/);
    assert.match(src, /getBoundedOnnxSessionOptions/);
    assert.match(src, /session_options:\s*getBoundedOnnxSessionOptions\(\)/);
  });

  test('LocalReranker delegates to worker_threads.Worker (no direct AutoModel/AutoTokenizer calls)', () => {
    const src = read('electron/rag/LocalReranker.ts');
    assert.match(src, /import\s*\{\s*Worker\s*\}\s*from\s*'worker_threads'/, 'must import Worker');
    assert.match(src, /new Worker\(/, 'must construct a Worker instance');
    assert.doesNotMatch(
      src,
      /AutoModelForSequenceClassification\.from_pretrained/,
      'must NOT load the cross-encoder model on the main thread',
    );
    assert.doesNotMatch(src, /AutoTokenizer\.from_pretrained/, 'must NOT load the tokenizer on the main thread');
    // Public API preserved — callers (ModeHybridRetriever etc.) need no changes.
    assert.match(src, /export function getLocalReranker\(\)/);
    assert.match(src, /async rerank\(query: string, passages: string\[\]\): Promise<RerankResult\[\] \| null>/);
    assert.match(src, /async isAvailable\(\): Promise<boolean>/);
    assert.match(src, /async prewarm\(\): Promise<void>/);
  });

  test('LocalReranker worker script hosts the AutoModel/AutoTokenizer load with bounded session options', () => {
    const src = read('electron/rag/localRerankerWorker.ts');
    assert.match(src, /parentPort/, 'must run as a Worker (parentPort)');
    assert.match(src, /AutoModelForSequenceClassification\.from_pretrained/);
    assert.match(src, /AutoTokenizer\.from_pretrained/);
    assert.match(src, /getBoundedOnnxSessionOptions/);
    assert.match(src, /session_options:\s*getBoundedOnnxSessionOptions\(\)/);
  });

  test('IntentClassifier zero-shot worker applies bounded session options', () => {
    const src = read('electron/llm/intentClassifierWorker.ts');
    assert.match(src, /getBoundedOnnxSessionOptions/);
    assert.match(src, /session_options:\s*getBoundedOnnxSessionOptions\(\)/);
  });

  test('Whisper worker applies bounded session options on its ASR pipeline', () => {
    const src = read('electron/audio/whisper/whisperWorker.ts');
    assert.match(src, /getBoundedOnnxSessionOptions/);
    assert.match(src, /session_options:\s*getBoundedOnnxSessionOptions\(\)/);
  });

  test('packaging: the two new worker scripts are asar-unpacked (native ONNX addon needs a real on-disk path)', () => {
    const pkg = JSON.parse(read('package.json'));
    const unpack = pkg.build?.asarUnpack ?? [];
    assert.ok(unpack.includes('**/localEmbeddingWorker.js'), 'localEmbeddingWorker.js must be asar-unpacked');
    assert.ok(unpack.includes('**/localRerankerWorker.js'), 'localRerankerWorker.js must be asar-unpacked');
    // Existing entries must remain (no regression to the already-shipped workers).
    assert.ok(unpack.includes('**/whisperWorker.js'));
    assert.ok(unpack.includes('**/intentClassifierWorker.js'));
  });

  test('packaging: @huggingface/transformers node_modules is asar-unpacked (2026-07-05 fix)', () => {
    // ROOT CAUSE: all four ONNX-worker files above load @huggingface/transformers
    // via `new Function('return import("@huggingface/transformers")')` — a
    // deliberate escape hatch so TypeScript's CJS-target compiler never rewrites
    // the ESM-only package's dynamic import() to require() (see whisperWorker.ts
    // header comment). The worker .js files themselves are already asar-unpacked
    // (assertions above), so at runtime they resolve import() specifiers from a
    // REAL on-disk directory under app.asar.unpacked/. But node_modules/
    // @huggingface/transformers itself stayed packed inside app.asar — an ESM
    // dynamic import cannot traverse through the .asar virtual filesystem from
    // an already-unpacked search root, so Node's resolver throws "Cannot find
    // package '@huggingface/transformers'" (observed in production logs
    // 2026-07-05, intermittent depending on which worker ran first). Unpacking
    // the whole package directory alongside the worker scripts fixes this the
    // same way sharp/onnxruntime-node's native binaries are handled.
    const pkg = JSON.parse(read('package.json'));
    const unpack = pkg.build?.asarUnpack ?? [];
    assert.ok(
      unpack.includes('**/node_modules/@huggingface/transformers/**'),
      '@huggingface/transformers must be asar-unpacked so ESM dynamic import() from the already-unpacked worker files can resolve it on disk',
    );
    assert.ok(pkg.dependencies?.['@huggingface/transformers'], 'must remain a runtime dependency (not dev-only) so it ships in node_modules at all');
  });
});

// ---------------------------------------------------------------------------
// 3. getBoundedOnnxSessionOptions — the shared thread-bound config itself.
// ---------------------------------------------------------------------------

describe('getBoundedOnnxSessionOptions', () => {
  const modPath = path.resolve(repoRoot, 'dist-electron/electron/utils/onnxThreadConfig.js');

  test('defaults to 1 intra-op + 1 inter-op thread, sequential execution mode', async () => {
    delete process.env.NATIVELY_ONNX_INTRA_OP_THREADS;
    delete process.env.NATIVELY_ONNX_INTER_OP_THREADS;
    const { getBoundedOnnxSessionOptions } = await import(pathToFileURL(modPath).href);
    const opts = getBoundedOnnxSessionOptions();
    assert.equal(opts.intraOpNumThreads, 1);
    assert.equal(opts.interOpNumThreads, 1);
    assert.equal(opts.executionMode, 'sequential');
  });

  test('overridable via NATIVELY_ONNX_INTRA_OP_THREADS / NATIVELY_ONNX_INTER_OP_THREADS env vars', async () => {
    process.env.NATIVELY_ONNX_INTRA_OP_THREADS = '2';
    process.env.NATIVELY_ONNX_INTER_OP_THREADS = '3';
    try {
      const { getBoundedOnnxSessionOptions } = await import(pathToFileURL(modPath).href);
      const opts = getBoundedOnnxSessionOptions();
      assert.equal(opts.intraOpNumThreads, 2);
      assert.equal(opts.interOpNumThreads, 3);
    } finally {
      delete process.env.NATIVELY_ONNX_INTRA_OP_THREADS;
      delete process.env.NATIVELY_ONNX_INTER_OP_THREADS;
    }
  });

  test('invalid/non-positive env overrides fall back to the safe default (1)', async () => {
    process.env.NATIVELY_ONNX_INTRA_OP_THREADS = '-5';
    process.env.NATIVELY_ONNX_INTER_OP_THREADS = 'not-a-number';
    try {
      const { getBoundedOnnxSessionOptions } = await import(pathToFileURL(modPath).href);
      const opts = getBoundedOnnxSessionOptions();
      assert.equal(opts.intraOpNumThreads, 1);
      assert.equal(opts.interOpNumThreads, 1);
    } finally {
      delete process.env.NATIVELY_ONNX_INTRA_OP_THREADS;
      delete process.env.NATIVELY_ONNX_INTER_OP_THREADS;
    }
  });
});

// ---------------------------------------------------------------------------
// Behavioral: drive the REAL compiled providers with a fully mocked
// worker_threads.Worker + electron module, proving inference is delegated
// through postMessage/worker "message" events rather than any in-process
// pipeline()/AutoModel call. This is the architectural proof the diagnosis
// asked for — no real ONNX model is loaded in this test.
//
// IMPORTANT: dynamic import() of a CommonJS module caches by resolved file
// path regardless of any query-string cache-busting trick, so the compiled
// provider's top-level `require('worker_threads')` binds to the mocked
// `Worker` class exactly ONCE (whichever mock was active on first import).
// Rather than fight the module cache, we patch `Module._load` ONCE for this
// whole describe block (before either compiled module is ever imported) with
// a single mock Worker class whose behavior is looked up from a mutable
// "active handler" set fresh by each test — so the same constructed class
// can act like a clean success path in one test and a simulated crash in the
// next without re-importing anything.
// ---------------------------------------------------------------------------

let activeWorkerHandler = null; // (worker, msg) => void, set per-test
const constructedWorkerPaths = [];

const origModuleLoad = Module._load;
Module._load = function patched(request, parentModule, isMain) {
  if (request === 'worker_threads') {
    return {
      Worker: class MockWorker extends EventEmitter {
        constructor(workerPath) {
          super();
          constructedWorkerPaths.push(workerPath);
          this.postMessage = (msg) => {
            queueMicrotask(() => {
              if (activeWorkerHandler) activeWorkerHandler(this, msg);
            });
          };
        }
        terminate() {
          return Promise.resolve(0);
        }
      },
    };
  }
  if (request === 'electron') {
    return {
      app: {
        isPackaged: false,
        getAppPath: () => repoRoot,
      },
    };
  }
  return origModuleLoad.apply(this, arguments);
};

const embeddingModPath = path.resolve(repoRoot, 'dist-electron/electron/rag/providers/LocalEmbeddingProvider.js');
const { LocalEmbeddingProvider } = await import(pathToFileURL(embeddingModPath).href);
const rerankerModPath = path.resolve(repoRoot, 'dist-electron/electron/rag/LocalReranker.js');
const { getLocalReranker } = await import(pathToFileURL(rerankerModPath).href);

after(() => {
  Module._load = origModuleLoad;
});

describe('LocalEmbeddingProvider — behavioral worker delegation (mocked Worker)', () => {
  test('embed()/embedBatch() round-trip through postMessage to the dedicated worker script, never in-process', async () => {
    activeWorkerHandler = (worker, msg) => {
      if (msg.type === 'init') {
        worker.emit('message', { type: 'ready', requestId: msg.requestId });
      } else if (msg.type === 'embed') {
        const vectors = msg.texts.map(() => new Array(384).fill(0.01));
        worker.emit('message', { type: 'result', requestId: msg.requestId, vectors });
      }
    };

    const beforeCount = constructedWorkerPaths.length;
    const provider = new LocalEmbeddingProvider();

    const single = await provider.embed('hello world');
    assert.equal(single.length, 384);

    const batch = await provider.embedBatch(['a', 'b', 'c']);
    assert.equal(batch.length, 3);
    assert.equal(batch[0].length, 384);

    const newPaths = constructedWorkerPaths.slice(beforeCount);
    assert.ok(newPaths.length >= 1, 'must have constructed a Worker');
    assert.ok(
      newPaths.every((p) => p.endsWith('localEmbeddingWorker.js')),
      `every constructed worker must be the dedicated embedding worker script, got: ${JSON.stringify(newPaths)}`,
    );
  });

  test('worker "error" event rejects in-flight requests and resets loaded state (no silent hang)', async () => {
    activeWorkerHandler = (worker, msg) => {
      if (msg.type === 'init') {
        worker.emit('error', new Error('simulated ORT native crash'));
      }
    };

    // Fresh provider instance so its own `worker` slot is unset — forces a
    // brand-new MockWorker construction bound to THIS test's error handler.
    const provider = new LocalEmbeddingProvider();
    await assert.rejects(provider.embed('hello'), /simulated ORT native crash/);
  });
});

describe('LocalReranker — behavioral worker delegation (mocked Worker)', () => {
  test('rerank() round-trips through postMessage to the dedicated worker script, never in-process', async () => {
    const reranker = getLocalReranker();
    reranker.__resetForTests(); // drop any worker from a prior test/import

    activeWorkerHandler = (worker, msg) => {
      if (msg.type === 'init') {
        worker.emit('message', { type: 'ready', requestId: msg.requestId });
      } else if (msg.type === 'rerank') {
        // Deterministic fake scores: passage containing 'Paris' wins.
        const scores = msg.passages.map((p) => (p.includes('Paris') ? 10 : 0.1));
        worker.emit('message', { type: 'result', requestId: msg.requestId, scores });
      }
    };

    try {
      const beforeCount = constructedWorkerPaths.length;
      const available = await reranker.isAvailable();
      assert.equal(available, true);

      const passages = ['Bananas grow in the tropics.', 'Paris is the capital of France.'];
      const results = await reranker.rerank('capital of France', passages);
      assert.ok(Array.isArray(results));
      assert.equal(results[0].index, 1, 'Paris passage ranks first');

      const newPaths = constructedWorkerPaths.slice(beforeCount);
      assert.ok(newPaths.length >= 1, 'must have constructed a Worker');
      assert.ok(
        newPaths.every((p) => p.endsWith('localRerankerWorker.js')),
        `every constructed worker must be the dedicated reranker worker script, got: ${JSON.stringify(newPaths)}`,
      );
    } finally {
      reranker.__resetForTests();
    }
  });
});
