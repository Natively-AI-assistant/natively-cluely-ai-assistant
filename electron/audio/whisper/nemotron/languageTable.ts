// electron/audio/whisper/nemotron/languageTable.ts
//
// Restricted to the model card's "transcription-ready" tier — the other 21
// locales (broad-coverage / adaptation-ready) are NOT exposed in the picker
// this pass; selecting one would silently produce poor transcriptions with
// no warning.
//
// IMPORTANT — these values are NOT tokenizer.json vocabulary ids (an
// earlier draft of this table used that scheme and was wrong: it produces
// EMPTY transcription for every language, confirmed via a live
// differential test in task-11-fix1-report.md). They come from
// github.com/codavidgarcia/nemotron-3.5-asr-streaming-onnx's
// PROMPT_DICTIONARY, a small (0-127) integer index space independently
// corroborated by task-11-fix1-report.md's empirical finding that
// lang_id=0 (this table's 'en-US') produces real, correct transcription
// against the real downloaded model — 'en'/'auto' also exist in that same
// dictionary at indices 0/101 respectively, not used here.
//
// CORRECTION (Task 12 wiring): an earlier draft of this comment claimed
// "this app always has an explicit locale selection, never auto" — that is
// FALSE. 'auto' ("Auto Detect") is a real, user-selectable entry in
// electron/config/languages.ts's RECOGNITION_LANGUAGES, and LocalWhisperSTT
// can receive it. Nemotron still has no real auto-detect mode, so 'auto' is
// intentionally never looked up in THIS table (it is not a table key) —
// but the caller (LocalWhisperSTT.resolveAndApplyNemotronLanguage) handles
// it explicitly by normalizing to 'english-us' before ever calling
// resolveNemotronLangId(), the same precedent AppState.setRecognitionLanguage
// already applies for every other non-NativelyProSTT provider. See that
// method's own doc comment for why this matters (a real, disruptive
// startup-path bug this table's wrong claim would otherwise have hidden).
//
// Re-verified (Task 12) directly against
// https://raw.githubusercontent.com/codavidgarcia/nemotron-3.5-asr-streaming-onnx/main/engine/nemotron_onnx_streaming.py's
// real PROMPT_DICTIONARY contents for all 19 keys below, byte-for-byte —
// matches this brief's table exactly, including 'auto': 101 and 'mt-MT': 102
// (Maltese, deliberately excluded below — adaptation-ready tier, not
// transcription-ready).
//
// Real limitation, disclosed plainly: only 'en-US' (lang_id=0) has been
// verified against real audio in this investigation (task-11-fix1-report.md).
// The other 18 values are verified only by (a) matching this real, cited
// external reference implementation's own working scheme, and (b) sharing
// the same small-integer index space as the one confirmed-correct value —
// real, meaningful corroborating evidence, not a guess, but NOT the same as
// running real non-English audio through the model and confirming correct
// transcription (no such fixtures exist in this environment).
export const NEMOTRON_TRANSCRIPTION_READY_LOCALES: Record<string, number> = {
  'en-US': 0, 'en-GB': 1,
  'es-US': 3, 'es-ES': 2,
  'fr-FR': 8, 'fr-CA': 100,
  'it-IT': 15,
  'pt-BR': 12, 'pt-PT': 13,
  'nl-NL': 16,
  'de-DE': 9,
  'tr-TR': 18,
  'ru-RU': 11,
  'ar-AR': 7,
  'hi-IN': 6,
  'ja-JP': 10,
  'ko-KR': 14,
  'vi-VN': 33,
  'uk-UA': 19,
};

// Alias/inference layer (final-review-fix1 round, I4) — kept OUT of
// NEMOTRON_TRANSCRIPTION_READY_LOCALES itself so that table stays exactly
// the 19 ground-truth-verified reference entries (languageTable.test.mjs
// asserts its exact shape/length); these are resolved one layer up, in
// resolveNemotronLangId() below, instead.
//
// Arabic: electron/config/languages.ts's real `arabic` entry has
// `bcp47: 'ar-SA'`, but the reference PROMPT_DICTIONARY (and this table) key
// the SAME language as 'ar-AR' (both id 7) — a codeset-variant naming
// mismatch between this app's picker and Nemotron's own preferred tag, not a
// different language. Independently verified, not an inference.
const NEMOTRON_LOCALE_ALIASES: Record<string, string> = {
  'ar-SA': 'ar-AR',
};

// English regional variants (electron/config/languages.ts's `english-in` /
// `english-au` / `english-ca` entries, bcp47 'en-IN'/'en-AU'/'en-CA') have NO
// dedicated slot in the reference PROMPT_DICTIONARY at all. Unlike the
// Arabic alias above, mapping them to 'en-US's lang_id (0) is a genuine
// INFERENCE, not an independently-verified correction: regional English
// accents are far closer to US/GB English than to any other supported
// language, but this has NOT been verified against real Indian/Australian/
// Canadian-accented audio in this investigation — unlike 'en-US' itself,
// which HAS real-audio verification (task-11-fix1-report.md).
const NEMOTRON_ENGLISH_VARIANT_LOCALES = new Set(['en-IN', 'en-AU', 'en-CA']);

export function resolveNemotronLangId(locale: string): number | null {
  if (NEMOTRON_ENGLISH_VARIANT_LOCALES.has(locale)) {
    return NEMOTRON_TRANSCRIPTION_READY_LOCALES['en-US'];
  }
  const canonical = NEMOTRON_LOCALE_ALIASES[locale] ?? locale;
  return NEMOTRON_TRANSCRIPTION_READY_LOCALES[canonical] ?? null;
}
