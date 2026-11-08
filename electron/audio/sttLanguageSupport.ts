/**
 * Whether a stand-in transcription provider can actually transcribe the
 * language the user set. Used by failover (sttFailover.ts via
 * sttRecoveryTranscribers) so that, when the live provider goes down, the
 * channel is not handed to a provider that cannot do the language — which
 * would return confident but wrong words rather than a gap.
 *
 * This mirrors Granola's behaviour of choosing the transcriber by the language
 * being spoken, fitted to Natively's model: the language is the one the user
 * picked in Settings, not an auto-detected one, so the test is objective.
 *
 * Conservative by design: a candidate is dropped ONLY when we KNOW it cannot do
 * the language (an English-only model asked for another language; a cloud
 * provider asked for a language only a local model is verified for; a local
 * model whose own set lacks it). Anything unknown is kept, so a provider is
 * never wrongly excluded and English meetings (every provider does English)
 * are never narrowed at all — the common case is unchanged.
 *
 * Platform-neutral: pure data and logic, identical on macOS and Windows.
 */
import { RECOGNITION_LANGUAGES, PARAKEET_ONLY_LANGUAGE_KEYS, normalizeSttLanguageKey } from '../config/languages';

export interface LanguageSupportDeps {
    /** The model a provider would use for this channel (CredentialsManager.getSttModel), for the english-only check. */
    modelFor: (providerId: string) => string | undefined;
    /**
     * Whether provider+model is english-only. MUST be safe for any provider id,
     * including ones with no model catalogue (return false for those).
     */
    isEnglishOnlyModel: (providerId: string, model: string | undefined) => boolean;
    /**
     * For a local-model provider, the recognition-language keys its configured
     * model accepts; null/undefined for anything that is not a restricted local
     * model (so it is not narrowed here).
     */
    localModelLanguageKeys?: (providerId: string) => ReadonlySet<string> | null | undefined;
}

/** Is this recognition-language key English (any regional variant)? */
export function isEnglishLanguageKey(languageKey: string): boolean {
    const key = normalizeSttLanguageKey(languageKey);
    if (key === 'auto') return false;
    const lang = RECOGNITION_LANGUAGES[key];
    return !!lang && lang.iso639 === 'en';
}

/**
 * True unless we KNOW `providerId` cannot transcribe `languageKey`.
 * `languageKey` is a stored STT language (normalised here).
 */
export function sttCandidateSupportsLanguage(providerId: string, languageKey: string | undefined | null, deps: LanguageSupportDeps): boolean {
    const key = normalizeSttLanguageKey(languageKey);
    // Auto-detect asks nothing of the provider; English is universal.
    if (key === 'auto') return true;
    const lang = RECOGNITION_LANGUAGES[key];
    if (lang && lang.iso639 === 'en') return true;

    // A local model is judged against its own language set when we have it.
    const localKeys = deps.localModelLanguageKeys?.(providerId);
    if (localKeys) return localKeys.has(key);

    // A model that only does English cannot do this (non-English) language.
    if (deps.isEnglishOnlyModel(providerId, deps.modelFor(providerId))) return false;

    // A few languages are verified only on the local Parakeet model; no cloud
    // provider was confirmed for them, so a non-local candidate cannot have them.
    if (PARAKEET_ONLY_LANGUAGE_KEYS.has(key)) return false;

    // Otherwise the provider is unrestricted for this language as far as we know.
    return true;
}

/**
 * Keep only the candidates that can do the language, in the given order. When
 * none can, the empty list is returned on purpose: failover then reports the
 * channel failed rather than transcribing the meeting in the wrong language.
 */
export function candidatesForLanguage(candidates: string[], languageKey: string | undefined | null, deps: LanguageSupportDeps): string[] {
    return candidates.filter((id) => sttCandidateSupportsLanguage(id, languageKey, deps));
}
