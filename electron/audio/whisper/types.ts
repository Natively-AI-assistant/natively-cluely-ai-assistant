export type WhisperModelId =
  | 'Xenova/whisper-tiny'
  | 'Xenova/whisper-tiny.en'
  | 'Xenova/whisper-base'
  | 'Xenova/whisper-base.en'
  | 'Xenova/whisper-small'
  | 'Xenova/whisper-small.en'
  | 'Xenova/whisper-medium'
  | 'Xenova/whisper-medium.en'
  | 'Xenova/whisper-large-v3'
  // Whisper Large v3 Turbo — 6× faster than Large v3, ~equivalent WER,
  // multilingual. ONNX-converted by the onnx-community.
  | 'onnx-community/whisper-large-v3-turbo'
  // Legacy catalog id kept so old settings can be migrated to the canonical
  // Transformers.js repo id above.
  | 'onnx-community/whisper-large-v3-turbo-ONNX'
  // Distil-Whisper — same architecture, distilled to 1/2 layers, ~6× faster
  // CPU/GPU inference at near-equivalent WER. English-only.
  | 'distil-whisper/distil-small.en'
  | 'distil-whisper/distil-medium.en'
  | 'distil-whisper/distil-large-v2'
  | 'distil-whisper/distil-large-v3'
  // Moonshine — purpose-built streaming ASR. Encoder caching + decoder state
  // reuse → ~100× lower latency than Whisper Large v3 at comparable WER.
  // English-only. MIT licensed.
  | 'onnx-community/moonshine-tiny-ONNX'
  | 'onnx-community/moonshine-base-ONNX';

export type WhisperModelStatus = 'available' | 'missing' | 'downloading' | 'error';

export interface WhisperModelInfo {
  id: WhisperModelId;
  name: string;
  sizeMb: number;
  speed: 'very-fast' | 'fast' | 'medium' | 'slow';
  accuracy: 'decent' | 'good' | 'high' | 'very-high';
  multilingual: boolean;
  status: WhisperModelStatus;
  downloadProgress?: number;
  errorMessage?: string;
  requiresAppleSilicon?: boolean;
  // Distil-Whisper variants — surface in the UI so users can prefer them
  // when they want streaming-comparable latency.
  distilled?: boolean;
  // Moonshine: streaming-native architecture, ~100× lower perceived latency
  // than Whisper. Highest priority recommendation for English live use.
  streaming?: boolean;
}

export interface WorkerInitMessage {
  type: 'init';
  modelId: string;
  cacheDir: string;
  executionProviders?: string[];
  // Per-module dtype map (see inferenceConfig.ts). String applies to all
  // ONNX files; Record keys are ONNX basenames without `.onnx`.
  dtype?: string | Record<string, string>;
}
export interface WorkerTranscribeMessage {
  type: 'transcribe';
  taskId: string;
  audio: Float32Array;
  language: string;
  // streaming=true → partial pass on in-progress audio, worker emits 'partial'
  //                  with deterministic params (no condition_on_previous_text).
  // streaming=false (default) → final pass, emits 'result'.
  streaming?: boolean;
}
/**
 * Out-of-band prompt update. Sent only when the host's context string
 * actually changes (not on every transcribe), so the prompt text — which
 * can be up to ~8KB of chars — doesn't get copied through worker IPC on
 * every 1.5s streaming tick. Worker tokenizes once and reuses the IDs for
 * all subsequent transcribes until the next setPrompt arrives. Ignored by
 * Moonshine (no equivalent decoder mechanism).
 */
export interface WorkerSetPromptMessage {
  type: 'setPrompt';
  prompt: string;
}
export type WorkerInMessage = WorkerInitMessage | WorkerTranscribeMessage | WorkerSetPromptMessage;

export interface WorkerReadyResponse { type: 'ready'; }
export interface WorkerResultResponse { type: 'result'; taskId: string; text: string; }
export interface WorkerPartialResponse { type: 'partial'; taskId: string; text: string; }
export interface WorkerErrorResponse { type: 'error'; taskId?: string; message: string; }
export interface WorkerProgressResponse { type: 'progress'; modelId: string; progress: number; }
export type WorkerOutMessage =
  | WorkerReadyResponse
  | WorkerResultResponse
  | WorkerPartialResponse
  | WorkerErrorResponse
  | WorkerProgressResponse;
