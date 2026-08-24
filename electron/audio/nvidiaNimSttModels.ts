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

/** Locales documented on the Parakeet 1.1B RNNT multilingual card. */
const PARAKEET_ML_LOCALES = [
  'ar-AR', 'cs-CZ', 'da-DK', 'de-DE', 'en-GB', 'en-US', 'es-ES', 'es-US', 'fr-CA', 'fr-FR',
  'he-IL', 'hi-IN', 'it-IT', 'ja-JP', 'ko-KR', 'nb-NO', 'nl-NL', 'pl-PL', 'pt-BR', 'pt-PT',
  'ru-RU', 'sv-SE', 'th-TH', 'tr-TR',
] as const;

/**
 * Nemotron 3.5 advertises "40 languages and locales" with automatic detection.
 * Its card does not enumerate them, so this reuses the Parakeet multilingual
 * set — a documented subset — rather than inventing the other sixteen. Being
 * short here only hides languages that might work; being long would offer ones
 * that do not.
 */
const NEMOTRON_35_LOCALES = PARAKEET_ML_LOCALES;

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
  /**
   * The model recognises exactly ONE locale. A user's recognition-language pin
   * is ignored for these — sending en-US to a zh-TW deployment is not a
   * preference, it is a misconfigured request.
   */
  singleLocale?: boolean;
  /**
   * BCP-47 locales the model documents, read off its card. Drives which
   * recognition languages Settings offers while the model is selected.
   */
  locales: readonly string[];
}

/**
 * The hosted speech models, and the SINGLE source of truth for them — the ipc
 * validation list and the Settings picker both read this, so adding a model is
 * one edit rather than three that can drift apart.
 *
 * SCOPE: every model here does StreamingRecognize, because that is the only RPC
 * NvidiaNimStreamingSTT issues. build.nvidia.com/explore/speech also lists
 * canary-1b-asr, whisper-large-v3 and parakeet-tdt-0_6b-v2, whose cards document
 * only the OFFLINE transcribe path (transcribe_file_offline.py) — they would
 * open a stream and never answer — plus TTS (magpie, chatterbox) and translation
 * (riva-translate) models, which are not speech recognition at all. Adding any of
 * those needs a second transport, not another row here.
 * Every function-id below was read off that model's own card.
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
    locales: ['en-US'],
  },
  {
    id: 'nemotron-3.5-asr-streaming-multilingual',
    label: 'Nemotron 3.5 ASR',
    description: 'Multilingual streaming ASR (40 locales, auto-detect)',
    functionId: 'bb0837de-8c7b-481f-9ec8-ef5663e9c1fa',
    languageCode: MULTILINGUAL_LANGUAGE_CODE,
    multilingual: true,
    locales: NEMOTRON_35_LOCALES,
  },
  {
    id: 'parakeet-1.1b-rnnt-multilingual-asr',
    label: 'Parakeet 1.1B RNNT',
    description: 'Multilingual streaming ASR',
    functionId: '71203149-d3b7-4460-8231-1be2543a1fca',
    languageCode: MULTILINGUAL_LANGUAGE_CODE,
    multilingual: true,
    locales: PARAKEET_ML_LOCALES,
  },
  {
    id: 'parakeet-ctc-1.1b-asr',
    label: 'Parakeet CTC 1.1B',
    description: 'English • highest-accuracy CTC',
    functionId: '1598d209-5e27-4d3c-8079-4751568b1081',
    languageCode: 'en-US',
    multilingual: false,
    singleLocale: true,
    locales: ['en-US'],
  },
  {
    id: 'parakeet-ctc-0.6b-asr',
    label: 'Parakeet CTC 0.6B',
    description: 'English • lighter and lower latency',
    functionId: 'd8dd4e9b-fbf5-4fb0-9dba-8cf436c8d965',
    languageCode: 'en-US',
    multilingual: false,
    singleLocale: true,
    locales: ['en-US'],
  },
  {
    id: 'parakeet-ctc-0.6b-es',
    label: 'Parakeet CTC 0.6B · Spanish',
    description: 'Spanish (es-US) only',
    functionId: 'a9eeee8f-b509-4712-b19d-194361fa5f31',
    languageCode: 'es-US',
    multilingual: false,
    singleLocale: true,
    locales: ['es-US'],
  },
  {
    id: 'parakeet-ctc-0.6b-zh-cn',
    label: 'Parakeet CTC 0.6B · Chinese',
    description: 'Simplified Chinese (zh-CN) only',
    functionId: '9add5ef7-322e-47e0-ad7a-5653fb8d259b',
    languageCode: 'zh-CN',
    multilingual: false,
    singleLocale: true,
    locales: ['zh-CN'],
  },
  {
    id: 'parakeet-ctc-0.6b-zh-tw',
    label: 'Parakeet CTC 0.6B · Chinese (TW)',
    description: 'Traditional Chinese (zh-TW) only',
    functionId: '8473f56d-51ef-473c-bb26-efd4f5def2bf',
    languageCode: 'zh-TW',
    multilingual: false,
    singleLocale: true,
    locales: ['zh-TW'],
  },
  {
    id: 'parakeet-ctc-0.6b-vi',
    label: 'Parakeet CTC 0.6B · Vietnamese',
    description: 'Vietnamese (vi-VN) only',
    functionId: 'f3dff2bb-99f9-403d-a5f1-f574a757deb0',
    languageCode: 'vi-VN',
    multilingual: false,
    singleLocale: true,
    locales: ['vi-VN'],
  },
] as const;

export const NVIDIA_NIM_STT_MODEL_CONFIG: Record<string, NvidiaNimSttModel> =
  Object.fromEntries(NVIDIA_NIM_STT_MODELS.map((m) => [m.id, m]));

export function isNvidiaNimSttModel(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(NVIDIA_NIM_STT_MODEL_CONFIG, model);
}

/**
 * Recognition-language keys Settings should offer while `modelId` is selected.
 *
 * Resolved per locale, EXACT match first: an en-US deployment offers only
 * "United States", not the four other English accents that merely share the
 * `en` subtag and are not served by that build. Only when a locale has no exact
 * entry does it fall back to the language subtag — NVIDIA ships regional builds
 * (es-US) the app's table has no exact row for (it carries es-ES), and refusing
 * to show "Spanish" for a Spanish model would be pedantry. `singleLocale`
 * already forces the model's own locale onto the wire, so for those the key is
 * a label choice rather than a routing one.
 *
 * `languageTable` is injected rather than imported so this module keeps zero
 * dependencies and the renderer can call it directly.
 * Returns null for an unknown model — meaning "no restriction".
 */
export function allowedLanguageKeysForNvidiaModel(
    modelId: string,
    languageTable: Record<string, { bcp47?: string; iso639?: string }>,
): Set<string> | null {
    const model = NVIDIA_NIM_STT_MODEL_CONFIG[modelId];
    if (!model) return null;
    const entries = Object.entries(languageTable).filter(([key]) => key !== 'auto');
    const keys = new Set<string>();
    for (const locale of model.locales) {
        const exact = entries.filter(([, e]) => (e.bcp47 || '').toLowerCase() === locale.toLowerCase());
        if (exact.length) {
            for (const [key] of exact) keys.add(key);
            continue;
        }
        const subtag = locale.split('-')[0].toLowerCase();
        for (const [key, e] of entries) {
            if ((e.iso639 || e.bcp47 || '').split('-')[0].toLowerCase() === subtag) keys.add(key);
        }
    }
    // Only a model that actually detects language may offer Auto. Riva needs a
    // concrete language_code otherwise, and 'auto' is not one.
    if (model.multilingual) keys.add('auto');
    return keys;
}
