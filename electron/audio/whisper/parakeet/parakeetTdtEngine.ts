// electron/audio/whisper/parakeet/parakeetTdtEngine.ts
import { InferenceSession, Tensor } from 'onnxruntime-node';
import path from 'path';
import fs from 'fs';
import { getBoundedOnnxSessionOptions } from '../../../utils/onnxThreadConfig';
import { ParakeetTokenizer } from './tokenizer';
import { runTdtGreedyDecodeAsync, type TdtJointOutput } from './tdtDecoder';
import type { ParakeetChunkTranscript, ParakeetDecoderState } from './types';

export interface ParakeetTdtSharedResources {
  preprocessorSession: InferenceSession;
  encoderSession: InferenceSession;
  decoderJointSession: InferenceSession;
  tokenizer: ParakeetTokenizer;
  state1Shape: number[];
  state2Shape: number[];
  vocabSize: number;
  blankId: number;
}

export type ParakeetSharedResources = ParakeetTdtSharedResources;

async function createSessionWithFallback(
  filePath: string,
  executionProviders: string[],
): Promise<InferenceSession> {
  const sessionOptions = { ...getBoundedOnnxSessionOptions('rnnt-decode'), executionProviders };
  try {
    return await InferenceSession.create(filePath, sessionOptions as any);
  } catch (e) {
    console.warn(
      `[ParakeetTdtEngine] Session creation failed with providers [${executionProviders.join(',')}] for ${path.basename(filePath)}, falling back to CPU:`,
      (e as Error)?.message,
    );
    const cpuOptions = { ...getBoundedOnnxSessionOptions('rnnt-decode'), executionProviders: ['cpu'] };
    return await InferenceSession.create(filePath, cpuOptions as any);
  }
}

export class ParakeetTdtEngine {
  private shared: ParakeetSharedResources;
  private decoderState: ParakeetDecoderState;
  private pendingPcm: Float32Array = new Float32Array(0);

  private constructor(shared: ParakeetSharedResources) {
    this.shared = shared;
    this.decoderState = this.createZeroDecoderState();
  }

  public static async create(
    modelDir: string,
    executionProviders: string[] = ['cpu'],
    existingShared?: ParakeetSharedResources,
  ): Promise<ParakeetTdtEngine> {
    if (existingShared) {
      return new ParakeetTdtEngine(existingShared);
    }

    const preprocessorPath = path.join(modelDir, 'nemo128.onnx');
    const encoderPath = path.join(modelDir, 'encoder-model.int8.onnx');
    const decoderJointPath = path.join(modelDir, 'decoder_joint-model.int8.onnx');
    const vocabPath = path.join(modelDir, 'vocab.txt');

    if (!fs.existsSync(vocabPath)) {
      throw new Error(`Parakeet vocab file missing at ${vocabPath}`);
    }

    const tokenizer = new ParakeetTokenizer(vocabPath, true);

    const [preprocessorSession, encoderSession, decoderJointSession] = await Promise.all([
      createSessionWithFallback(preprocessorPath, executionProviders),
      createSessionWithFallback(encoderPath, executionProviders),
      createSessionWithFallback(decoderJointPath, executionProviders),
    ]);

    // Derive state shapes from decoderJoint input metadata if available, or default to [2, 1, 640]
    let state1Shape = [2, 1, 640];
    let state2Shape = [2, 1, 640];
    try {
      const inputs = decoderJointSession.inputNames;
      if (inputs.includes('input_states_1')) {
        // default fallback remains [2, 1, 640]
      }
    } catch {
      /* use defaults */
    }

    const shared: ParakeetSharedResources = {
      preprocessorSession,
      encoderSession,
      decoderJointSession,
      tokenizer,
      state1Shape,
      state2Shape,
      vocabSize: tokenizer.vocabSize,
      blankId: tokenizer.blankId,
    };

    return new ParakeetTdtEngine(shared);
  }

  public getSharedResources(): ParakeetSharedResources {
    return this.shared;
  }

  public createZeroDecoderState(): ParakeetDecoderState {
    const s1Len = this.shared.state1Shape.reduce((a, b) => a * b, 1);
    const s2Len = this.shared.state2Shape.reduce((a, b) => a * b, 1);
    return {
      state1: new Float32Array(s1Len),
      state2: new Float32Array(s2Len),
      lastTokenId: this.shared.blankId,
    };
  }

  public reset(): void {
    this.decoderState = this.createZeroDecoderState();
    this.pendingPcm = new Float32Array(0);
  }

  public async transcribe(pcm: Float32Array, resetState: boolean = true): Promise<ParakeetChunkTranscript> {
    if (resetState) {
      this.reset();
    }
    if (!pcm || pcm.length === 0) {
      return { text: '', tokenIds: [], isFinal: true };
    }
    if (pcm.length < 1600) {
      return { text: '', tokenIds: [], isFinal: true };
    }
    return this.transcribeAudio(pcm);
  }

  public async pushAudio(pcmChunk: Float32Array): Promise<ParakeetChunkTranscript> {
    if (pcmChunk.length === 0) {
      return { text: '', tokenIds: [], isFinal: false };
    }

    // Accumulate PCM
    const totalLen = this.pendingPcm.length + pcmChunk.length;
    const combined = new Float32Array(totalLen);
    combined.set(this.pendingPcm);
    combined.set(pcmChunk, this.pendingPcm.length);
    this.pendingPcm = combined;

    // Minimum samples to run a meaningful chunk (~200ms = 3200 samples at 16kHz)
    if (this.pendingPcm.length < 3200) {
      return { text: '', tokenIds: [], isFinal: false };
    }

    const audioToProcess = this.pendingPcm;
    this.pendingPcm = new Float32Array(0);

    return this.transcribeAudio(audioToProcess);
  }

  public async flush(): Promise<ParakeetChunkTranscript> {
    if (this.pendingPcm.length === 0) {
      return { text: '', tokenIds: [], isFinal: true };
    }
    const audio = this.pendingPcm;
    this.pendingPcm = new Float32Array(0);
    const res = await this.transcribeAudio(audio);
    return { ...res, isFinal: true };
  }

  private async transcribeAudio(pcm: Float32Array): Promise<ParakeetChunkTranscript> {
    const numSamples = pcm.length;
    // Preprocessor nemo128: audio_signal [1, numSamples], length [1]
    const audioSignalTensor = new Tensor('float32', pcm, [1, numSamples]);
    const lengthTensor = new Tensor('int64', new BigInt64Array([BigInt(numSamples)]), [1]);

    const preprocOut = await this.shared.preprocessorSession.run({
      audio_signal: audioSignalTensor,
      length: lengthTensor,
    });

    // nemo128 outputs: features [1, 128, T_feat], features_lens [1]
    // Some exports name them "features" or output names:
    const featName = this.shared.preprocessorSession.outputNames[0] || 'features';
    const featLenName = this.shared.preprocessorSession.outputNames[1] || 'features_lens';
    const features = preprocOut[featName];
    const featuresLen = preprocOut[featLenName] ?? new Tensor('int64', new BigInt64Array([BigInt(features.dims[2])]), [1]);

    // Encoder: audio_signal: features, length: featuresLen
    const encFeeds: Record<string, Tensor> = {
      audio_signal: features,
      length: featuresLen,
    };

    const encOut = await this.shared.encoderSession.run(encFeeds);
    const encOutputName = this.shared.encoderSession.outputNames[0] || 'outputs';
    const encOutputLensName = this.shared.encoderSession.outputNames[1] || 'encoded_lengths';

    const encoderOutTensor = encOut[encOutputName];
    const encodedLengthsTensor = encOut[encOutputLensName];

    // encoder output dims: [batch, hidden, T_enc] or [batch, T_enc, hidden]
    // NeMo FastConformer typically has shape [1, hidden, T_enc]
    const dims = encoderOutTensor.dims;
    let encodingsLen = 0;
    let hiddenDim = 0;
    let timeDimAxis = 2; // if [1, hidden, T]

    if (encodedLengthsTensor && encodedLengthsTensor.data && encodedLengthsTensor.data.length > 0) {
      encodingsLen = Number(encodedLengthsTensor.data[0]);
    } else {
      encodingsLen = dims[2] !== undefined ? dims[2] : dims[1];
    }

    if (dims.length === 3) {
      if (dims[1] > dims[2]) {
        // [1, hidden, T]
        hiddenDim = dims[1];
        timeDimAxis = 2;
      } else {
        // [1, T, hidden]
        hiddenDim = dims[2];
        timeDimAxis = 1;
      }
    }

    const rawEncData = encoderOutTensor.data as Float32Array;

    // Decode Joint function
    const decodeJointFn = async (
      frameIndex: number,
      prevToken: number,
      state: ParakeetDecoderState,
    ): Promise<TdtJointOutput> => {
      // Slice frame: [1, hiddenDim, 1]
      const frameData = new Float32Array(hiddenDim);
      if (timeDimAxis === 2) {
        // [1, hidden, T]: frameIndex across hidden
        const T = dims[2];
        for (let h = 0; h < hiddenDim; h++) {
          frameData[h] = rawEncData[h * T + frameIndex];
        }
      } else {
        // [1, T, hidden]: contiguous frame
        frameData.set(rawEncData.subarray(frameIndex * hiddenDim, (frameIndex + 1) * hiddenDim));
      }

      const encoderOutputsTensor = new Tensor('float32', frameData, [1, hiddenDim, 1]);
      const targetsTensor = new Tensor('int64', new BigInt64Array([BigInt(prevToken)]), [1, 1]);
      const targetLengthTensor = new Tensor('int64', new BigInt64Array([1n]), [1]);
      const s1Tensor = new Tensor('float32', state.state1, this.shared.state1Shape);
      const s2Tensor = new Tensor('float32', state.state2, this.shared.state2Shape);

      const jointFeeds: Record<string, Tensor> = {
        encoder_outputs: encoderOutputsTensor,
        targets: targetsTensor,
        target_length: targetLengthTensor,
        input_states_1: s1Tensor,
        input_states_2: s2Tensor,
      };

      const jointOut = await this.shared.decoderJointSession.run(jointFeeds);
      const logitsTensor = jointOut.outputs || jointOut[this.shared.decoderJointSession.outputNames[0]];
      const outS1 = jointOut.output_states_1 || jointOut[this.shared.decoderJointSession.outputNames[1]];
      const outS2 = jointOut.output_states_2 || jointOut[this.shared.decoderJointSession.outputNames[2]];

      return {
        logits: logitsTensor.data as Float32Array,
        state1: (outS1?.data as Float32Array) || state.state1,
        state2: (outS2?.data as Float32Array) || state.state2,
      };
    };

    const decodeRes = await runTdtGreedyDecodeAsync({
      encodingsLen,
      vocabSize: this.shared.vocabSize,
      blankId: this.shared.blankId,
      maxTokensPerStep: 10,
      decodeJointFn,
      initialState: this.decoderState,
    });

    this.decoderState = decodeRes.finalState;
    const text = this.shared.tokenizer.decode(decodeRes.tokens);

    return {
      text,
      tokenIds: decodeRes.tokens,
      isFinal: false,
    };
  }
}
