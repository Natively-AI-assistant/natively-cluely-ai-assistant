import { RECOGNITION_LANGUAGES } from '../../config/languages';

export const WHISPER_LANGUAGE_MAP: Record<string, string | null> = {
  auto: null,
  'en-US': 'english',
  'en-GB': 'english',
  'en-IN': 'english',
  'en-AU': 'english',
  'en-CA': 'english',
  'fr-FR': 'french',
  'de-DE': 'german',
  'es-ES': 'spanish',
  'ja-JP': 'japanese',
  'ko-KR': 'korean',
  'zh-CN': 'chinese',
  'zh-TW': 'chinese',
  'pt-BR': 'portuguese',
  'pt-PT': 'portuguese',
  'it-IT': 'italian',
  'ru-RU': 'russian',
  'id-ID': 'indonesian',
  'tr-TR': 'turkish',
  'uk-UA': 'ukrainian',
  ar: 'arabic',
  'hi-IN': 'hindi',

  // Internal Natively recognition keys. Keep these here so worker messages are
  // robust even if an older caller sends the stored credential key directly.
  'english-us': 'english',
  'english-uk': 'english',
  'english-in': 'english',
  'english-au': 'english',
  'english-ca': 'english',
  indonesian: 'indonesian',
  russian: 'russian',
  spanish: 'spanish',
  french: 'french',
  german: 'german',
  italian: 'italian',
  portuguese: 'portuguese',
  japanese: 'japanese',
  korean: 'korean',
  chinese: 'chinese',
  turkish: 'turkish',
  ukrainian: 'ukrainian',
};

export const ENGLISH_ONLY_MODELS = new Set([
  // Moonshine — English-only by design
  'onnx-community/moonshine-tiny-ONNX',
  'onnx-community/moonshine-base-ONNX',
  // Distil-Whisper — English-only checkpoints
  'distil-whisper/distil-small.en',
  'distil-whisper/distil-medium.en',
  'distil-whisper/distil-large-v2',
  'distil-whisper/distil-large-v3',
  // Whisper .en variants
  'Xenova/whisper-tiny.en',
  'Xenova/whisper-base.en',
  'Xenova/whisper-small.en',
  'Xenova/whisper-medium.en',
]);

export function normalizeLocalWhisperLanguage(key: string | null | undefined): string {
  const value = (key ?? '').trim();
  if (!value || value === 'auto') return 'auto';

  const recognitionLanguage = RECOGNITION_LANGUAGES[value];
  if (recognitionLanguage) return recognitionLanguage.bcp47;

  if (Object.prototype.hasOwnProperty.call(WHISPER_LANGUAGE_MAP, value)) {
    return value;
  }

  console.warn(`[LocalWhisperSTT] Unsupported recognition language "${value}" — falling back to auto`);
  return 'auto';
}

export function resolveWhisperLanguage(language: string | null | undefined): string | null {
  return WHISPER_LANGUAGE_MAP[normalizeLocalWhisperLanguage(language)] ?? null;
}

export function isEnglishOnlyModel(modelId: string): boolean {
  return ENGLISH_ONLY_MODELS.has(modelId);
}
