// electron/audio/whisper/nemotron/nemotronEngine.ts
import { InferenceSession, Tensor } from 'onnxruntime-node';
import path from 'path';
import { getBoundedOnnxSessionOptions } from '../../../utils/onnxThreadConfig';
import { computeMelFrame, CHUNK_SAMPLES, N_MELS, N_FRAMES } from './melFrontend';
import { createZeroCacheState, nextCacheState, type NemotronCacheState } from './cacheState';
import { greedyDecodeFrame, BLANK_ID, MAX_SYMBOLS_PER_STEP, type DecoderState } from './rnntDecoder';
import { loadNemotronTokenizer, type NemotronTokenizer } from './tokenizer';

// English default (<en-US> in the export's vocabulary) until Task 12 wires
// real per-session selection — see design doc / Task 7 interfaces note for how
// this was resolved from tokenizer.json's model.vocab, not guessed.
const DEFAULT_LANG_ID = 2947;

// Decoder LSTM: 2 layers, hidden_size 640, batch 1 — verified via Task 1's
// recorded decoder.onnx inputMetadata (h_in/c_in shape [2, "batch", 640]),
// not the num_hidden_layers/hidden_size fields in genai_config.json alone
// (those don't say the axis ORDER, which is what a Tensor construction needs).
const DECODER_LAYERS = 2;
const DECODER_HIDDEN = 640;
const zeroDecoderState = (): DecoderState => ({
  h: new Array(DECODER_LAYERS * DECODER_HIDDEN).fill(0),
  c: new Array(DECODER_LAYERS * DECODER_HIDDEN).fill(0),
  lastTokenId: BLANK_ID, // RNNT's implicit start-of-sequence token
});

export interface ChunkTranscript {
  text: string;
  isFinal: false; // per-chunk output is always a partial; segment-close emits the final separately
}

async function createSessionWithFallback(
  filePath: string,
  executionProviders: string[],
): Promise<InferenceSession> {
  const sessionOptions = { ...getBoundedOnnxSessionOptions(), executionProviders };
  try {
    return await InferenceSession.create(filePath, sessionOptions as any);
  } catch (e) {
    console.warn(
      `[NemotronEngine] Session creation failed with providers [${executionProviders.join(',')}] for ${path.basename(filePath)}, falling back to CPU:`,
      (e as Error)?.message,
    );
    return InferenceSession.create(filePath, { ...getBoundedOnnxSessionOptions(), executionProviders: ['cpu'] } as any);
  }
}

export class NemotronEngine {
  private encoderSession: InferenceSession;
  private decoderSession: InferenceSession;
  private jointSession: InferenceSession;
  private tokenizer: NemotronTokenizer;
  private cacheState: NemotronCacheState;
  private decoderState: DecoderState = zeroDecoderState();
  // Preallocated ring-style buffer, not array-spread: pushAudio() is called
  // every ~20-40ms with a few hundred samples each; spreading onto a plain
  // array (this.pendingSamples.push(...pcm)) would blow the call-stack argument
  // limit on larger chunks and thrash GC on every push. One CHUNK_SAMPLES-sized
  // scratch buffer plus a fill-length counter avoids both.
  private pendingBuffer = new Float32Array(CHUNK_SAMPLES);
  private pendingLength = 0;
  private langId = DEFAULT_LANG_ID;

  private constructor(
    encoderSession: InferenceSession,
    decoderSession: InferenceSession,
    jointSession: InferenceSession,
    tokenizer: NemotronTokenizer,
  ) {
    this.encoderSession = encoderSession;
    this.decoderSession = decoderSession;
    this.jointSession = jointSession;
    this.tokenizer = tokenizer;
    this.cacheState = createZeroCacheState(encoderSession);
  }

  static async create(modelDir: string, executionProviders: string[]): Promise<NemotronEngine> {
    const [encoderSession, decoderSession, jointSession] = await Promise.all([
      createSessionWithFallback(path.join(modelDir, 'encoder.onnx'), executionProviders),
      createSessionWithFallback(path.join(modelDir, 'decoder.onnx'), executionProviders),
      createSessionWithFallback(path.join(modelDir, 'joint.onnx'), executionProviders),
    ]);
    const tokenizer = await loadNemotronTokenizer(modelDir);
    return new NemotronEngine(encoderSession, decoderSession, jointSession, tokenizer);
  }

  setLanguage(langId: number): void {
    this.langId = langId;
  }

  reset(): void {
    this.cacheState = createZeroCacheState(this.encoderSession);
    this.decoderState = zeroDecoderState();
    this.pendingLength = 0;
  }

  async pushAudio(pcm: Float32Array): Promise<ChunkTranscript[]> {
    const results: ChunkTranscript[] = [];
    let offset = 0;
    while (offset < pcm.length) {
      const room = CHUNK_SAMPLES - this.pendingLength;
      const take = Math.min(room, pcm.length - offset);
      this.pendingBuffer.set(pcm.subarray(offset, offset + take), this.pendingLength);
      this.pendingLength += take;
      offset += take;
      if (this.pendingLength === CHUNK_SAMPLES) {
        results.push(await this.runChunk(this.pendingBuffer));
        this.pendingLength = 0;
      }
    }
    return results;
  }

  /** Flushes any remaining < CHUNK_SAMPLES audio, zero-padded, at segment close. */
  async flush(): Promise<ChunkTranscript | null> {
    if (this.pendingLength === 0) return null;
    const chunk = new Float32Array(CHUNK_SAMPLES); // zero-padded
    chunk.set(this.pendingBuffer.subarray(0, this.pendingLength));
    this.pendingLength = 0;
    return this.runChunk(chunk);
  }

  /**
   * Cache-mismatch recovery: an encoder shape error is treated as a stale-cache
   * artifact, not a fatal error — reset cache state and retry the SAME chunk
   * once. A second failure is a real problem and propagates.
   */
  private async runEncoder(chunk: Float32Array): Promise<Record<string, Tensor>> {
    const melFeatures = await computeMelFrame(chunk);
    // [1, N_FRAMES, N_MELS] — time-major, matching the encoder's real
    // audio_signal shape [1, 65, 128] (Task 1's recorded inputMetadata).
    // computeMelFrame's transpose:true + fixed min/max_num_frames already
    // produce data in this exact layout — no reshaping needed here.
    const audioSignal = new Tensor('float32', melFeatures, [1, N_FRAMES, N_MELS]);
    const length = new Tensor('int64', new BigInt64Array([BigInt(N_FRAMES)]), [1]);
    const langIdTensor = new Tensor('int64', new BigInt64Array([BigInt(this.langId)]), [1]);
    const feeds = {
      audio_signal: audioSignal,
      length,
      lang_id: langIdTensor,
      cache_last_channel: this.cacheState.cache_last_channel,
      cache_last_time: this.cacheState.cache_last_time,
      cache_last_channel_len: this.cacheState.cache_last_channel_len,
    };
    try {
      return (await this.encoderSession.run(feeds)) as unknown as Record<string, Tensor>;
    } catch (e) {
      const msg = (e as Error)?.message?.toLowerCase() ?? '';
      if (!msg.includes('shape') && !msg.includes('rank')) throw e;
      console.warn('[NemotronEngine] Encoder shape mismatch, resetting cache state and retrying once:', msg);
      this.cacheState = createZeroCacheState(this.encoderSession);
      feeds.cache_last_channel = this.cacheState.cache_last_channel;
      feeds.cache_last_time = this.cacheState.cache_last_time;
      feeds.cache_last_channel_len = this.cacheState.cache_last_channel_len;
      return (await this.encoderSession.run(feeds)) as unknown as Record<string, Tensor>;
    }
  }

  private async runChunk(chunk: Float32Array): Promise<ChunkTranscript> {
    const encoderOutputs = await this.runEncoder(chunk);
    this.cacheState = nextCacheState(encoderOutputs);

    const runDecoderJoint = async (encoderFrame: Tensor, prevTokenId: number, state: DecoderState) => {
      // targets: [batch, target_len] = [1, 1] — one token per call (greedy).
      const targets = new Tensor('int64', new BigInt64Array([BigInt(prevTokenId)]), [1, 1]);
      // h_in/c_in: [num_layers, batch, hidden] = [2, 1, 640] — verified via
      // Task 1's recorded decoder.onnx inputMetadata. state.h/state.c are
      // always exactly DECODER_LAYERS*DECODER_HIDDEN long (zeroDecoderState()
      // or the previous call's h_out/c_out, which report this same shape).
      const hIn = new Tensor('float32', Float32Array.from(state.h), [DECODER_LAYERS, 1, DECODER_HIDDEN]);
      const cIn = new Tensor('float32', Float32Array.from(state.c), [DECODER_LAYERS, 1, DECODER_HIDDEN]);
      const decoderOut = await this.decoderSession.run({ targets, h_in: hIn, c_in: cIn });

      // decoder_output comes back as [batch, hidden, target_len] = [1, 640, 1]
      // (Task 1's recording), but the joint's decoder_output INPUT wants
      // [batch, target_len, hidden] = [1, 1, 640] — transposed relative to the
      // decoder's own output. For target_len=1 this is NOT a real permutation:
      // both shapes hold the same 640 contiguous floats in the same order (the
      // two size-1 axes don't reorder anything), so re-wrapping the same
      // Float32Array with the joint's expected shape is correct and exact —
      // this would NOT hold if target_len were ever > 1 (multi-token decode
      // calls), which this engine's greedy single-token-per-call design never does.
      const decoderOutForJoint = new Tensor(
        'float32',
        decoderOut.decoder_output.data as Float32Array,
        [1, 1, DECODER_HIDDEN],
      );

      const jointOut = await this.jointSession.run({
        encoder_output: encoderFrame, // [1, 1, 1024] — see per-frame slice below
        decoder_output: decoderOutForJoint,
      });
      // joint_output: [batch, time, target_len, vocab] = [1, 1, 1, 13088] for
      // one frame × one step — the same 13088 floats as a flat vocab vector,
      // since both middle dims are 1. Argmax over the flat buffer is exact.
      const logits = jointOut.joint_output.data as Float32Array;
      let bestId = 0;
      let bestVal = -Infinity;
      for (let i = 0; i < logits.length; i++) if (logits[i] > bestVal) { bestVal = logits[i]; bestId = i; }
      return {
        tokenId: bestId,
        nextState: {
          h: Array.from(decoderOut.h_out.data as Float32Array),
          c: Array.from(decoderOut.c_out.data as Float32Array),
          // Not read within greedyDecodeFrame's inner loop (it tracks lastToken
          // separately and overwrites this field on the final returned state —
          // see rnntDecoder.ts), but DecoderState's type requires it on every
          // constructed value. prevTokenId is the token that produced this
          // predictor (h,c) state, so it is also the semantically correct value.
          lastTokenId: prevTokenId,
        },
      };
    };

    // OUTER loop: one iteration per encoder time-step. INNER loop (Task 5's
    // greedyDecodeFrame): symbols for that one frame, capped at
    // max_symbols_per_step. decoderState carries across BOTH loops — it is
    // utterance-scoped, not frame- or chunk-scoped; only reset() (segment
    // boundary) clears it.
    //
    // encoder outputs.outputs is [1, encFrames, 1024] — time-major, hidden-minor
    // (Task 1's recording: [1, 7, 1024] for a 65-frame input). Slicing one
    // time-step is therefore a plain contiguous subarray, not a strided copy.
    const encoderOutputsTensor = encoderOutputs.outputs as Tensor;
    const [, encFrames, encHidden] = encoderOutputsTensor.dims as number[];
    const fullEncoderData = encoderOutputsTensor.data as Float32Array;
    const allTokenIds: number[] = [];
    for (let t = 0; t < encFrames; t++) {
      // [1, 1, 1024] — one time-step, matching the joint's encoder_output
      // input shape [batch, time, 1024] with time=1 (Task 1's recording).
      const frameData = fullEncoderData.subarray(t * encHidden, (t + 1) * encHidden);
      const encoderFrame = new Tensor('float32', frameData, [1, 1, encHidden]);

      const { tokenIds, nextState } = await greedyDecodeFrame(
        encoderFrame,
        runDecoderJoint,
        this.decoderState,
        BLANK_ID,
        MAX_SYMBOLS_PER_STEP,
      );
      this.decoderState = nextState;
      allTokenIds.push(...tokenIds);
    }

    // An all-blank chunk (every encoder frame's greedy decode hits blank
    // immediately) is a legitimate, common outcome — silence, a pause, or
    // just a quiet chunk — not an error. AutoTokenizer's decode() throws on
    // an empty array ("token_ids must be a non-empty array of integers"),
    // so it must be short-circuited here rather than passed through; this
    // was caught by a real multi-chunk run against the downloaded model; a
    // single sub-chunk smoke test never exercises it.
    const text = allTokenIds.length > 0 ? this.tokenizer.decode(allTokenIds) : '';
    return { text, isFinal: false };
  }
}
