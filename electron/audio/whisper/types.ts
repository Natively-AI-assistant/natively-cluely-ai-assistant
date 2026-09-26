export type WhisperModelId =
  | 'Xenova/whisper-tiny'
  | 'Xenova/whisper-tiny.en'
  | 'Xenova/whisper-base'
  | 'Xenova/whisper-base.en'
  | 'Xenova/whisper-small'
  | 'Xenova/whisper-small.en'
  | 'Xenova/whisper-medium'
  | 'Xenova/whisper-medium.en'
  // Whisper Large v3 Turbo — 6× faster than Large v3, ~equivalent WER,
  // multilingual. ONNX-converted by the onnx-community.
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
  | 'onnx-community/moonshine-base-ONNX'
  // Parakeet — NVIDIA Conformer CTC, English-only, CC-BY-4.0. Single-session:
  // CTC has no autoregressive decoder, so the repo ships one `onnx/model.onnx`
  // instead of the encoder/decoder pair every other id here uses. See
  // `sessionLayout` on WhisperModelInfo.
  | 'onnx-community/parakeet-ctc-0.6b-ONNX'
  // Nemotron 3.5 ASR Streaming — NVIDIA's cache-aware FastConformer-RNNT,
  // multilingual, genuinely chunked/streaming (not simulated like every other
  // entry above). Int4 ONNX export via onnx-community. Bypasses
  // @huggingface/transformers' pipeline() entirely — see
  // electron/audio/whisper/nemotron/ for the raw onnxruntime-node engine that
  // drives its three graphs (encoder/decoder/joint) directly.
  | 'onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4';

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
  // ONNX external-data format. Large checkpoints (e.g. Whisper Large v3 Turbo)
  // store the graph in `encoder_model.onnx` (a small stub) but the weights in a
  // sibling `encoder_model.onnx_data` file. @huggingface/transformers only
  // fetches that companion when `use_external_data_format` is truthy, and this
  // model's config.json does NOT declare it — so without this flag the weight
  // file is never downloaded and ONNX Runtime aborts on load. Shape matches the
  // upstream `transformers.js_config` convention: `true` for all chunked files,
  // or a map keyed by ONNX basename (e.g. `{ 'encoder_model.onnx': true }`).
  externalDataFormat?: boolean | Record<string, boolean>;
  /**
   * ONNX session layout.
   *
   * Whisper, Distil-Whisper and Moonshine are all encoder-decoder: an
   * `encoder_model.onnx` plus either a merged decoder or a
   * (decoder + decoder_with_past) pair. That is the default and stays implicit.
   *
   * `'single'` is a one-session CTC model — Parakeet ships a single
   * `onnx/model.onnx`, because CTC decodes by collapsing frame-level logits and
   * has no autoregressive decoder to load. Without this the cache check looks
   * for an encoder/decoder pair that will never exist and reports the model
   * missing forever, so it re-downloads on every launch and never runs.
   */
  sessionLayout?: 'encoder-decoder' | 'single' | 'nemotron-rnnt';
  /**
   * Set when this catalog entry is not yet functional and must not be
   * surfaced in any user-facing model picker. Everything else about the
   * entry (download provider, worker routing, streaming plumbing) stays
   * intact — this only controls visibility in getAvailableModels()'s
   * output. Set for Nemotron 3.5 ASR Streaming pending a real-model go/no-go
   * fix: it currently transcribes real speech as an empty string (see
   * .superpowers/sdd/2026-08-10-nemotron-local-stt/task-11-report.md
   * and task-11-debug1-report.md for the full diagnostic). Remove this flag
   * only once that same integration test
   * (electron/audio/whisper/nemotron/__tests__/integration.test.mjs)
   * produces a real, materially correct, non-empty transcription against a
   * real downloaded model.
   */
  hidden?: boolean;
}

export interface WorkerInitMessage {
  type: 'init';
  modelId: string;
  cacheDir: string;
  executionProviders?: string[];
  // Per-module dtype map (see inferenceConfig.ts). String applies to all
  // ONNX files; Record keys are ONNX basenames without `.onnx`.
  dtype?: string | Record<string, string>;
  // Catalog download size in bytes — the progress-bar denominator from byte
  // zero (see whisperProgressAggregator.ts). Optional / 0 when unknown, in
  // which case the worker falls back to observed per-file byte totals.
  expectedBytes?: number;
  // Forwarded to transformers' pipeline() as `use_external_data_format` so the
  // sibling `*.onnx_data` weight files of external-data checkpoints get fetched.
  // See WhisperModelInfo.externalDataFormat for the full rationale.
  useExternalDataFormat?: boolean | Record<string, boolean>;
  // Routes the worker between the transformers.js pipeline() path (undefined /
  // 'encoder-decoder' / 'single') and the raw-ONNX Nemotron engine
  // ('nemotron-rnnt'). See WhisperModelInfo.sessionLayout for the source of truth.
  sessionLayout?: 'encoder-decoder' | 'single' | 'nemotron-rnnt';
  // Dual-channel Nemotron only (sessionLayout === 'nemotron-rnnt'; ignored by
  // every other model): identifies which channel (mic/system, or whatever
  // LocalWhisperSTT.channelLabel resolves to) this init is for. Two channels
  // can now share ONE worker + one set of loaded ONNX sessions — see
  // ./nemotron/sharedWorkerRegistry.ts. The worker keeps a per-channelId
  // NemotronEngine instance (see whisperWorker.ts's nemotronChannels map),
  // each with fully isolated decode state, so this field is required (not
  // optional) whenever sessionLayout is 'nemotron-rnnt' — the worker rejects
  // an init with sessionLayout: 'nemotron-rnnt' and no channelId.
  channelId?: string;
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
  // nemotron-rnnt session layout only (silently ignored by every other
  // model): true on the FIRST chunk dispatched for a segment. Tells the
  // worker to call NemotronEngine.reset() before pushAudio() so encoder/
  // decoder cache state never leaks across a VAD segment boundary — or
  // across a warm-preloaded worker's PREVIOUS recording session, since a
  // fresh LocalWhisperSTT instance's sent-sample cursor always starts at 0,
  // so its first chunk always sets this true.
  nemotronReset?: boolean;
  // Dual-channel Nemotron only — see WorkerInitMessage.channelId. Selects
  // which channel's NemotronEngine instance (and serialization chain) this
  // transcribe message belongs to. Absent/ignored for every other model.
  channelId?: string;
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
/**
 * Out-of-band language update — nemotron-rnnt session layout only (silently
 * ignored by every other model, same convention as `nemotronReset` on
 * WorkerTranscribeMessage). Sent only when the host's resolved `lang_id`
 * actually changes (see LocalWhisperSTT's `maybePushNemotronLangToWorker`),
 * mirroring WorkerSetPromptMessage's "only on change" convention. `langId`
 * is a small (0-127) NVIDIA PROMPT_DICTIONARY index — see
 * ./nemotron/languageTable.ts — already resolved and fail-closed-checked by
 * the host; the worker trusts it as-is and forwards it straight to
 * NemotronEngine.setLanguage().
 */
export interface WorkerSetLanguageMessage {
  type: 'setLanguage';
  langId: number;
  // Dual-channel Nemotron only — see WorkerInitMessage.channelId.
  channelId?: string;
}
/**
 * Dual-channel Nemotron only. Sent when one channel's LocalWhisperSTT
 * instance is done with the shared worker (stop() / worker teardown) — the
 * worker drops that channelId's NemotronEngine instance + serialization
 * chain from its per-channel maps without affecting the other channel or
 * the shared ONNX sessions. Whether the underlying worker process itself
 * terminates is decided main-side by sharedWorkerRegistry.ts's refcount,
 * not by this message — the worker just cleans up its own bookkeeping for
 * one channel when told to.
 */
export interface WorkerCloseChannelMessage {
  type: 'closeChannel';
  channelId: string;
}
export type WorkerInMessage =
  | WorkerInitMessage
  | WorkerTranscribeMessage
  | WorkerSetPromptMessage
  | WorkerSetLanguageMessage
  | WorkerCloseChannelMessage;

export interface WorkerReadyResponse { type: 'ready'; channelId?: string; }
export interface WorkerResultResponse { type: 'result'; taskId: string; text: string; channelId?: string; }
export interface WorkerPartialResponse { type: 'partial'; taskId: string; text: string; channelId?: string; }
export interface WorkerErrorResponse { type: 'error'; taskId?: string; message: string; channelId?: string; }
export interface WorkerProgressResponse { type: 'progress'; modelId: string; progress: number; channelId?: string; }
export type WorkerOutMessage =
  | WorkerReadyResponse
  | WorkerResultResponse
  | WorkerPartialResponse
  | WorkerErrorResponse
  | WorkerProgressResponse;
