/**
 * The recovery transcribers for sttGapRecovery.ts, built from the user's
 * saved transcription settings at the moment a recovery runs.
 *
 * Each one opens a PRIVATE instance of a provider class (never wired to the
 * live transcript), so the vocabulary, language and key handling are the
 * provider's own. Which ones may hear the audio is planRecoveryTranscribers'
 * decision (privacy first: local transcription stays local).
 *
 * Platform-neutral: every class here runs the same on macOS and Windows; the
 * local model is the only machine-bound one and is used only when it is
 * already on disk.
 */

import {
    createReplayTranscriber,
    planRecoveryTranscribers,
    type RecoveryPlanEntry,
    type RecoveryTranscriber,
    type ReplayableStt,
    type ReplayOptions,
    type SttSource,
} from './sttGapRecovery';

/** How fast each kind of provider is fed (times real time). */
const SPEED: Record<string, number> = {
    deepgram: 2, soniox: 2, qwen: 2, openai: 2, google: 1.5, elevenlabs: 1.5, nvidia_nim: 1,
    groq: 8, azure: 8, ibmwatson: 8, 'local-whisper': 4,
};

/**
 * How long a private instance may stay quiet once the audio is in. A batch
 * provider answers only after its upload; a local model may still be loading.
 */
const IDLE_MS: Record<string, number> = { groq: 8_000, azure: 8_000, ibmwatson: 8_000, 'local-whisper': 30_000 };
const TIMEOUT_PAD_MS: Record<string, number> = { 'local-whisper': 120_000 };

/** Cloud providers that can stand in for another one, with the key that enables each. */
const CLOUD_KEYS: Array<[string, (cm: any) => string | undefined]> = [
    ['groq', (cm) => cm.getGroqSttApiKey?.()],
    ['openai', (cm) => cm.getOpenAiSttApiKey?.()],
    ['deepgram', (cm) => cm.getDeepgramApiKey?.()],
    ['soniox', (cm) => cm.getSonioxApiKey?.()],
    ['qwen', (cm) => cm.getQwenAsrApiKey?.()],
    ['elevenlabs', (cm) => cm.getElevenLabsApiKey?.()],
];

function speakerOf(source: SttSource): 'interviewer' | 'user' {
    return source === 'system' ? 'interviewer' : 'user';
}

/** A private instance of provider `id`, or null when it is not set up. */
function createInstance(id: string, source: SttSource, cm: any, sm: any): ReplayableStt | null {
    const speaker = speakerOf(source);
    let stt: any = null;
    switch (id) {
        case 'deepgram': {
            const key = cm.getDeepgramApiKey?.();
            if (key) { const { DeepgramStreamingSTT } = require('./DeepgramStreamingSTT'); stt = new DeepgramStreamingSTT(key, cm.getSttModel?.('deepgram')); }
            break;
        }
        case 'soniox': {
            const key = cm.getSonioxApiKey?.();
            if (key) { const { SonioxStreamingSTT } = require('./SonioxStreamingSTT'); stt = new SonioxStreamingSTT(key); }
            break;
        }
        case 'qwen': {
            const key = cm.getQwenAsrApiKey?.();
            if (key) { const { QwenRealtimeSTT } = require('./QwenRealtimeSTT'); stt = new QwenRealtimeSTT(key); }
            break;
        }
        case 'elevenlabs': {
            const key = cm.getElevenLabsApiKey?.();
            if (key) { const { ElevenLabsStreamingSTT } = require('./ElevenLabsStreamingSTT'); stt = new ElevenLabsStreamingSTT(key); }
            break;
        }
        case 'openai': {
            const key = cm.getOpenAiSttApiKey?.();
            if (key) { const { OpenAIStreamingSTT } = require('./OpenAIStreamingSTT'); stt = new OpenAIStreamingSTT(key, cm.getOpenAiSttBaseUrl?.(), cm.getSttModel?.('openai')); }
            break;
        }
        case 'nvidia_nim': {
            const key = cm.getNvidiaNimApiKey?.();
            if (key) { const { NvidiaNimStreamingSTT } = require('./NvidiaNimStreamingSTT'); stt = new NvidiaNimStreamingSTT(key, cm.getNvidiaNimSttModel?.()); }
            break;
        }
        case 'google': {
            const { GoogleSTT } = require('./GoogleSTT');
            stt = new GoogleSTT(`${speaker}-recovery`);
            break;
        }
        case 'groq':
        case 'azure':
        case 'ibmwatson': {
            const key = id === 'groq' ? cm.getGroqSttApiKey?.() : id === 'azure' ? cm.getAzureApiKey?.() : cm.getIbmWatsonApiKey?.();
            const region = id === 'azure' ? cm.getAzureRegion?.() : id === 'ibmwatson' ? cm.getIbmWatsonRegion?.() : undefined;
            const model = id === 'groq' ? cm.getGroqSttModel?.() : undefined;
            if (key) { const { RestSTT } = require('./RestSTT'); stt = new RestSTT(id, key, model, region, `${speaker}-recovery`); }
            break;
        }
        case 'local-whisper': {
            const modelId = localModelId(source, sm);
            if (modelId && localModelOnDisk(modelId)) {
                const { LocalWhisperSTT } = require('./LocalWhisperSTT');
                const lws = new LocalWhisperSTT(modelId);
                lws.setChannel?.(`${source}-recovery`);
                stt = lws;
            }
            break;
        }
    }
    if (!stt) return null;
    try { stt.setRecognitionLanguage?.(cm.getSttLanguage?.()); } catch { /* the provider's default language */ }
    return stt as ReplayableStt;
}

function localModelId(source: SttSource, sm: any): string | null {
    const global = sm.get?.('localWhisperModel');
    if (sm.get?.('localWhisperPerChannelEnabled')) {
        const own = source === 'system' ? sm.get?.('localWhisperModelSystem') : sm.get?.('localWhisperModelMic');
        if (own) return own;
    }
    return typeof global === 'string' && global ? global : null;
}

function localModelOnDisk(modelId: string): boolean {
    try {
        const mm = require('./whisper/modelManager');
        return typeof mm.isModelCached === 'function' && mm.isModelCached(modelId) === true;
    } catch {
        return false;
    }
}

export interface RecoveryContext {
    /** The provider actually running for this source (main's effectiveSttId). */
    effectiveProvider: string;
    /** Local-only mode switched on elsewhere (LLMHelper.isLocalOnly). */
    localOnly: boolean;
    replay?: Partial<ReplayOptions>;
}

/** The plan for the current settings (exported for the main-process wiring test). */
export function currentRecoveryPlan(source: SttSource, ctx: RecoveryContext): RecoveryPlanEntry[] {
    const { CredentialsManager } = require('../services/CredentialsManager');
    const { SettingsManager } = require('../services/SettingsManager');
    const cm = CredentialsManager.getInstance();
    const sm = SettingsManager.getInstance();
    const modelId = localModelId(source, sm);
    return planRecoveryTranscribers({
        primaryProvider: cm.getSttProvider(),
        effectiveProvider: ctx.effectiveProvider,
        localOnly: ctx.localOnly,
        configuredCloud: CLOUD_KEYS.filter(([, key]) => !!key(cm)).map(([id]) => id),
        localModelAvailable: !!modelId && localModelOnDisk(modelId),
    });
}

/**
 * Keep only the stand-ins that can transcribe the user's configured language,
 * so a non-English meeting is never handed to an English-only transcriber
 * (which would return wrong words rather than a gap). Defensive: any failure to
 * read settings or the catalogue returns the list unchanged, so this can only
 * ever narrow on solid information, never make failover worse than before.
 */
function languageCapableCandidates(source: SttSource, ids: string[]): string[] {
    try {
        const { CredentialsManager } = require('../services/CredentialsManager');
        const { SettingsManager } = require('../services/SettingsManager');
        const { candidatesForLanguage } = require('./sttLanguageSupport');
        const { isSttModelProvider, isEnglishOnlySttModel } = require('./sttModelCatalog');
        const cm = CredentialsManager.getInstance();
        const sm = SettingsManager.getInstance();
        return candidatesForLanguage(ids, cm.getSttLanguage?.(), {
            modelFor: (id: string) => (isSttModelProvider(id) ? cm.getSttModel?.(id) : undefined),
            isEnglishOnlyModel: (id: string, model: string | undefined) =>
                isSttModelProvider(id) && typeof model === 'string' ? isEnglishOnlySttModel(id, model) : false,
            localModelLanguageKeys: (id: string) => {
                if (id !== 'local-whisper') return null;
                const modelId = localModelId(source, sm);
                if (!modelId) return null;
                try {
                    const { getLocalModelLanguageSupport } = require('./whisper/modelLanguageSupport');
                    return new Set<string>(getLocalModelLanguageSupport(modelId).allowedLanguageKeys);
                } catch { return null; }
            },
        });
    } catch {
        return ids;
    }
}

/**
 * Live stand-ins for a channel whose provider is down (sttFailover.ts): the
 * recovery plan without the failing provider itself (so the same privacy rule
 * holds — local-only transcription never reaches a cloud provider), and
 * without any that cannot do the meeting's language.
 */
export function failoverCandidates(source: SttSource, ctx: RecoveryContext): string[] {
    const ids = currentRecoveryPlan(source, ctx)
        .filter((entry) => entry.kind !== 'same-provider' && entry.id !== ctx.effectiveProvider)
        .map((entry) => entry.id);
    return languageCapableCandidates(source, ids);
}

/** Transcribers for one recovery of `source`, in the order the plan allows. */
export function buildRecoveryTranscribers(source: SttSource, ctx: RecoveryContext): RecoveryTranscriber[] {
    const { CredentialsManager } = require('../services/CredentialsManager');
    const { SettingsManager } = require('../services/SettingsManager');
    const cm = CredentialsManager.getInstance();
    const sm = SettingsManager.getInstance();
    return currentRecoveryPlan(source, ctx).map((entry) =>
        createReplayTranscriber(
            entry.id,
            entry.kind,
            () => createInstance(entry.id, source, cm, sm),
            {
                speed: SPEED[entry.id] ?? 1,
                ...(IDLE_MS[entry.id] ? { idleMs: IDLE_MS[entry.id] } : {}),
                ...(TIMEOUT_PAD_MS[entry.id] ? { timeoutPadMs: TIMEOUT_PAD_MS[entry.id] } : {}),
                // A local model loads once per outage, not once per clip.
                reuseInstance: entry.kind === 'local',
                ...(ctx.replay ?? {}),
            },
        ),
    );
}

/**
 * A private instance of provider `id` for `source`, built from the saved
 * settings like the recovery ones, or null when it is not set up. Dictation
 * (services/dictation) streams into one, never wired to a meeting; a live
 * failover stand-in (sttFailover.ts) is one too, fed the meeting's channel
 * only while that channel's own provider is down.
 */
export function createPrivateSttInstance(id: string, source: SttSource): ReplayableStt | null {
    const { CredentialsManager } = require('../services/CredentialsManager');
    const { SettingsManager } = require('../services/SettingsManager');
    return createInstance(id, source, CredentialsManager.getInstance(), SettingsManager.getInstance());
}
