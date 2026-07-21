// Worker status contract tests (2026-07-07): classifyWorkerFailure must classify
// the known packaged-app failure shapes (module-missing / native-addon-missing /
// model-missing / memory-pressure / init-timeout). The classifiers are pure
// functions and can run under plain node --test.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const SRC = '../../../dist-electron/electron/utils/workerStatus.js';
const require = (await import('node:module')).createRequire(import.meta.url);

describe('classifyWorkerFailure (2026-07-07)', () => {
  test('classifies onnxruntime-common module error as module-missing (not recoverable)', () => {
    const { classifyWorkerFailure } = require(SRC);
    const out = classifyWorkerFailure(new Error("Cannot find package 'onnxruntime-common'"));
    assert.equal(out.reason, 'module-missing');
    assert.equal(out.recoverable, false);
  });

  test('classifies @huggingface/transformers dynamic import error as module-missing', () => {
    const { classifyWorkerFailure } = require(SRC);
    const out = classifyWorkerFailure(new Error('Failed to resolve @huggingface/transformers'));
    assert.equal(out.reason, 'module-missing');
    assert.equal(out.recoverable, false);
  });

  test('classifies onnxruntime-node binary load failure as native-addon-missing', () => {
    const { classifyWorkerFailure } = require(SRC);
    const out = classifyWorkerFailure(new Error('Could not load onnxruntime_binding.node'));
    assert.equal(out.reason, 'native-addon-missing');
    assert.equal(out.recoverable, false);
  });

  test('classifies missing model files as model-missing (not recoverable)', () => {
    const { classifyWorkerFailure } = require(SRC);
    const out = classifyWorkerFailure(new Error('No such file or directory: tokenizer.json'));
    assert.equal(out.reason, 'model-missing');
    assert.equal(out.recoverable, false);
  });

  test('classifies init timeout as init-timeout (recoverable)', () => {
    const { classifyWorkerFailure } = require(SRC);
    const out = classifyWorkerFailure(new Error('Worker request 1 timed out after 30000ms'));
    assert.equal(out.reason, 'init-timeout');
    assert.equal(out.recoverable, true);
  });

  test('classifies memory pressure as memory-pressure (recoverable)', () => {
    const { classifyWorkerFailure } = require(SRC);
    const out = classifyWorkerFailure(new Error('BFCArena::Extend failed: out of memory'));
    assert.equal(out.reason, 'memory-pressure');
    assert.equal(out.recoverable, true);
  });

  test('classifies unknown error as unknown (recoverable)', () => {
    const { classifyWorkerFailure } = require(SRC);
    const out = classifyWorkerFailure(new Error('something else went wrong'));
    assert.equal(out.reason, 'unknown');
    assert.equal(out.recoverable, true);
  });
});