// electron/audio/whisper/parakeet/types.ts

export interface ParakeetTdtConfig {
  modelType: string;
  featuresSize: number;
  subsamplingFactor: number;
  maxTokensPerStep?: number;
}

export interface ParakeetDecoderState {
  state1: Float32Array;
  state2: Float32Array;
  lastTokenId: number;
}

export interface ParakeetChunkTranscript {
  text: string;
  tokenIds: number[];
  isFinal: boolean;
}
