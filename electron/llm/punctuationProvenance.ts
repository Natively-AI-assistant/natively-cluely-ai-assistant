// electron/llm/punctuationProvenance.ts
//
// WTA audit F9 groundwork (2026-08-18). Question detection currently treats a
// missing '?' as negative evidence (transcriptQuestionExtractor confidence
// 0.95 with mark+lead vs 0.4 without), but whether a '?' can even appear is a
// property of the STT provider, not of the utterance: only Deepgram
// (smart_format: true) and Google (enableAutomaticPunctuation: true) request
// punctuation, the local models (Whisper/Moonshine/Nemotron) emit it
// model-inherently, and Soniox/OpenAI/ElevenLabs/NativelyPro/REST providers
// leave it unconfigured. MRDA segmentation research quantifies the stakes:
// stripping punctuation+casing roughly doubles dialogue-act segmentation
// error (14.2% → 32.9% DSER).
//
// This module is the pure capability map. It stamps each transcript segment
// with WHERE its punctuation (if any) came from, so downstream scoring can
// treat absence as NEUTRAL when the provider never guaranteed punctuation —
// never as evidence against question-ness. Raw text is never modified;
// provenance is metadata only. 'restored' is reserved for a future local
// punctuation-restoration stage (which must also never overwrite raw text).

export type PunctuationSource =
    | 'provider_final'    // provider requests/emits punctuation; final segment
    | 'provider_interim'  // provider requests/emits punctuation; interim hypothesis
    | 'restored'          // locally restored (future stage) — moderate evidence only
    | 'unavailable';      // provider does not guarantee punctuation — absence is NEUTRAL

// Provider-setting ids as used by CredentialsManager.getSttProvider() plus
// 'local-whisper' for the local-model family. A provider belongs here ONLY
// when its punctuation is explicitly configured or model-inherent — "the
// provider might punctuate by default" is not enough, because a wrong
// 'provider_final' stamp licenses scoring to penalize a missing '?'.
// Fail-safe direction: unknown/unlisted → 'unavailable' (neutral scoring).
const PUNCTUATING_PROVIDERS = new Set<string>([
    'deepgram',       // smart_format: true (DeepgramStreamingSTT.ts)
    'google',         // enableAutomaticPunctuation: true (GoogleSTT.ts)
    'local-whisper',  // Whisper/Moonshine/Nemotron output is model-punctuated
]);

/**
 * Map an STT provider id + finality to the punctuation provenance of a
 * segment it emitted. Pure; unknown providers fail safe to 'unavailable'.
 */
export function punctuationSourceFor(provider: string | undefined | null, isFinal: boolean): PunctuationSource {
    if (provider && PUNCTUATING_PROVIDERS.has(provider)) {
        return isFinal ? 'provider_final' : 'provider_interim';
    }
    return 'unavailable';
}
