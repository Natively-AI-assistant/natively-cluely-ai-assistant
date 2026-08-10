// Deviation from the task brief: the brief's import reads '../rnntDecoder.js'.
// This repo's electron/tsconfig.json compiles electron/**/*.ts to
// dist-electron/ (not in place next to the source — see cacheState.test.mjs
// and melFrontend.test.mjs in this same directory for the established
// precedent). There is no rnntDecoder.js sitting next to rnntDecoder.ts, and
// Node does not fall back from a '.js' specifier to a sibling '.ts' file
// (ERR_MODULE_NOT_FOUND). Node 25's type-stripping support loads a '.ts' file
// directly, unflagged, so importing '../rnntDecoder.ts' here is the smallest
// change that makes `node --test
// electron/audio/whisper/nemotron/__tests__/rnntDecoder.test.mjs` actually
// run standalone (no prior `tsc` build step), while keeping this task
// independently testable as the brief intends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greedyDecodeFrame, BLANK_ID, MAX_SYMBOLS_PER_STEP } from '../rnntDecoder.ts';

test('emits blank immediately: no tokens, state unchanged', async () => {
  const runDecoderJoint = async () => ({ tokenId: BLANK_ID, nextState: { h: [0], c: [0] } });
  const result = await greedyDecodeFrame({}, runDecoderJoint, { h: [0], c: [0] }, BLANK_ID, MAX_SYMBOLS_PER_STEP);
  assert.deepEqual(result.tokenIds, []);
});

test('emits N non-blank tokens then blank: collects exactly those N', async () => {
  let calls = 0;
  const runDecoderJoint = async () => {
    calls++;
    if (calls <= 3) return { tokenId: 100 + calls, nextState: { h: [calls], c: [calls] } };
    return { tokenId: BLANK_ID, nextState: { h: [calls], c: [calls] } };
  };
  const result = await greedyDecodeFrame({}, runDecoderJoint, { h: [0], c: [0] }, BLANK_ID, MAX_SYMBOLS_PER_STEP);
  assert.deepEqual(result.tokenIds, [101, 102, 103]);
});

test('respects max_symbols_per_step even if the model never emits blank', async () => {
  let calls = 0;
  const runDecoderJoint = async () => {
    calls++;
    return { tokenId: 42, nextState: { h: [calls], c: [calls] } }; // never blank
  };
  const result = await greedyDecodeFrame({}, runDecoderJoint, { h: [0], c: [0] }, BLANK_ID, 10);
  assert.equal(result.tokenIds.length, 10); // capped, not infinite
});
