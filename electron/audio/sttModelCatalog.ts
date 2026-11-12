// Speech-to-text models a user may pick per provider, where picking one is a
// value change on the endpoint and message format the app already speaks.
// Pure data: imported by the main process (validation, what a session is
// built with) and by the renderer (the Models list in Settings > Audio), so
// the picker can never offer a model the IPC validator rejects.
//
// Researched 2026-09-26 against the providers' own docs:
//   deepgram  Every model below runs on the v1 live endpoint (wss .../v1/listen)
//             with the options DeepgramStreamingSTT already sends. Flux is left
//             out on purpose: it lives on /v2/listen with a different message
//             schema and parameter set, so it is not a model swap.
//   openai    The three models OpenAIStreamingSTT already knows how to drive
//             (its WS_MODELS ladder). The choice is where that ladder starts.
//             gpt-4o-transcribe / gpt-4o-mini-transcribe shut down 2027-02-26
//             (OpenAI deprecations page, announced 2026-08-26).
// Not listed, and why:
//   soniox      One current real-time model, SONIOX_RT_MODEL below.
//   elevenlabs  One current model per path, ELEVENLABS_*_MODEL below.
//   groq        Its own setting (groqSttModel), predating this module.
//   nvidia_nim  Its own catalogue, nvidiaNimSttModels.ts (a function-id each).
//   azure, ibmwatson, google  No model value on the path the app uses.

// The fixed models of the providers above that have no picker, in one place.
// 2026-11-12, measured live against the old ones with the app's own config:
//   Soniox stt-rt-v6 (v5 is deprecated, removed 2026-12-15; same $0.12/h).
//     Same transcripts, same 60 languages, the endpoint tuning knobs still
//     apply; the first interim word ~300-500 ms later, finals no later.
//   ElevenLabs scribe_v3_live / scribe_v3 (v2 superseded; same $0.22/h and
//     $0.20/h; 27% fewer word errors than v2 on FLEURS per ElevenLabs).
//     Same commits with commit_strategy=vad, first partial ~1 s instead of
//     ~2.5-3 s after speech starts.
// The natively-api relay moved to the same models the same day.
export const SONIOX_RT_MODEL = 'stt-rt-v6';
export const ELEVENLABS_RT_MODEL = 'scribe_v3_live';
export const ELEVENLABS_BATCH_MODEL = 'scribe_v3';

export type SttModelProvider = 'deepgram' | 'openai';

export interface SttModelOption {
    id: string;
    label: string;
    /** One short line for the Models list. */
    description: string;
    /** The model transcribes English only; the Language picker narrows to it. */
    englishOnly?: boolean;
    /** ISO-639-1 codes the model refuses with HTTP 400 on connect. Measured
     *  live against wss://api.deepgram.com/v1/listen on 2026-10-16: Nova-3 has
     *  no Malayalam; Nova-2 has none of the Indian languages but Hindi. */
    unsupportedLanguages?: readonly string[];
}

export const STT_MODEL_CATALOG: Record<SttModelProvider, { defaultId: string; models: SttModelOption[] }> = {
    deepgram: {
        defaultId: 'nova-3',
        models: [
            { id: 'nova-3', label: 'Nova-3', description: 'Most accurate, multilingual', unsupportedLanguages: ['ml'] },
            { id: 'nova-3-medical', label: 'Nova-3 Medical', description: 'Medical vocabulary, English only', englishOnly: true },
            {
                id: 'nova-2', label: 'Nova-2', description: 'Previous generation',
                unsupportedLanguages: ['mr', 'ta', 'te', 'bn', 'gu', 'kn', 'ml', 'pa', 'ur'],
            },
            { id: 'nova-2-meeting', label: 'Nova-2 Meeting', description: 'Tuned for meetings, English only', englishOnly: true },
        ],
    },
    openai: {
        defaultId: 'gpt-live-transcribe',
        models: [
            { id: 'gpt-live-transcribe', label: 'GPT Live Transcribe', description: 'Words appear as you speak' },
            { id: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe', description: 'Per turn; shuts down Feb 2027' },
            { id: 'gpt-4o-mini-transcribe', label: 'GPT-4o mini Transcribe', description: 'Per turn, lower cost; shuts down Feb 2027' },
        ],
    },
};

export function isSttModelProvider(provider: unknown): provider is SttModelProvider {
    return provider === 'deepgram' || provider === 'openai';
}

export function isSttModel(provider: SttModelProvider, id: unknown): id is string {
    return typeof id === 'string' && STT_MODEL_CATALOG[provider].models.some((m) => m.id === id);
}

/** The stored choice if it is still offered, else the provider's default. */
export function resolveSttModel(provider: SttModelProvider, id: unknown): string {
    return isSttModel(provider, id) ? id : STT_MODEL_CATALOG[provider].defaultId;
}

export function isEnglishOnlySttModel(provider: SttModelProvider, id: string): boolean {
    return !!STT_MODEL_CATALOG[provider].models.find((m) => m.id === id)?.englishOnly;
}

/** The model answers this ISO-639-1 language with a 400 (see unsupportedLanguages). */
export function sttModelRejectsLanguage(provider: SttModelProvider, id: string, iso639: string): boolean {
    const code = String(iso639 || '').split('-')[0].toLowerCase();
    return !!code && !!STT_MODEL_CATALOG[provider].models.find((m) => m.id === id)?.unsupportedLanguages?.includes(code);
}
