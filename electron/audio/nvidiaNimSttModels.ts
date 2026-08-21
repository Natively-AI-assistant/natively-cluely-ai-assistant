// Pure data: the hosted NVIDIA speech models. NO node/electron imports, so the
// renderer can import it directly (same pattern as electron/utils/
// rollingTranscriptState) instead of keeping its own copy of the list — the
// Settings picker, the ipc validator and the STT client previously each had
// their own hardcoded copy of these three ids.

/**
 * Language code Riva uses to select a multilingual model's auto-detect mode.
 * NVIDIA's own client examples pass `--language-code multi` for the
 * multilingual profiles; `language_code` is documented Required, so the empty
 * string an earlier revision sent here was never a valid value.
 */
const MULTILINGUAL_LANGUAGE_CODE = 'multi';

export const DEFAULT_NVIDIA_NIM_STT_MODEL = 'nemotron-asr-streaming';

export interface NvidiaNimSttModel {
  id: string;
  label: string;
  description: string;
  /** NVCF function that hosts this model. */
  functionId: string;
  /** language_code sent when the user has not pinned a recognition language. */
  languageCode: string;
  /** Whether the model does its own language detection. */
  multilingual: boolean;
}

/**
 * The hosted speech models, and the SINGLE source of truth for them — the ipc
 * validation list and the Settings picker both read this, so adding a model is
 * one edit rather than three that can drift apart.
 *
 * The two Nemotron entries deliberately share one function-id: that NIM ships
 * two profiles (`nvidia/nemotron-speech-streaming-en-0.6b`, English, and
 * `nvidia/nemotron-3.5-asr-streaming-0.6b`, 40 language-locales), and
 * language_code is what selects between them — which is exactly why sending an
 * empty one collapsed both entries onto the same behaviour.
 */
export const NVIDIA_NIM_STT_MODELS: readonly NvidiaNimSttModel[] = [
  {
    id: 'nemotron-asr-streaming',
    label: 'Nemotron ASR Streaming',
    description: 'Fastest English realtime ASR',
    functionId: 'bb0837de-8c7b-481f-9ec8-ef5663e9c1fa',
    languageCode: 'en-US',
    multilingual: false,
  },
  {
    id: 'nemotron-3.5-asr-streaming-multilingual',
    label: 'Nemotron 3.5 ASR',
    description: 'Multilingual streaming ASR (40 locales, auto-detect)',
    functionId: 'bb0837de-8c7b-481f-9ec8-ef5663e9c1fa',
    languageCode: MULTILINGUAL_LANGUAGE_CODE,
    multilingual: true,
  },
  {
    id: 'parakeet-1.1b-rnnt-multilingual-asr',
    label: 'Parakeet 1.1B RNNT',
    description: 'Multilingual streaming ASR',
    functionId: '71203149-d3b7-4460-8231-1be2543a1fca',
    languageCode: MULTILINGUAL_LANGUAGE_CODE,
    multilingual: true,
  },
] as const;

export const NVIDIA_NIM_STT_MODEL_CONFIG: Record<string, NvidiaNimSttModel> =
  Object.fromEntries(NVIDIA_NIM_STT_MODELS.map((m) => [m.id, m]));

export function isNvidiaNimSttModel(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(NVIDIA_NIM_STT_MODEL_CONFIG, model);
}
