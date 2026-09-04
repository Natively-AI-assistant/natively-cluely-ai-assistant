/**
 * The GGUF reranker seam port (llama.cpp via node-llama-cpp).
 *
 * The interesting behaviour is what happens when the model CANNOT be ranked,
 * because that is the common case for GGUF "rerankers": llama.cpp only scores a
 * model with a ranking head, and two of the three most-requested ones are
 * qwen3-architecture generative models it refuses outright.
 *
 * Measured on this machine, for the record:
 *   bge-reranker-v2-m3 Q4_K_M   arch bert    -> 1708ms cold, 71ms warm
 *   jina-reranker-v3.5 Q4_K_M   arch qwen3   -> refused, no ranking head
 *   qwen3-reranker-0.6b Q4_K_M  arch qwen3   -> refused, no ranking head
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const { GgufReranker } = require(path.join(repoRoot, 'dist-electron/electron/rag/GgufReranker.js'));

describe('failing closed', () => {
  test('a missing model file yields null, never a throw', async () => {
    const port = new GgufReranker(path.join(os.tmpdir(), 'definitely-not-here.gguf'));
    assert.equal(await port.rerank('q', ['a', 'b']), null,
      'the caller must keep its existing ordering');
    assert.match(port.failureReason ?? '', /not found/i);
    await port.dispose();
  });

  test('a doomed load is latched, not retried per query', async () => {
    // Retrying a 400MB load on every question would be far worse than the
    // failure itself.
    const port = new GgufReranker(path.join(os.tmpdir(), 'still-not-here.gguf'));
    assert.equal(await port.rerank('q', ['a']), null);
    const first = port.failureReason;
    const t = Date.now();
    assert.equal(await port.rerank('q', ['a']), null);
    assert.ok(Date.now() - t < 500, 'the second call must short-circuit');
    assert.equal(port.failureReason, first);
    await port.dispose();
  });

  test('isAvailable reports false rather than throwing', async () => {
    const port = new GgufReranker(path.join(os.tmpdir(), 'nope.gguf'));
    assert.equal(await port.isAvailable(), false);
    await port.dispose();
  });

  test('empty input is refused before any model work', async () => {
    const port = new GgufReranker(path.join(os.tmpdir(), 'nope.gguf'));
    assert.equal(await port.rerank('', ['a']), null);
    assert.equal(await port.rerank('q', []), null);
    await port.dispose();
  });

  test('batch size follows the scoring mode, because their costs differ', () => {
    // 'rank' hands the pool to llama.cpp, which batches internally — the seam's
    // default of 6 would be four extra worker round trips for nothing.
    assert.ok(new GgufReranker('x', 'rank').batchSize >= 30);

    // 'yes-no' runs a FULL language-model forward pass per passage,
    // sequentially (~87ms each measured on Qwen3 0.6B, with short passages).
    // Handing it the whole 30-candidate pool in one call bets the 20s timeout
    // on every one of them being fast; chunking degrades into more calls
    // instead of one that blows the deadline and reranks nothing.
    const yesNo = new GgufReranker('x', 'yes-no').batchSize;
    assert.ok(yesNo > 0 && yesNo <= 15, `yes-no batch should be modest, got ${yesNo}`);
    assert.ok(yesNo < new GgufReranker('x', 'rank').batchSize);
  });
});

describe('source guards', () => {
  const worker = fs.readFileSync(path.join(repoRoot, 'electron/rag/ggufRerankerWorker.ts'), 'utf8');
  const port = fs.readFileSync(path.join(repoRoot, 'electron/rag/GgufReranker.ts'), 'utf8');

  test('inference runs in a worker, never on the main thread', () => {
    // Same rule the ONNX reranker follows after the 2026-07-05 SIGTRAP crashes:
    // llama.cpp is a native addon that can abort the thread it runs on.
    assert.match(worker, /worker_threads/);
    assert.match(worker, /parentPort/);
    assert.match(port, /new Worker\(/);
  });

  test('the worker never compiles llama.cpp on a user machine', () => {
    // A packaged app must use the prebuilt binary or fail honestly; a silent
    // source build on someone's laptop is not an acceptable fallback.
    assert.match(worker, /build:\s*'never'/);
  });

  test('scores come back in INPUT order', () => {
    // rankAndSort returns documents, and matching those back by text pairs a
    // score with the wrong candidate wherever two passages are identical.
    assert.match(worker, /rankAll\(/);
    assert.doesNotMatch(worker, /rankAndSort\(/);
  });

  test('the asar path is rewritten for the native addon', () => {
    // Asserted on BEHAVIOUR now, not on the text of GgufReranker.ts. The
    // rewrite moved into resolveRagWorker when worker resolution was fixed to
    // ascend from __dirname (it was only finding the worker from two of the
    // ~30 bundle depths esbuild inlines this class into), and a source scan
    // reported that refactor as a missing safety rule.
    const { resolveRagWorker } = require(path.join(repoRoot, 'dist-electron/electron/rag/resolveRagWorker.js'));
    const inside = '/Applications/Natively.app/Contents/Resources/app.asar/dist-electron/electron/services/reranking';
    const resolved = resolveRagWorker(inside, 'ggufRerankerWorker.js', () => true);
    assert.match(resolved, /app\.asar\.unpacked/);
    assert.doesNotMatch(resolved, /app\.asar(?!\.unpacked)/,
      'a worker resolved inside the archive cannot load its native addon');
  });

  test('a partial or non-finite ranking is rejected wholesale', () => {
    assert.match(port, /scores\.length !== passages\.length/);
    assert.match(port, /Number\.isFinite/);
  });
});

// ── against the real model, only when it is already installed ─────────────

const INSTALLED = (() => {
  try {
    const { ggufModelFile } = require(path.join(repoRoot, 'dist-electron/electron/services/reranking/localModelInstaller.js'));
    const f = ggufModelFile('bge-reranker-v2-m3-q4km');
    return f && fs.existsSync(f) ? f : null;
  } catch { return null; }
})();

test('the real model ranks correctly', { skip: INSTALLED ? false : 'bge-reranker-v2-m3 not installed' }, async () => {
  const port = new GgufReranker(INSTALLED);
  const passages = [
    'Photosynthesis converts light energy into chemical energy in plants.',
    'Designed and operated Kubernetes clusters running 200+ microservices.',
    'The Rhine is a river in Central and Western Europe.',
    'Skills: Python, Go, Kubernetes, Kafka, Terraform, PostgreSQL.',
  ];
  const order = await port.rerank('What is my experience with Kubernetes?', passages);
  assert.ok(order, 'the real model must produce a ranking');
  assert.equal(new Set(order.map(o => o.index)).size, passages.length);
  assert.ok([1, 3].includes(order[0].index), 'a Kubernetes passage must rank first');
  await port.dispose();
});
