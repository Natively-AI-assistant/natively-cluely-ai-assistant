// electron/utils/__tests__/OnnxAvailableMemoryGate.test.mjs
//
// Regression coverage for the "available memory" ONNX admission gate.
//
// THE BUG THIS PINS: hasEnoughMemoryForOnnxSession() used to test
// `os.freemem()` against a 2GB floor. On macOS os.freemem() returns ONLY the
// truly-free page list (kept near-zero by the kernel — idle RAM is file cache),
// so the gate refused EVERY local ONNX session (embedder, reranker, intent
// classifier, Whisper) on healthy machines with tens of GB reclaimable. That
// silently killed on-device embeddings/RAG for keyless users.
//
// The fix reads AVAILABLE memory (free + reclaimable) via vm_stat (macOS) /
// /proc/meminfo MemAvailable (Linux), with an env override for determinism.
//
// Run: ELECTRON_RUN_AS_NODE=1 electron --test (native ABI irrelevant here).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_URL = pathToFileURL(
  path.resolve(__dirname, '../../../dist-electron/electron/utils/onnxThreadConfig.js')
).href;

const {
  getAvailableMemoryGB,
  hasEnoughMemoryForOnnxSession,
  getMinFreeGBForOnnxSession,
} = await import(MODULE_URL);

// The gate caches for ~1s. Tests that flip the override wait out the TTL.
const CACHE_TTL_MS = 1100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('ONNX available-memory gate', () => {
  test('getAvailableMemoryGB reports MORE than os.freemem() on macOS/Linux (reclaimable cache counted)', () => {
    delete process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB;
    const avail = getAvailableMemoryGB();
    assert.ok(Number.isFinite(avail) && avail >= 0, 'available memory is a non-negative number');
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const freemem = os.freemem() / 1024 ** 3;
      // On a healthy dev machine available should be >= free (usually much more).
      // This is the crux of the bug: the old gate used the smaller number.
      assert.ok(
        avail >= freemem - 0.01,
        `available (${avail.toFixed(2)}GB) must be >= os.freemem (${freemem.toFixed(2)}GB)`
      );
    }
  });

  test('env override forces a deterministic value', async () => {
    process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB = '7.5';
    await sleep(CACHE_TTL_MS);
    assert.equal(getAvailableMemoryGB(), 7.5);
    delete process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB;
  });

  test('gate ADMITS when available memory is above the floor (the fix)', async () => {
    process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB = String(getMinFreeGBForOnnxSession() + 4);
    await sleep(CACHE_TTL_MS);
    assert.equal(hasEnoughMemoryForOnnxSession(), true);
    delete process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB;
  });

  test('gate REFUSES when available memory is below the floor', async () => {
    process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB = '0.25';
    await sleep(CACHE_TTL_MS);
    assert.equal(hasEnoughMemoryForOnnxSession(), false);
    delete process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB;
  });

  test('a floor of 0 always admits (test/CI escape hatch still works)', async () => {
    // NATIVELY_ONNX_MIN_FREE_GB=0 is what the existing suites set — verify the
    // available-memory path honors it identically to the old freemem path.
    const prev = process.env.NATIVELY_ONNX_MIN_FREE_GB;
    process.env.NATIVELY_ONNX_MIN_FREE_GB = '0';
    process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB = '0.1';
    await sleep(CACHE_TTL_MS);
    assert.equal(hasEnoughMemoryForOnnxSession(), true, '0GB floor admits even at 0.1GB available');
    if (prev === undefined) delete process.env.NATIVELY_ONNX_MIN_FREE_GB;
    else process.env.NATIVELY_ONNX_MIN_FREE_GB = prev;
    delete process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB;
  });
});
