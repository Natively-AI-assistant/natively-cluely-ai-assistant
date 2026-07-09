// Regression test for the ONNX CPU arena / memory-pattern hardening
// (2026-07-08). The shared getBoundedOnnxSessionOptions() helper is the
// single source of truth for every local ONNX consumer (Whisper,
// embeddings, reranker, intent classifier). The previous return shape did
// NOT include enableCpuMemArena / enableMemPattern, which meant ORT was free
// to use its BFCArena + memory-pattern reuse — the exact structures called
// out in the 2026-07-05 BFCArena::Extend → posix_memalign crash forensics.
//
// Guards:
//   1. Defaults disable CPU mem arena and memory pattern.
//   2. NATIVELY_ONNX_ENABLE_CPU_MEM_ARENA / NATIVELY_ONNX_ENABLE_MEM_PATTERN
//      flip them on for emergency opt-out / perf experiments.
//   3. Every local ONNX consumer still routes through the helper (no
//      accidental bypass that would silently revert the change).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const onnxPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/utils/onnxThreadConfig.js',
);
const { getBoundedOnnxSessionOptions } = await import(pathToFileURL(onnxPath).href);

function withEnv(overrides, fn) {
  const previous = {};
  for (const [k, v] of Object.entries(overrides)) {
    previous[k] = Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined;
    if (v === undefined || v === null) delete process.env[k];
    else process.env[k] = String(v);
  }
  try {
    return fn();
  } finally {
    for (const [k, prev] of Object.entries(previous)) {
      if (prev === undefined) delete process.env[k];
      else process.env[k] = prev;
    }
  }
}

test('defaults disable CPU memory arena and memory pattern', () => {
  withEnv({
    NATIVELY_ONNX_ENABLE_CPU_MEM_ARENA: undefined,
    NATIVELY_ONNX_ENABLE_MEM_PATTERN: undefined,
  }, () => {
    const opts = getBoundedOnnxSessionOptions();
    assert.equal(opts.enableCpuMemArena, false, 'expected CPU memory arena to be disabled by default');
    assert.equal(opts.enableMemPattern, false, 'expected memory pattern to be disabled by default');
    // Thread bounds are unchanged from the conservative defaults already
    // covered by OnnxWorkerIsolationHardening2026_07_05.test.mjs.
    assert.equal(opts.intraOpNumThreads, 1);
    assert.equal(opts.interOpNumThreads, 1);
    assert.equal(opts.executionMode, 'sequential');
  });
});

test('env overrides flip the arena/mem-pattern flags', () => {
  withEnv({
    NATIVELY_ONNX_ENABLE_CPU_MEM_ARENA: '1',
    NATIVELY_ONNX_ENABLE_MEM_PATTERN: '1',
  }, () => {
    const opts = getBoundedOnnxSessionOptions();
    assert.equal(opts.enableCpuMemArena, true);
    assert.equal(opts.enableMemPattern, true);
  });

  withEnv({
    NATIVELY_ONNX_ENABLE_CPU_MEM_ARENA: 'false',
    NATIVELY_ONNX_ENABLE_MEM_PATTERN: '0',
  }, () => {
    const opts = getBoundedOnnxSessionOptions();
    assert.equal(opts.enableCpuMemArena, false);
    assert.equal(opts.enableMemPattern, false);
  });

  withEnv({
    NATIVELY_ONNX_ENABLE_CPU_MEM_ARENA: 'bogus',
    NATIVELY_ONNX_ENABLE_MEM_PATTERN: 'bogus',
  }, () => {
    // Unknown values must fall back to the safe default (false) — never
    // silently flip ON. A misparse here would re-open the BFCArena path
    // operators thought they had closed.
    const opts = getBoundedOnnxSessionOptions();
    assert.equal(opts.enableCpuMemArena, false);
    assert.equal(opts.enableMemPattern, false);
  });
});

test('every local ONNX consumer routes through the shared helper', () => {
  const workers = [
    { label: 'whisperWorker', file: 'electron/audio/whisper/whisperWorker.ts' },
    { label: 'localEmbeddingWorker', file: 'electron/rag/providers/localEmbeddingWorker.ts' },
    { label: 'localRerankerWorker', file: 'electron/rag/localRerankerWorker.ts' },
    { label: 'intentClassifierWorker', file: 'electron/llm/intentClassifierWorker.ts' },
  ];
  for (const w of workers) {
    const src = fs.readFileSync(path.resolve(__dirname, '../../..', w.file), 'utf8');
    assert.ok(
      src.includes('getBoundedOnnxSessionOptions('),
      `${w.label} (${w.file}) must call getBoundedOnnxSessionOptions() so the arena/mem-pattern defaults apply`,
    );
  }
});