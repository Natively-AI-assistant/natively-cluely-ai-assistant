// Greedy RNNT decode for one encoder chunk's output frame. blank_id and
// max_symbols_per_step are Nemotron's own decode-time hyperparameters — see
// genai_config.json (recorded in the design doc); do not tune these, they are
// not free parameters.
//
// RNNT decodes per encoder time-step, not per chunk. This function is the
// *inner* loop over symbols for ONE frame only — Task 7's engine owns the
// *outer* loop over frames and threads DecoderState across both frames and
// chunks (the decoder/joint LSTM state persists for the whole utterance,
// resetting only at segment boundaries). This module is pure logic with an
// injected runDecoderJoint callback; it never touches onnxruntime-node or any
// real ONNX session directly.

export const BLANK_ID = 13087;
export const MAX_SYMBOLS_PER_STEP = 10;

export interface DecoderState {
  h: number[] | Float32Array;
  c: number[] | Float32Array;
  // The RNNT predictor's last emitted non-blank token, carried across the
  // WHOLE utterance — across both the inner (per-frame symbol) loop and the
  // outer (per-encoder-frame, per-chunk) loop Task 7's engine adds. This is
  // NOT reset per frame; it only resets to `blankId` at utterance/segment
  // boundaries (blank is RNNT's implicit start-of-sequence token).
  lastTokenId: number;
}

export type EncoderFrame = unknown; // one time-step slice of the encoder's `outputs` tensor

export type DecoderJointFn = (
  encoderFrame: EncoderFrame,
  prevTokenId: number,
  state: DecoderState,
) => Promise<{ tokenId: number; nextState: DecoderState }>;

export async function greedyDecodeFrame(
  encoderFrame: EncoderFrame,
  runDecoderJoint: DecoderJointFn,
  prevState: DecoderState,
  blankId: number,
  maxSymbolsPerStep: number,
): Promise<{ tokenIds: number[]; nextState: DecoderState }> {
  const tokenIds: number[] = [];
  let state = prevState;
  let lastToken = prevState.lastTokenId; // carried across frame/chunk boundaries
  for (let i = 0; i < maxSymbolsPerStep; i++) {
    const { tokenId, nextState } = await runDecoderJoint(encoderFrame, lastToken, state);
    if (tokenId === blankId) break;
    tokenIds.push(tokenId);
    lastToken = tokenId;
    state = nextState;
  }
  return { tokenIds, nextState: { ...state, lastTokenId: lastToken } };
}
