// electron/llm/__tests__/WorkerFailureStack2026_10_26.test.mjs
//
// BUG: classifyWorkerFailure matched its keywords against the error's whole
// stack. Every frame of an error thrown inside the library names
// node_modules/@huggingface/transformers/dist/transformers.node.cjs, so an
// out-of-memory or a timeout came back "module-missing" (not recoverable) and
// the local embedding model was switched off for the rest of the session. An
// install path or username containing "timeout" or "missing" decided the reason
// the same way. The reason now comes from the error's message and code; the
// stack is still kept in `message` for diagnostics.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { classifyWorkerFailure } = require('../../../dist-electron/electron/utils/workerStatus.js');

const withStack = (message, frames, extra = {}) => {
  const e = Object.assign(new Error(message), extra);
  e.stack = `Error: ${message}\n${frames.map(f => `    at ${f}`).join('\n')}`;
  return e;
};
const MAC_LIB = '/Applications/Natively.app/Contents/Resources/app.asar.unpacked/node_modules/@huggingface/transformers/dist/transformers.node.cjs';
const WIN_LIB = 'C:\\Users\\Missing Link\\AppData\\Local\\Programs\\Natively\\resources\\app.asar.unpacked\\node_modules\\onnxruntime-node\\dist\\backend.js';

describe('classifyWorkerFailure: the stack never decides the reason', () => {
  test('out of memory thrown inside transformers.js (macOS path) is memory-pressure, recoverable', () => {
    const out = classifyWorkerFailure(withStack('BFCArena::Extend failed to allocate 268435456 bytes',
      [`InferenceSession.run (${MAC_LIB}:12345:17)`, `async Pipeline._call (${MAC_LIB}:23456:9)`]));
    assert.equal(out.reason, 'memory-pressure');
    assert.equal(out.recoverable, true);
    assert.match(out.message, /transformers\.node\.cjs/, 'the stack is kept for diagnostics');
  });

  test('a timeout thrown inside onnxruntime-node (Windows path with "Missing" in the username) is init-timeout', () => {
    const out = classifyWorkerFailure(withStack('Worker request 1 timed out after 30000ms', [`OnnxruntimeSessionHandler.run (${WIN_LIB}:40:12)`]));
    assert.equal(out.reason, 'init-timeout');
    assert.equal(out.recoverable, true);
  });

  test('an unknown error installed under a folder named "timeout" stays unknown', () => {
    const out = classifyWorkerFailure(withStack('something else went wrong', ['load (/Users/me/natively-fix-timeouts/dist-electron/worker.js:1:1)']));
    assert.equal(out.reason, 'unknown');
  });

  test('"node" in a path segment of the message is not a native addon', () => {
    const out = classifyWorkerFailure(new Error('Model read failed in /Users/me/my.node.projects/models — timed out'));
    assert.equal(out.reason, 'init-timeout');
  });

  test('the real failures are still recognised from their message or code', () => {
    const cases = [
      [new Error("Cannot find package 'onnxruntime-common' imported from /app/x.js"), 'module-missing'],
      [new Error('\\\\?\\C:\\Natively\\resources\\onnxruntime_binding.node is not a valid Win32 application.'), 'native-addon-missing'],
      [new Error('dlopen(/Applications/Natively.app/x/onnxruntime_binding.node, 0x0001): tried: ... (no such file)'), 'native-addon-missing'],
      [Object.assign(new Error('The specified module could not be found.'), { code: 'ERR_DLOPEN_FAILED' }), 'native-addon-missing'],
      [Object.assign(new Error("ENOENT: no such file or directory, open 'tokenizer.json'"), { code: 'ENOENT' }), 'model-missing'],
      [new Error("Load model from /Users/me/models/router/model_quantized.onnx failed:Load model /Users/me/models/router/model_quantized.onnx failed. File doesn't exist"), 'model-missing'],
      [new Error('Load model from C:\\Natively\\models\\model.onnx failed:Protobuf parsing failed.'), 'model-missing'],
      ['Worker exited: timed out', 'init-timeout'],
    ];
    for (const [error, reason] of cases) assert.equal(classifyWorkerFailure(error).reason, reason, String(error.message ?? error));
  });
});
