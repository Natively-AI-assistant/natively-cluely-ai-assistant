// electron/audio/whisper/modelLanguageSupport.ts
//
// Single source of truth for WHICH recognition languages each local STT
// model actually accepts, verified against each model's official reference
// documentation (2026-08-19):
//
//   Moonshine tiny/base      — English-only. Model card
//                              (huggingface.co/UsefulSensors/moonshine-base):
//                              "capable of transcribing English speech audio
//                              into English text".
//   Parakeet CTC 0.6B        — English-only. Model card
//                              (huggingface.co/nvidia/parakeet-ctc-0.6b):
//                              "transcribes speech in lower case English
//                              alphabet".
//   Distil-Whisper (all)     — English-only. Model card
//                              (huggingface.co/distil-whisper/distil-large-v3):
//                              "the Distil-Whisper English series"; passing
//                              `language`/`task` to an English-only Whisper
//                              checkpoint THROWS in transformers.js (see
//                              whisperWorker.ts's English-only guard).
//   Whisper *.en             — English-only, same transformers.js contract.
//   Whisper multilingual     — OpenAI's official 99-language set, which is a
//   (tiny/base/small/medium/   strict superset of every entry in
//    large-v3-turbo)           RECOGNITION_LANGUAGES; also supports 'auto'
//                              (omit the language token). Whisper's language
//                              conditioning is a plain language token — there
//                              is NO regional/accent parameter, so en-US vs
//                              en-GB is not expressible.
//   Nemotron 3.5 Streaming   — the 19 transcription-ready locales in
//                              ./nemotron/languageTable.ts, verified
//                              byte-for-byte against NVIDIA's reference
//                              PROMPT_DICTIONARY (see that file's provenance
//                              comment). The ONLY local model whose language
//                              conditioning distinguishes regional variants
//                              (en-US vs en-GB, pt-BR vs pt-PT, ...). No
//                              auto-detect mode.
//
// Consumed by:
//   - whisperWorker.ts       — English-only guard + language-tag resolution
//   - ipcHandlers.ts         — `local-whisper-get-models` attaches a
//                              LocalModelLanguageSupport per model so the
//                              Settings UI can restrict/grey the Language and
//                              Accent/Region selects to what the active model
//                              accepts.
//
// Pure module: no electron imports, safe in the worker thread and testable
// under plain node.

import { MODEL_CATALOG } from './modelManager';
import { RECOGNITION_LANGUAGES, ENGLISH_VARIANTS } from '../../config/languages';
import { resolveNemotronLangId } from './nemotron/languageTable';

export interface LocalModelLanguageSupport {
  /**
   * False when the model's language is fixed (English-only checkpoints):
   * the Language select should render greyed-out showing "English".
   */
  languageSelectable: boolean;
  /**
   * True only when the model's language conditioning distinguishes regional
   * variants (currently Nemotron alone). False → the Accent/Region select
   * renders greyed-out: Whisper-family models take a regional-neutral
   * language token, English-only models take nothing at all.
   */
  accentSelectable: boolean;
  /**
   * RECOGNITION_LANGUAGES keys this model accepts, including 'auto' when the
   * model can genuinely auto-detect. The Settings UI must offer ONLY these.
   */
  allowedLanguageKeys: string[];
}

// ── Whisper's language-token names, keyed by this app's iso639 codes. ──────
// Every RECOGNITION_LANGUAGES entry maps to one of Whisper's official 99
// languages (openai/whisper tokenizer.py LANGUAGES). Values are the full
// names because that is what the existing worker contract passes to
// transformers.js (which accepts either names or codes).
const WHISPER_LANGUAGE_BY_ISO639: Record<string, string> = {
  en: 'english',
  id: 'indonesian',
  ru: 'russian',
  es: 'spanish',
  fr: 'french',
  de: 'german',
  it: 'italian',
  pt: 'portuguese',
  ja: 'japanese',
  ko: 'korean',
  zh: 'chinese',
  tr: 'turkish',
  uk: 'ukrainian',
  ro: 'romanian',
  pl: 'polish',
  nl: 'dutch',
  ar: 'arabic',
  hi: 'hindi',
  sv: 'swedish',
  no: 'norwegian',
  // The app's Norwegian entry uses the BCP-47 tag 'nb-NO' (Bokmål) with
  // iso639 'no'; Whisper has no separate Bokmål code, so both route to its
  // 'norwegian' token.
  nb: 'norwegian',
  da: 'danish',
  cs: 'czech',
  hu: 'hungarian',
  vi: 'vietnamese',
  th: 'thai',
  el: 'greek',
  bg: 'bulgarian',
  he: 'hebrew',
  ms: 'malay',
  fi: 'finnish',
};

/**
 * Resolves what the host passes on WorkerTranscribeMessage.language — the
 * app's internal settings key ('english-us', 'french', 'auto'; see
 * RECOGNITION_LANGUAGES) — to the Whisper language name transformers.js
 * expects, or null for 'auto'/unknown (Whisper then auto-detects).
 *
 * Also accepts raw BCP-47 tags ('en-US') and bare iso639 codes ('en') for
 * compatibility with the worker's previous LANG_MAP contract.
 */
export function resolveWhisperLanguage(languageKeyOrTag: string): string | null {
  const raw = (languageKeyOrTag ?? '').trim();
  if (!raw || raw === 'auto') return null;

  // Internal settings key ('english-us', 'french', ...)
  const entry = RECOGNITION_LANGUAGES[raw];
  if (entry) return WHISPER_LANGUAGE_BY_ISO639[entry.iso639] ?? null;

  // BCP-47 ('en-US') or bare iso639 ('en')
  const iso = raw.split('-')[0].toLowerCase();
  return WHISPER_LANGUAGE_BY_ISO639[iso] ?? null;
}

/**
 * English-only local models, derived from the catalog's own `multilingual`
 * flag rather than a hand-maintained id list (the previous hardcoded set in
 * whisperWorker.ts silently omitted Parakeet). Unknown ids are treated as
 * English-only — the conservative direction: for these models the worker
 * omits `language`/`task`, which is always safe, whereas passing them to an
 * English-only checkpoint throws in transformers.js.
 */
export function isEnglishOnlyLocalModel(modelId: string): boolean {
  const m = MODEL_CATALOG.find((x) => x.id === modelId);
  return m ? !m.multilingual : true;
}

const ENGLISH_VARIANT_KEYS = Object.keys(ENGLISH_VARIANTS);

function isNemotronModel(modelId: string): boolean {
  return MODEL_CATALOG.find((x) => x.id === modelId)?.sessionLayout === 'nemotron-rnnt';
}

/**
 * Language capability of one local model. Derivations:
 *  - Nemotron: every RECOGNITION_LANGUAGES key whose BCP-47 locale resolves
 *    through resolveNemotronLangId() (the verified transcription-ready tier,
 *    including the documented en-IN/en-AU/en-CA → en-US inference and the
 *    ar-SA → ar-AR alias). 'auto' excluded — Nemotron has no auto-detect.
 *  - Multilingual Whisper family: everything, including 'auto'.
 *  - English-only models: the English variants only, language locked.
 */
export function getLocalModelLanguageSupport(modelId: string): LocalModelLanguageSupport {
  if (isNemotronModel(modelId)) {
    const allowed = Object.entries(RECOGNITION_LANGUAGES)
      .filter(([key, lang]) => key !== 'auto' && resolveNemotronLangId(lang.bcp47) !== null)
      .map(([key]) => key);
    return { languageSelectable: true, accentSelectable: true, allowedLanguageKeys: allowed };
  }
  if (!isEnglishOnlyLocalModel(modelId)) {
    return {
      languageSelectable: true,
      accentSelectable: false,
      allowedLanguageKeys: Object.keys(RECOGNITION_LANGUAGES),
    };
  }
  return {
    languageSelectable: false,
    accentSelectable: false,
    allowedLanguageKeys: [...ENGLISH_VARIANT_KEYS],
  };
}
