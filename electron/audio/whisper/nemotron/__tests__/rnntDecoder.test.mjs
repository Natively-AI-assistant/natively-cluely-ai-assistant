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
  const runDecoderJoint = async () => ({ tokenId: BLANK_ID, nextState: { h: [0], c: [0], lastTokenId: BLANK_ID } });
  const result = await greedyDecodeFrame({}, runDecoderJoint, { h: [0], c: [0], lastTokenId: BLANK_ID }, BLANK_ID, MAX_SYMBOLS_PER_STEP);
  assert.deepEqual(result.tokenIds, []);
});

test('emits N non-blank tokens then blank: collects exactly those N', async () => {
  let calls = 0;
  const runDecoderJoint = async () => {
    calls++;
    if (calls <= 3) return { tokenId: 100 + calls, nextState: { h: [calls], c: [calls], lastTokenId: 100 + calls } };
    return { tokenId: BLANK_ID, nextState: { h: [calls], c: [calls], lastTokenId: BLANK_ID } };
  };
  const result = await greedyDecodeFrame({}, runDecoderJoint, { h: [0], c: [0], lastTokenId: BLANK_ID }, BLANK_ID, MAX_SYMBOLS_PER_STEP);
  assert.deepEqual(result.tokenIds, [101, 102, 103]);
});

test('respects max_symbols_per_step even if the model never emits blank', async () => {
  let calls = 0;
  const runDecoderJoint = async () => {
    calls++;
    return { tokenId: 42, nextState: { h: [calls], c: [calls], lastTokenId: 42 } }; // never blank
  };
  const result = await greedyDecodeFrame({}, runDecoderJoint, { h: [0], c: [0], lastTokenId: BLANK_ID }, BLANK_ID, 10);
  assert.equal(result.tokenIds.length, 10); // capped, not infinite
});

test('carries last emitted token across frame boundaries (regression for Task 5 fix)', async () => {
  // Frame 1: emits token 500, then blank.
  const frame1Joint = async (_encoderFrame, _prevTokenId, state) => {
    if (state.lastTokenId === 500) {
      // second call within frame 1 (after the first emission) — return blank to end the frame
      return { tokenId: BLANK_ID, nextState: { h: [1], c: [1], lastTokenId: 500 } };
    }
    return { tokenId: 500, nextState: { h: [1], c: [1], lastTokenId: 500 } };
  };
  const frame1Result = await greedyDecodeFrame(
    {},
    frame1Joint,
    { h: [0], c: [0], lastTokenId: BLANK_ID },
    BLANK_ID,
    MAX_SYMBOLS_PER_STEP,
  );
  assert.equal(frame1Result.nextState.lastTokenId, 500);
  assert.notEqual(frame1Result.nextState.lastTokenId, BLANK_ID);

  // Frame 2: no new emissions (blank immediately), but must still condition
  // the predictor on frame 1's last real token (500), not BLANK_ID.
  let firstCallPrevTokenId;
  let calls = 0;
  const frame2Joint = async (_encoderFrame, prevTokenId, state) => {
    calls++;
    if (calls === 1) firstCallPrevTokenId = prevTokenId;
    return { tokenId: BLANK_ID, nextState: { ...state } };
  };
  const frame2Result = await greedyDecodeFrame(
    {},
    frame2Joint,
    frame1Result.nextState,
    BLANK_ID,
    MAX_SYMBOLS_PER_STEP,
  );
  assert.equal(firstCallPrevTokenId, 500);
  assert.deepEqual(frame2Result.tokenIds, []);
  assert.equal(frame2Result.nextState.lastTokenId, 500); // unchanged: no new emission this frame
});
