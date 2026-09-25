// electron/audio/whisper/parakeet/tdtDecoder.ts
import type { ParakeetDecoderState } from './types';

export function argmax(arr: ArrayLike<number>, start: number = 0, end?: number): number {
  const len = end !== undefined ? Math.min(arr.length, end) : arr.length;
  if (len <= start) return -1;
  let maxIdx = start;
  let maxVal = arr[start];
  for (let i = start + 1; i < len; i++) {
    if (arr[i] > maxVal) {
      maxVal = arr[i];
      maxIdx = i;
    }
  }
  return maxIdx;
}

export type TdtJointOutput = {
  logits: Float32Array;
  state1: Float32Array;
  state2: Float32Array;
};

export type DecodeJointFn = (
  frameIndex: number,
  prevToken: number,
  state: ParakeetDecoderState,
) => TdtJointOutput | Promise<TdtJointOutput>;

export interface TdtGreedyDecodeOptions {
  encodingsLen: number;
  vocabSize: number;
  blankId: number;
  maxTokensPerStep?: number;
  decodeJointFn: DecodeJointFn;
  initialState?: ParakeetDecoderState;
}

export interface TdtDecodeResult {
  tokens: number[];
  timestamps: number[];
  finalState: ParakeetDecoderState;
}

export async function runTdtGreedyDecodeAsync(
  options: TdtGreedyDecodeOptions,
): Promise<TdtDecodeResult> {
  const {
    encodingsLen,
    vocabSize,
    blankId,
    maxTokensPerStep = 10,
    decodeJointFn,
    initialState,
  } = options;

  let currentState: ParakeetDecoderState = initialState ?? {
    state1: new Float32Array(0),
    state2: new Float32Array(0),
    lastTokenId: blankId,
  };

  const tokens: number[] = [];
  const timestamps: number[] = [];

  let t = 0;
  let emittedTokens = 0;

  while (t < encodingsLen) {
    const prevToken = tokens.length > 0 ? tokens[tokens.length - 1] : (currentState.lastTokenId ?? blankId);
    const jointOut = await decodeJointFn(t, prevToken, currentState);
    const logits = jointOut.logits;

    // Token is argmax over [0, vocabSize)
    const token = argmax(logits, 0, vocabSize);

    // Duration step is argmax over [vocabSize, logits.length) offset by vocabSize
    const durationOffset = argmax(logits, vocabSize);
    const step = durationOffset >= 0 ? durationOffset - vocabSize : 0;

    if (token !== -1 && token !== blankId) {
      currentState = {
        state1: jointOut.state1,
        state2: jointOut.state2,
        lastTokenId: token,
      };
      tokens.push(token);
      timestamps.push(t);
      emittedTokens++;
    }

    if (step > 0) {
      t += step;
      emittedTokens = 0;
    } else if (token === blankId || emittedTokens >= maxTokensPerStep) {
      t += 1;
      emittedTokens = 0;
    }
  }

  return {
    tokens,
    timestamps,
    finalState: currentState,
  };
}

export function runTdtGreedyDecode(options: TdtGreedyDecodeOptions): TdtDecodeResult {
  const {
    encodingsLen,
    vocabSize,
    blankId,
    maxTokensPerStep = 10,
    decodeJointFn,
    initialState,
  } = options;

  let currentState: ParakeetDecoderState = initialState ?? {
    state1: new Float32Array(0),
    state2: new Float32Array(0),
    lastTokenId: blankId,
  };

  const tokens: number[] = [];
  const timestamps: number[] = [];

  let t = 0;
  let emittedTokens = 0;

  while (t < encodingsLen) {
    const prevToken = tokens.length > 0 ? tokens[tokens.length - 1] : (currentState.lastTokenId ?? blankId);
    const jointOut = decodeJointFn(t, prevToken, currentState) as TdtJointOutput;
    const logits = jointOut.logits;

    const token = argmax(logits, 0, vocabSize);
    const durationOffset = argmax(logits, vocabSize);
    const step = durationOffset >= 0 ? durationOffset - vocabSize : 0;

    if (token !== -1 && token !== blankId) {
      currentState = {
        state1: jointOut.state1,
        state2: jointOut.state2,
        lastTokenId: token,
      };
      tokens.push(token);
      timestamps.push(t);
      emittedTokens++;
    }

    if (step > 0) {
      t += step;
      emittedTokens = 0;
    } else if (token === blankId || emittedTokens >= maxTokensPerStep) {
      t += 1;
      emittedTokens = 0;
    }
  }

  return {
    tokens,
    timestamps,
    finalState: currentState,
  };
}
