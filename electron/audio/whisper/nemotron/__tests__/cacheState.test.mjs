// Deviation from the task brief: the brief's import reads '../cacheState.js'.
// This repo's electron/tsconfig.json compiles electron/**/*.ts to
// dist-electron/ (not in place next to the source — see
// melFrontend.test.mjs in this same directory for the established
// precedent). There is no cacheState.js sitting next to cacheState.ts, and
// Node does not fall back from a '.js' specifier to a sibling '.ts' file
// (confirmed empirically by that prior task: ERR_MODULE_NOT_FOUND). Node
// 25's type-stripping support loads a '.ts' file directly, unflagged, so
// importing '../cacheState.ts' here is the smallest change that makes
// `node --test electron/audio/whisper/nemotron/__tests__/cacheState.test.mjs`
// actually run standalone (no prior `tsc` build step), while keeping this
// task independently testable as the brief intends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZeroCacheState, nextCacheState } from '../cacheState.ts';

// Fake session exposing only what createZeroCacheState reads — no real ONNX
// runtime needed for this test.
function fakeSession(shapes) {
  return {
    inputMetadata: [
      { name: 'audio_signal', isTensor: true, type: 'float32', shape: ['batch', 8960] },
      { name: 'length', isTensor: true, type: 'int64', shape: ['batch'] },
      { name: 'cache_last_channel', isTensor: true, type: 'float32', shape: shapes.cache_last_channel },
      { name: 'cache_last_time', isTensor: true, type: 'float32', shape: shapes.cache_last_time },
      { name: 'cache_last_channel_len', isTensor: true, type: 'int64', shape: shapes.cache_last_channel_len },
      { name: 'lang_id', isTensor: true, type: 'int64', shape: ['batch'] },
    ],
  };
}

test('createZeroCacheState builds zero-filled tensors matching declared shapes, substituting batch=1', () => {
  // Fixture dims are arbitrary test values, not a pin on the real export's
  // shape — Task 1's recorded encoder.onnx metadata has cache_last_time as
  // [1, 24, 1024, 8] (channels/time swapped relative to cache_last_channel's
  // [1, 24, 56, 1024]). This function only echoes whatever inputMetadata
  // reports, so the fixture intentionally uses different numbers per field
  // to prove that echoing (not a hardcoded shape) is what's under test.
  const session = fakeSession({
    cache_last_channel: ['batch', 24, 56, 1024],
    cache_last_time: ['batch', 24, 8, 1024],
    cache_last_channel_len: ['batch'],
  });
  const state = createZeroCacheState(session);
  assert.deepEqual(state.cache_last_channel.dims, [1, 24, 56, 1024]);
  assert.deepEqual(state.cache_last_time.dims, [1, 24, 8, 1024]);
  assert.deepEqual(state.cache_last_channel_len.dims, [1]);
  assert.ok(Array.from(state.cache_last_channel.data).every((v) => v === 0));
});

test('nextCacheState extracts the _next-suffixed outputs into the same shape', () => {
  const session = fakeSession({
    cache_last_channel: [1, 2, 2, 2],
    cache_last_time: [1, 2, 2, 2],
    cache_last_channel_len: [1],
  });
  // eslint-disable-next-line no-unused-vars
  const state = createZeroCacheState(session);
  const fakeOutputs = {
    outputs: {},
    encoded_lengths: {},
    cache_last_channel_next: { dims: [1, 2, 2, 2], type: 'float32', data: new Float32Array(8).fill(5) },
    cache_last_time_next: { dims: [1, 2, 2, 2], type: 'float32', data: new Float32Array(8).fill(6) },
    cache_last_channel_len_next: { dims: [1], type: 'int64', data: new BigInt64Array([3n]) },
  };
  const next = nextCacheState(fakeOutputs);
  assert.equal(next.cache_last_channel.data[0], 5);
  assert.equal(next.cache_last_time.data[0], 6);
  assert.equal(next.cache_last_channel_len.data[0], 3n);
});
