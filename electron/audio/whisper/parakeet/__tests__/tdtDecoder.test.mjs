import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runTdtGreedyDecode, argmax } from '../tdtDecoder.ts';

describe('TDT Greedy Decoder', () => {
  test('argmax finds index of maximum value', () => {
    const arr = new Float32Array([0.1, 0.9, 0.4, -0.2]);
    assert.equal(argmax(arr), 1);
  });

  test('advances by step duration when token is emitted', () => {
    // 3 time frames, vocabSize = 4, blankId = 3, durationCount = 5
    // Frame 0: emits token 1, step = 2 (leaps to frame 2)
    // Frame 2: emits token 2, step = 1 (finishes)
    const vocabSize = 4;
    const blankId = 3;
    const framesCount = 3;

    const mockJointFn = (t, prevToken, state) => {
      if (t === 0) {
        // token 1 (score 10), blank has score 0
        const tokenLogits = [0, 10, 0, 0];
        // duration 2 has score 10
        const durationLogits = [0, 0, 10, 0, 0];
        return {
          logits: new Float32Array([...tokenLogits, ...durationLogits]),
          state1: new Float32Array([1]),
          state2: new Float32Array([1]),
        };
      } else if (t === 2) {
        // token 2, duration 1
        const tokenLogits = [0, 0, 10, 0];
        const durationLogits = [0, 10, 0, 0, 0];
        return {
          logits: new Float32Array([...tokenLogits, ...durationLogits]),
          state1: new Float32Array([2]),
          state2: new Float32Array([2]),
        };
      }
      throw new Error(`Unexpected frame evaluated: ${t}`);
    };

    const result = runTdtGreedyDecode({
      encodingsLen: framesCount,
      vocabSize,
      blankId,
      maxTokensPerStep: 5,
      decodeJointFn: mockJointFn,
    });

    assert.deepEqual(result.tokens, [1, 2]);
    assert.deepEqual(result.timestamps, [0, 2]);
  });

  test('advances by 1 when blank is emitted', () => {
    // 2 time frames
    // Frame 0: emits blank, step = 0 -> advances by 1
    // Frame 1: emits token 1, step = 1 -> advances by 1
    const vocabSize = 4;
    const blankId = 3;

    const mockJointFn = (t, prevToken, state) => {
      if (t === 0) {
        // blank token
        const tokenLogits = [0, 0, 0, 10];
        const durationLogits = [10, 0, 0, 0, 0];
        return {
          logits: new Float32Array([...tokenLogits, ...durationLogits]),
          state1: new Float32Array([0]),
          state2: new Float32Array([0]),
        };
      } else {
        // token 0, step 1
        const tokenLogits = [10, 0, 0, 0];
        const durationLogits = [0, 10, 0, 0, 0];
        return {
          logits: new Float32Array([...tokenLogits, ...durationLogits]),
          state1: new Float32Array([1]),
          state2: new Float32Array([1]),
        };
      }
    };

    const result = runTdtGreedyDecode({
      encodingsLen: 2,
      vocabSize,
      blankId,
      maxTokensPerStep: 5,
      decodeJointFn: mockJointFn,
    });

    assert.deepEqual(result.tokens, [0]);
    assert.deepEqual(result.timestamps, [1]);
  });

  test('preserves lastTokenId across chunks when initialState is provided', () => {
    let capturedPrevToken = null;
    const mockJointFn = (t, prevToken, state) => {
      capturedPrevToken = prevToken;
      return {
        logits: new Float32Array([0, 0, 0, 10, 10, 0, 0, 0, 0]),
        state1: new Float32Array([0]),
        state2: new Float32Array([0]),
      };
    };

    runTdtGreedyDecode({
      encodingsLen: 1,
      vocabSize: 4,
      blankId: 3,
      decodeJointFn: mockJointFn,
      initialState: {
        state1: new Float32Array(0),
        state2: new Float32Array(0),
        lastTokenId: 42,
      },
    });

    assert.equal(capturedPrevToken, 42, 'Must use lastTokenId from initialState on first decode step');
  });
});
