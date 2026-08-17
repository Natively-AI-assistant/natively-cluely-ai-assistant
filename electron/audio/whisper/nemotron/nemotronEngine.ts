// electron/audio/whisper/nemotron/nemotronEngine.ts
import { InferenceSession, Tensor } from 'onnxruntime-node';
import path from 'path';
import { getBoundedOnnxSessionOptions } from '../../../utils/onnxThreadConfig';
import { computeMelFrame, CHUNK_SAMPLES, N_MELS, N_FRAMES, LOOKBACK_SAMPLES } from './melFrontend';
import { createZeroCacheState, nextCacheState, type NemotronCacheState } from './cacheState';
import { greedyDecodeFrame, BLANK_ID, MAX_SYMBOLS_PER_STEP, type DecoderState, type DecoderJointFn } from './rnntDecoder';
import { loadNemotronTokenizer, type NemotronTokenizer } from './tokenizer';

// Task 11 fix1 round: DEFAULT_LANG_ID = 0, empirically verified against real
// audio with Part A's real cross-chunk pre-cache history fix in place — NOT
// derived from the vocab and NOT assumed transferred from the FP16 sibling
// export's language_mask scheme (that mechanism is structurally different,
// a one-hot [1,128] mask vs. this export's scalar lang_id input — see
// task-11-debug3-report.md §1c). 0 was tried first because it's the FP16
// export's own confirmed en-US index (task-11-debug3-report.md §1c) and the
// most concrete real number available; task-11-debug1-report.md §4's earlier
// 0-127 sweep found id=0 behaviorally distinct (constant `▁` runner-up
// cluster) but did NOT flip any frame non-blank — that sweep ran BEFORE
// Part A's pre-cache fix existed. Retested here, on top of Part A: lang_id=0
// produces real, recognizable transcribed text ("Quick brown fox jump s over
// the la zy dog", 77.8% word overlap vs the known fixture phrase) where the
// previous value (2947, a vocab-token id mistakenly used as a conditioning
// index — task-11-debug1-report.md §4) still produces empty output even
// with Part A's fix applied. Also retested id=7 (highest min-margin in the
// original 0-127 sweep) — still empty — and id=102 (lowest min-margin) —
// partial (44.4% overlap, worse than 0). See task-11-fix1-report.md's Part B
// section for the full sweep and per-value results.
//
// Previous value, kept here as a comment for traceability: 2947 (<en-US> in
// the export's TEXT VOCABULARY, not a language-conditioning index — confirmed
// wrong in task-11-debug1-report.md §4).
const DEFAULT_LANG_ID = 0;

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
  // The raw RNNT token ids this chunk emitted, in order. Callers that
  // assemble a SEGMENT-level transcript must accumulate these and decode
  // them in ONE decodeTokens() call at the end, NOT join the per-chunk
  // `text` strings: a word whose SentencePiece pieces straddle a 560ms
  // chunk boundary ('▁la' in chunk N, 'zy' in chunk N+1) decodes correctly
  // only when both pieces are in the same decode call — text-joining
  // produces 'la zy'. (2026-08-14 code review, finding on whisperWorker's
  // old `results.map(r => r.text).join(' ')`.)
  tokenIds: number[];
  isFinal: false; // per-chunk output is always a partial; segment-close emits the final separately
}

/**
 * Dual-channel support (2026-08-13): the 3 loaded ONNX sessions + tokenizer,
 * extracted from one NemotronEngine instance so a SECOND instance can be
 * constructed against the exact same objects instead of loading its own
 * fresh copies from disk. Safe because ONNX Runtime sessions are stateless
 * compute graphs — `InferenceSession.run()` carries all state via its own
 * input/output tensors, never on the session object itself — so concurrent
 * `.run()` calls from two different NemotronEngine instances against the
 * same shared session are a supported ORT pattern. These sessions are built
 * with getBoundedOnnxSessionOptions('rnnt-decode'), whose intra-op default is
 * now the performance-core count (capped at 4) rather than 1 — so concurrent
 * calls from two channels genuinely parallelize inside the session instead of
 * serializing on a single thread, as an earlier version of this comment
 * described. Sharing stays correct either way; that reasoning never depended
 * on the thread count, only on run() carrying all state in its own tensors.
 * The tokenizer is likewise safe to share: loadNemotronTokenizer's
 * returned `decode()` (see tokenizer.ts) only reads from the loaded
 * vocab/model — convert_ids_to_tokens() is a pure id-array -> token-array
 * lookup with no mutable per-call instance state — confirmed by direct
 * inspection, not assumed.
 */
export interface NemotronSharedResources {
  encoderSession: InferenceSession;
  decoderSession: InferenceSession;
  jointSession: InferenceSession;
  tokenizer: NemotronTokenizer;
}

async function createSessionWithFallback(
  filePath: string,
  executionProviders: string[],
): Promise<InferenceSession> {
  const sessionOptions = { ...getBoundedOnnxSessionOptions('rnnt-decode'), executionProviders };
  try {
    return await InferenceSession.create(filePath, sessionOptions as any);
  } catch (e) {
    console.warn(
      `[NemotronEngine] Session creation failed with providers [${executionProviders.join(',')}] for ${path.basename(filePath)}, falling back to CPU:`,
      (e as Error)?.message,
    );
    return InferenceSession.create(filePath, { ...getBoundedOnnxSessionOptions('rnnt-decode'), executionProviders: ['cpu'] } as any);
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
  // Task 11 fix1 round: real raw-PCM cross-chunk history, replacing the old
  // synthetic-zero-padding approach — see melFrontend.ts's computeMelFrame
  // doc comment and LOOKBACK_SAMPLES' comment for the full measured
  // methodology. Empty (no real history) until the first chunk is processed;
  // reset() (segment boundary) clears it back to empty, matching the FP16
  // reference export's own chunk-0 all-zero pre_cache behavior
  // (task-11-debug3-report.md §1d).
  private lookbackBuffer = new Float32Array(0);

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

  /**
   * `shared`, when provided, skips the load-from-disk path entirely and
   * constructs this instance directly against another instance's already-
   * loaded sessions/tokenizer (see NemotronSharedResources's doc comment for
   * why that's safe). `modelDir` is unused in that branch — kept in the
   * signature for symmetry/logging, not read.
   *
   * Every existing caller that doesn't pass `shared` (integration.test.mjs,
   * every other *.test.mjs in this directory, and whisperWorker.ts's own
   * first-channel-of-a-worker path) keeps hitting the fresh-load Promise.all(...)
   * path below — zero blast radius on the already-verified single-channel
   * accuracy fix. The tokenizer load joined that Promise.all rather than
   * trailing it: it reads its own files and touches no session, so overlapping
   * it with session creation changes cold-start latency only, not results or
   * ordering. Nothing else about the load path changed.
   */
  static async create(
    modelDir: string,
    executionProviders: string[],
    shared?: NemotronSharedResources,
  ): Promise<NemotronEngine> {
    if (shared) {
      return new NemotronEngine(shared.encoderSession, shared.decoderSession, shared.jointSession, shared.tokenizer);
    }
    const [encoderSession, decoderSession, jointSession, tokenizer] = await Promise.all([
      createSessionWithFallback(path.join(modelDir, 'encoder.onnx'), executionProviders),
      createSessionWithFallback(path.join(modelDir, 'decoder.onnx'), executionProviders),
      createSessionWithFallback(path.join(modelDir, 'joint.onnx'), executionProviders),
      loadNemotronTokenizer(modelDir),
    ]);
    return new NemotronEngine(encoderSession, decoderSession, jointSession, tokenizer);
  }

  /**
   * Extracts this instance's loaded sessions/tokenizer so a SECOND
   * NemotronEngine (a second channel, e.g. system-audio joining after mic
   * already loaded the model) can be constructed against them via
   * `create(..., shared)` instead of loading its own fresh copies. Does not
   * expose `this.cacheState`/`this.decoderState`/etc — only the stateless,
   * safely-shareable resources.
   */
  getSharedResources(): NemotronSharedResources {
    return {
      encoderSession: this.encoderSession,
      decoderSession: this.decoderSession,
      jointSession: this.jointSession,
      tokenizer: this.tokenizer,
    };
  }

  setLanguage(langId: number): void {
    this.langId = langId;
  }

  reset(): void {
    this.cacheState = createZeroCacheState(this.encoderSession);
    this.decoderState = zeroDecoderState();
    this.pendingLength = 0;
    this.lookbackBuffer = new Float32Array(0);
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
    // Task 11 fix1 round: pass the current real cross-chunk lookback (empty
    // only on the very first chunk of a segment) so computeMelFrame's
    // leading PRE_ENCODE_CACHE_SIZE frames are real history, not synthetic
    // padding. `chunk` is always exactly CHUNK_SAMPLES long here (both
    // pushAudio's pendingBuffer and flush()'s zero-padded remainder), so its
    // own tail is always >= LOOKBACK_SAMPLES long — `.slice()` (not
    // `.subarray()`) copies, so this is safe even though `chunk` may be the
    // reused pendingBuffer scratch array that gets overwritten by the next
    // pushAudio() call.
    const melFeatures = await computeMelFrame(chunk, this.lookbackBuffer);
    this.lookbackBuffer = chunk.slice(chunk.length - LOOKBACK_SAMPLES);
    // [1, N_FRAMES, N_MELS] — time-major, matching the encoder's real
    // audio_signal shape [1, 65, 128] (Task 1's recorded inputMetadata).
    // computeMelFrame's transpose:true + real-history assembly already
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

    // Annotated as DecoderJointFn rather than inferred. greedyDecodeFrame's
    // parameter is typed `EncoderFrame` (= unknown) so rnntDecoder.ts stays
    // pure logic with no onnxruntime-node dependency; under strictFunctionTypes
    // a lambda declaring `encoderFrame: Tensor` is NOT assignable to one
    // declaring `unknown` (parameters are contravariant), which is TS2345 at
    // the greedyDecodeFrame call below. Taking the callback's own type and
    // narrowing at the single use site keeps that boundary intact.
    const runDecoderJoint: DecoderJointFn = async (encoderFrame, prevTokenId, state) => {
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
        // Narrowed from EncoderFrame (unknown) — the outer loop below always
        // passes a [1, 1, 1024] Tensor it constructs itself; see the slice there.
        encoder_output: encoderFrame as Tensor,
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
    return { text, tokenIds: allTokenIds, isFinal: false };
  }

  /**
   * Decodes an arbitrary accumulated token-id sequence with the loaded
   * tokenizer. This is how a caller assembling a SEGMENT transcript from
   * multiple ChunkTranscript.tokenIds arrays must produce text — one decode
   * over the whole sequence, so words straddling chunk boundaries come out
   * whole (see ChunkTranscript.tokenIds). Empty input short-circuits to ''
   * (AutoTokenizer.decode throws on an empty array — same guard runChunk
   * already carries).
   */
  decodeTokens(ids: number[]): string {
    return ids.length > 0 ? this.tokenizer.decode(ids) : '';
  }
}
