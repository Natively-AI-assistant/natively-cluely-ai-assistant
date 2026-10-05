/**
 * RestSTT - REST-based Speech-to-Text for Groq, OpenAI Whisper, ElevenLabs, Azure, and IBM Watson
 *
 * Implements the same EventEmitter interface as GoogleSTT:
 *   Events: 'transcript' ({ text, isFinal, confidence }), 'error' (Error)
 *   Methods: start(), stop(), write(chunk: Buffer)
 *
 * Buffers raw PCM chunks, prepends a WAV header, and uploads via REST every ~3 seconds.
 * Supports two upload modes:
 *   - Multipart FormData (Groq, OpenAI, ElevenLabs)
 *   - Raw binary body (Azure, IBM Watson)
 */

import { EventEmitter } from 'events';
import axios from 'axios';
import FormData from 'form-data';
import { RECOGNITION_LANGUAGES } from '../config/languages';
import { isValidSttRegion } from '../utils/curlUtils';

export type RestSttProvider = 'groq' | 'openai' | 'elevenlabs' | 'azure' | 'ibmwatson';

interface RestSttProviderConfig {
    endpoint: string;
    model: string;
    authHeader: Record<string, string>;
    uploadType: 'multipart' | 'binary';
    extraFormFields?: Record<string, string>;
    /** Extract transcript text from the API response */
    extractTranscript: (data: any) => string;
}

type ProviderConfigFactory = (apiKey: string, region?: string, languageKey?: string) => RestSttProviderConfig;

const PROVIDER_CONFIGS: Record<RestSttProvider, ProviderConfigFactory> = {
    groq: (apiKey, region, languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.iso639 : undefined;
        return {
            endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
            model: 'whisper-large-v3-turbo',
            authHeader: { Authorization: `Bearer ${apiKey}` },
            uploadType: 'multipart',
            extraFormFields: {
                temperature: '0',
                // verbose_json carries each segment's no_speech_prob and
                // avg_logprob, which whisperTextWithoutHallucinations reads.
                response_format: 'verbose_json',
                ...(lang ? { language: lang } : {})
            },
            extractTranscript: whisperTextWithoutHallucinations,
        };
    },
    openai: (apiKey, region, languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.iso639 : undefined;
        return {
            endpoint: 'https://api.openai.com/v1/audio/transcriptions',
            model: 'whisper-1',
            authHeader: { Authorization: `Bearer ${apiKey}` },
            uploadType: 'multipart',
            extraFormFields: {
                ...(lang ? { language: lang } : {})
            },
            extractTranscript: (data: any) => {
                if (typeof data === 'string') return data;
                return data?.text ?? '';
            },
        };
    },
    elevenlabs: (apiKey, region, languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.iso639 : undefined;
        return {
            endpoint: 'https://api.elevenlabs.io/v1/speech-to-text',
            model: 'scribe_v2',
            authHeader: { 'xi-api-key': apiKey },
            uploadType: 'multipart',
            extraFormFields: {
                ...(lang ? { language_code: lang } : {})
            },
            extractTranscript: (data: any) => {
                if (typeof data === 'string') return data;
                return data?.text ?? '';
            },
        };
    },
    azure: (apiKey, region = 'eastus', languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.bcp47 : undefined;
        const finalLang = lang || 'en-US';
        return {
            endpoint: `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${finalLang}`,
            model: '',
            authHeader: { 'Ocp-Apim-Subscription-Key': apiKey },
            uploadType: 'binary',
            extractTranscript: (data: any) => {
                return data?.DisplayText ?? '';
            },
        };
    },
    ibmwatson: (apiKey, region = 'us-south', languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.bcp47 : undefined;
        const finalLang = lang || 'en-US';
        return {
            endpoint: `https://api.${region}.speech-to-text.watson.cloud.ibm.com/v1/recognize?language=${finalLang}`,
            model: '',
            authHeader: { Authorization: `Basic ${Buffer.from(`apikey:${apiKey}`).toString('base64')}` },
            uploadType: 'binary',
            extractTranscript: (data: any) => {
                try {
                    return data?.results?.[0]?.alternatives?.[0]?.transcript ?? '';
                } catch {
                    return '';
                }
            },
        };
    },
};

// Minimum buffer size before sending (avoid sending tiny fragments)
// 16kHz * 2 bytes/sample * 1 channel * 0.125 seconds = 4000 bytes
// Lowered from 16000 to allow short command utterances ("Yes", "Stop") to flush instantly.
const MIN_BUFFER_BYTES = 4000;

// Safety-net upload interval (ms). Primary flush is triggered by speech_ended events.
// This fires as a backstop if someone talks continuously for >10s without any pause,
// preventing unbounded buffer growth and Whisper API timeouts.
const SAFETY_NET_INTERVAL_MS = 10000;

// Silence threshold - if RMS is below this, skip the upload
const SILENCE_RMS_THRESHOLD = 50;

// Chunking (2026-09-26). A REST speech API returns text only for a finished
// upload, so the first word of a chunk appears only when the whole chunk does.
// A chunk used to end only at the native speech end (a 500-600 ms pause) or
// after 10 s. Now, once CHUNK_MIN_MS is buffered, a short pause ends it too,
// and no chunk grows past CHUNK_MAX_MS: at the cap it is cut at the quietest
// frame of the last CHUNK_SPLIT_SEARCH_MS, so no word is split in two.
const FRAME_MS = 20;
const CHUNK_MIN_MS = 3_000;
const CHUNK_PAUSE_MS = 200;
const CHUNK_MAX_MS = 6_000;
const CHUNK_SPLIT_SEARCH_MS = 1_500;
/** A frame is quiet below this share of the chunk's 90th-percentile level
 *  (-20 dB) — a percentile, so one loud click cannot turn speech "quiet". */
const CHUNK_QUIET_RATIO = 0.1;

// Rate limits (429). Groq's free tier allows 20 requests a minute per
// organisation — both channels share it — and bills every request as at
// least 10 s of audio. A 429 used to drop the audio it carried. Now the audio
// waits out retry-after and goes up with whatever arrived meanwhile.
/** Wait when a 429 has no usable retry-after. */
const RATE_LIMIT_DEFAULT_WAIT_MS = 5_000;
/** Audio kept while waiting — the newest this many ms. 60 s of 16 kHz mono is
 *  ~1.9 MB, far inside Groq's 25 MB upload limit. */
const RATE_LIMIT_MAX_BUFFER_MS = 60_000;

/**
 * Whisper invents text for audio with no speech in it, most often "Thank you."
 * (live 2026-09-26: four "[ME]: Thank you." lines while the user was silent,
 * each fed to the AI as something they had said). A segment is dropped when
 * Whisper itself rates it as probably not speech (no_speech_prob > 0.6, the
 * threshold openai/whisper's own decoder uses) AND it is either low-confidence
 * (avg_logprob < -1.0, the decoder's other threshold) or one of the stock
 * phrases Whisper produces for silence. A clearly spoken "thank you" has a low
 * no_speech_prob and stays. No segments (plain json, another server): the
 * text passes through unchanged.
 */
const NO_SPEECH_PROB_THRESHOLD = 0.6;
const LOW_CONFIDENCE_LOGPROB = -1.0;
const SILENCE_HALLUCINATIONS = new Set([
    'thank you', 'thank you very much', 'thanks', 'thanks for watching', 'thank you for watching',
    'thank you so much for watching', 'you', 'bye', 'bye bye', '',
]);

export function whisperTextWithoutHallucinations(data: any): string {
    if (typeof data === 'string') return data;
    const segments = Array.isArray(data?.segments) ? data.segments : null;
    if (!segments || segments.length === 0) return data?.text ?? '';
    const kept = segments.filter((seg: any) => {
        const noSpeech = Number(seg?.no_speech_prob);
        if (!(noSpeech > NO_SPEECH_PROB_THRESHOLD)) return true;
        const logprob = Number(seg?.avg_logprob);
        const phrase = String(seg?.text ?? '').toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();
        return !(logprob < LOW_CONFIDENCE_LOGPROB || SILENCE_HALLUCINATIONS.has(phrase));
    });
    if (kept.length === segments.length) return data?.text ?? '';
    return kept.map((seg: any) => String(seg?.text ?? '')).join('').trim();
}

/** retry-after from a 429, in ms: delta-seconds or an HTTP date. */
export function retryAfterMs(headerValue: unknown, now = Date.now()): number | null {
    const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    const secs = Number(raw);
    if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000);
    const at = Date.parse(String(raw));
    return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

export class RestSTT extends EventEmitter {
    private provider: RestSttProvider;
    private apiKey: string;
    private region?: string;
    private config: RestSttProviderConfig;
    /** The model picked in Settings (Groq's groqSttModel). Kept on the instance
     *  because the config is rebuilt from PROVIDER_CONFIGS on every language
     *  change and key update — and main.ts sets the language right after
     *  construction — so an override applied only in the constructor was lost
     *  before the first upload: every Groq session ran whisper-large-v3-turbo. */
    private modelOverride?: string;
    private languageKey?: string;
    /** Log prefix naming the channel, so a log shows which side flushed and why. */
    private readonly logTag: string;

    private chunks: Buffer[] = [];
    private totalBufferedBytes = 0;
    private safetyNetTimer: NodeJS.Timeout | null = null;
    private isActive = false;
    private isUploading = false;
    private flushPending = false;  // Bug #2 fix: queue flush when upload in progress
    /** Per-20 ms-frame RMS of the buffered audio, in order (chunk ends). */
    private frameRms: number[] = [];
    /** Bytes after the last whole frame, carried into the next write. */
    private frameCarry: Buffer = Buffer.alloc(0);
    /** After a 429: keep buffering, upload nothing, until this time. */
    private rateLimitedUntil = 0;
    private rateLimitRetryTimer: NodeJS.Timeout | null = null;

    // Audio config (must match SystemAudioCapture output)
    private sampleRate = 16000;
    private numChannels = 1;
    private bitsPerSample = 16;

    constructor(provider: RestSttProvider, apiKey: string, modelOverride?: string, region?: string, channel?: string) {
        super();
        this.logTag = channel ? `[RestSTT/${channel}]` : '[RestSTT]';
        this.provider = provider;
        this.apiKey = apiKey;
        // SSRF guard (defense in depth): the region is interpolated into the
        // Azure/IBM endpoint hostname. If a malformed region ever reaches this
        // far (e.g. persisted before the IPC guard existed), drop it so the
        // PROVIDER_CONFIGS default region is used instead of a poisoned host.
        this.region = isValidSttRegion(region) ? region : undefined;
        this.modelOverride = modelOverride || undefined;
        this.config = this.buildConfig();
        console.log(`[RestSTT] Initialized for provider: ${provider}, model: ${this.config.model || '(default)'}`);
    }

    /** The provider's config for a language, with the picked model on top. */
    private buildConfig(languageKey?: string): RestSttProviderConfig {
        const config = PROVIDER_CONFIGS[this.provider](this.apiKey, this.region, languageKey);
        if (this.modelOverride) config.model = this.modelOverride;
        return config;
    }

    /**
     * Update API key (e.g., when user saves a new key)
     */
    public setApiKey(apiKey: string): void {
        this.apiKey = apiKey;
        this.config = this.buildConfig(this.languageKey);
        console.log(`[RestSTT] API key updated for ${this.provider}`);
    }

    /**
     * Update sample rate to match the audio source
     */
    public setSampleRate(rate: number): void {
        if (this.sampleRate === rate) return;
        console.log(`[RestSTT] Updating sample rate to ${rate}Hz`);
        this.sampleRate = rate;
        this.rebuildFrames();
    }

    /**
     * Update channel count
     */
    public setAudioChannelCount(count: number): void {
        if (this.numChannels === count) return;
        console.log(`[RestSTT] Updating channel count to ${count}`);
        this.numChannels = count;
        this.rebuildFrames();
    }

    /**
     * Update recognition language
     */
    public setRecognitionLanguage(key: string): void {
        console.log(`[RestSTT] Updating recognition language to: ${key}`);
        this.languageKey = key;
        this.config = this.buildConfig(key);
    }

    /**
     * No-op for RestSTT (no Google credentials needed)
     */
    public setCredentials(_keyFilePath: string): void {
        console.log(`[RestSTT] setCredentials called (no-op for REST provider)`);
    }

    /**
     * Start the upload timer
     */
    public start(): void {
        if (this.isActive) return;

        console.log(`[RestSTT] Starting (${this.provider})...`);
        this.isActive = true;
        this.chunks = [];
        this.totalBufferedBytes = 0;
        this.resetFrames();

        // Safety-net timer: flush even during continuous speech to prevent
        // unbounded buffer growth and Whisper API file-size/timeout errors.
        // Primary flush is driven by Rust speech_ended events.
        this.safetyNetTimer = setInterval(() => {
            this.flushAndUpload('10 s timer');
        }, SAFETY_NET_INTERVAL_MS);
    }

    /**
     * Stop the upload timer and flush remaining buffer
     */
    public stop(): void {
        if (!this.isActive) return;

        console.log(`[RestSTT] Stopping (${this.provider})...`);
        this.isActive = false;

        if (this.safetyNetTimer) {
            clearInterval(this.safetyNetTimer);
            this.safetyNetTimer = null;
        }
        if (this.rateLimitRetryTimer) {
            clearTimeout(this.rateLimitRetryTimer);
            this.rateLimitRetryTimer = null;
        }
        this.rateLimitedUntil = 0;

        // Flush remaining audio
        this.flushAndUpload();
    }

    /**
     * Write raw PCM audio data to the internal buffer
     */
    public write(audioData: Buffer): void {
        if (!this.isActive) return;
        this.chunks.push(audioData);
        this.totalBufferedBytes += audioData.length;
        this.trackFrames(audioData);
        this.maybeEndChunk();
    }

    private frameBytes(): number {
        return Math.max(1, Math.round(this.sampleRate * FRAME_MS / 1000)) * this.numChannels * (this.bitsPerSample / 8);
    }

    private trackFrames(chunk: Buffer): void {
        const frameBytes = this.frameBytes();
        const data = this.frameCarry.length ? Buffer.concat([this.frameCarry, chunk]) : chunk;
        let o = 0;
        for (; o + frameBytes <= data.length; o += frameBytes) {
            let sum = 0;
            for (let i = o; i + 1 < o + frameBytes; i += 2) {
                const v = data.readInt16LE(i);
                sum += v * v;
            }
            this.frameRms.push(Math.sqrt(sum / (frameBytes / 2)));
        }
        this.frameCarry = Buffer.from(data.subarray(o));
    }

    private resetFrames(): void {
        this.frameRms = [];
        this.frameCarry = Buffer.alloc(0);
    }

    /** Frames for the whole buffer, from its first byte (format change, re-buffered audio). */
    private rebuildFrames(): void {
        this.resetFrames();
        for (const chunk of this.chunks) this.trackFrames(chunk);
    }

    /** After every write: end the chunk at a short pause, or cut it at the cap. */
    private maybeEndChunk(): void {
        const frames = this.frameRms.length;
        if (frames * FRAME_MS < CHUNK_MIN_MS) return;
        const sorted = [...this.frameRms].sort((a, b) => a - b);
        const level = sorted[Math.floor(sorted.length * 0.9)];
        const quiet = Math.max(SILENCE_RMS_THRESHOLD, level * CHUNK_QUIET_RATIO);
        let run = 0;
        for (let i = frames - 1; i >= 0 && this.frameRms[i] < quiet; i--) run++;
        if (run * FRAME_MS >= CHUNK_PAUSE_MS) {
            this.flushAndUpload('short pause');
            return;
        }
        if (frames * FRAME_MS >= CHUNK_MAX_MS) {
            const from = Math.max(0, frames - CHUNK_SPLIT_SEARCH_MS / FRAME_MS);
            let cut = from;
            for (let i = from; i < frames; i++) if (this.frameRms[i] < this.frameRms[cut]) cut = i;
            this.flushAndUpload(`${CHUNK_MAX_MS / 1000} s cap`, cut + 1);
        }
    }

    /**
     * Called when the native SilenceSuppressor detects speech has ended.
     * The native suppressor already holds a hangover before it reports the end
     * (VAD_HANGOVER / speech_hangover: 600 ms system audio, 500 ms microphone —
     * not the 150-200 ms this comment used to claim), so we flush immediately
     * without adding redundant TS debouncing.
     */
    public notifySpeechEnded(): void {
        if (!this.isActive) return;

        console.log(`${this.logTag} Speech ended detected by native VAD — flushing buffer immediately`);
        this.flushAndUpload('speech end');
    }

    public finalize(): void {
        if (!this.isActive) return;
        console.log(`${this.logTag} Finalize — flushing buffer immediately`);
        this.flushAndUpload('finalize');
    }

    /**
     * Concatenate buffered chunks, add WAV header, and upload to REST API
     */
    /** `trigger` is for the log only: which path sent this audio. With
     *  `upToFrame`, only the audio before that frame goes; the rest stays. */
    private async flushAndUpload(trigger = 'flush', upToFrame?: number): Promise<void> {
        // Gate every flush on isActive. Without this, the
        // finally-re-entrancy at line ~334 (`if (this.flushPending) this.flushAndUpload()`)
        // can fire AFTER stop() has set isActive=false, and the body below
        // would happily upload trailing audio to the REST provider for the
        // rest of the process lifetime. The re-arm block below would also
        // resurrect a fresh setInterval if safetyNetTimer happened to be
        // non-null in some race window. Bailing here closes both holes.
        if (!this.isActive) return;

        // Skip if no data
        if (this.chunks.length === 0 || this.totalBufferedBytes < MIN_BUFFER_BYTES) return;

        // Rate limited: keep buffering; the retry timer flushes when the wait is over.
        if (Date.now() < this.rateLimitedUntil) return;

        // Bug #2 fix: if currently uploading, queue a flush for when it completes
        if (this.isUploading) {
            this.flushPending = true;
            return;
        }

        // Reset safety-net timer to prevent double-flush. The outer
        // `if (!this.isActive) return` above guarantees we never re-arm
        // after stop() — but keep the timer guard here too as belt-and-braces
        // in case a future caller invokes flushAndUpload from a path that
        // skips the isActive check.
        if (this.safetyNetTimer && this.isActive) {
            clearInterval(this.safetyNetTimer);
            this.safetyNetTimer = setInterval(() => {
                this.flushAndUpload('10 s timer');
            }, SAFETY_NET_INTERVAL_MS);
        }

        // Grab current buffer and reset — or, for a cut, the audio before the cut.
        let currentChunks: Buffer[];
        let currentBytes: number;
        if (upToFrame !== undefined) {
            const all = Buffer.concat(this.chunks);
            currentBytes = Math.min(all.length, upToFrame * this.frameBytes());
            currentChunks = [all.subarray(0, currentBytes)];
            const rest = all.subarray(currentBytes);
            this.chunks = rest.length ? [rest] : [];
            this.totalBufferedBytes = rest.length;
            this.frameRms = this.frameRms.slice(upToFrame);
        } else {
            currentChunks = this.chunks;
            this.chunks = [];
            currentBytes = this.totalBufferedBytes;
            this.totalBufferedBytes = 0;
            this.resetFrames();
        }

        // Concatenate all chunks
        const rawPcm = Buffer.concat(currentChunks);

        // Check for silence (skip upload if audio is too quiet)
        if (this.isSilent(rawPcm)) {
            if (Math.random() < 0.1) {
                console.log(`${this.logTag} Skipping silent buffer (${rawPcm.length} bytes)`);
            }
            return;
        }

        // Resample to 16kHz mono before upload. At 48kHz stereo this produces a
        // 6x smaller WAV file, reducing upload latency and keeping file sizes well
        // under the Groq/OpenAI 25MB limit even for 10-second safety-net flushes.
        const TARGET_RATE = 16_000;
        const pcm16k = this.sampleRate === TARGET_RATE && this.numChannels === 1
            ? rawPcm
            : this.resampleTo16kHz(rawPcm);

        // Add WAV header — stamp with actual rate/channel after resampling (always 16kHz mono)
        const wavBuffer = this.addWavHeader(pcm16k, TARGET_RATE);

        this.isUploading = true;

        try {
            const transcript = await this.uploadAudio(wavBuffer);

            if (transcript && transcript.trim().length > 0) {
                const audioMs = Math.round(rawPcm.length / (this.sampleRate * this.numChannels * (this.bitsPerSample / 8)) * 1000);
                console.log(`${this.logTag} Transcript received`, { length: transcript.trim().length, audioMs, trigger });
                this.emit('transcript', {
                    text: transcript.trim(),
                    isFinal: true,
                    confidence: 1.0,
                });
            }
        } catch (err) {
            console.error(`[RestSTT] Upload error:`, err);
            const response = (err as { response?: { status?: number; headers?: Record<string, unknown> } })?.response;
            if (response?.status === 429 && this.isActive) {
                this.holdForRateLimit(currentChunks, currentBytes, retryAfterMs(response.headers?.['retry-after']));
            }
            this.emit('error', err instanceof Error ? err : new Error(String(err)));
        } finally {
            this.isUploading = false;

            // Bug #2 fix: if a flush was requested while we were uploading, process it now
            if (this.flushPending) {
                this.flushPending = false;
                this.flushAndUpload('queued');
            }
        }
    }

    /**
     * A 429: put the refused audio back in front of what arrived meanwhile
     * (newest RATE_LIMIT_MAX_BUFFER_MS kept), and upload nothing until
     * retry-after has passed — then flush it all as one request.
     */
    private holdForRateLimit(refused: Buffer[], refusedBytes: number, waitMs: number | null): void {
        this.chunks = refused.concat(this.chunks);
        this.totalBufferedBytes += refusedBytes;
        const maxBytes = Math.round(this.sampleRate * this.numChannels * (this.bitsPerSample / 8) * RATE_LIMIT_MAX_BUFFER_MS / 1000);
        while (this.totalBufferedBytes > maxBytes && this.chunks.length > 1) {
            this.totalBufferedBytes -= this.chunks.shift()!.length;
        }
        this.rebuildFrames();

        const wait = waitMs ?? RATE_LIMIT_DEFAULT_WAIT_MS;
        this.rateLimitedUntil = Date.now() + wait;
        console.warn(`[RestSTT] ${this.provider} rate limited — holding ${this.totalBufferedBytes} bytes, retrying in ${wait} ms`);
        if (this.rateLimitRetryTimer) clearTimeout(this.rateLimitRetryTimer);
        this.rateLimitRetryTimer = setTimeout(() => {
            this.rateLimitRetryTimer = null;
            this.rateLimitedUntil = 0;
            this.flushAndUpload('rate-limit retry');
        }, wait);
    }

    /**
     * Upload WAV audio to the REST endpoint
     */
    private async uploadAudio(wavBuffer: Buffer): Promise<string> {
        if (this.config.uploadType === 'binary') {
            return this.uploadBinary(wavBuffer);
        }
        return this.uploadMultipart(wavBuffer);
    }

    /**
     * Upload via multipart FormData (Groq, OpenAI, ElevenLabs)
     */
    private async uploadMultipart(wavBuffer: Buffer): Promise<string> {
        const form = new FormData();

        form.append('file', wavBuffer, {
            filename: 'audio.wav',
            contentType: 'audio/wav',
        });

        // ElevenLabs uses 'model_id' instead of 'model'
        if (this.provider === 'elevenlabs') {
            form.append('model_id', this.config.model);
        } else {
            form.append('model', this.config.model);
        }

        if (this.config.extraFormFields) {
            for (const [key, value] of Object.entries(this.config.extraFormFields)) {
                form.append(key, value);
            }
        }

        const response = await axios.post(this.config.endpoint, form, {
            headers: {
                ...this.config.authHeader,
                ...form.getHeaders(),
            },
            timeout: 30000,
        });

        return this.config.extractTranscript(response.data);
    }

    /**
     * Upload via raw binary body (Azure, IBM Watson)
     */
    private async uploadBinary(wavBuffer: Buffer): Promise<string> {
        const response = await axios.post(this.config.endpoint, wavBuffer, {
            headers: {
                ...this.config.authHeader,
                'Content-Type': 'audio/wav',
            },
            timeout: 30000,
        });

        return this.config.extractTranscript(response.data);
    }

    /**
     * Resample Int16LE PCM from inputRate/numChannels → 16kHz mono.
     * Uses integer decimation (same approach as Rust DSP and OpenAIStreamingSTT).
     * Returns a new Buffer containing the resampled 16-bit mono PCM.
     */
    private resampleTo16kHz(raw: Buffer): Buffer {
        const TARGET_RATE = 16_000;

        // Build Int16Array from the raw buffer using safe byte-by-byte reads
        // to avoid alignment issues with unaligned ArrayBuffer slices.
        const numSamples = Math.floor(raw.length / 2);
        const inputS16 = new Int16Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
            inputS16[i] = raw.readInt16LE(i * 2);
        }

        // Already at target rate and mono — return as-is
        if (this.sampleRate === TARGET_RATE && this.numChannels === 1) {
            return Buffer.from(inputS16.buffer);
        }

        // Mix down multi-channel to mono
        let monoS16: Int16Array;
        if (this.numChannels > 1) {
            const monoLen = Math.floor(inputS16.length / this.numChannels);
            monoS16 = new Int16Array(monoLen);
            for (let i = 0; i < monoLen; i++) {
                let sum = 0;
                for (let c = 0; c < this.numChannels; c++) {
                    sum += inputS16[i * this.numChannels + c];
                }
                monoS16[i] = Math.round(sum / this.numChannels);
            }
        } else {
            monoS16 = inputS16;
        }

        // Decimate to target rate
        if (this.sampleRate === TARGET_RATE) {
            return Buffer.from(monoS16.buffer);
        }

        const factor = this.sampleRate / TARGET_RATE;
        const outLen = Math.floor(monoS16.length / factor);
        const outS16 = new Int16Array(outLen);
        for (let i = 0; i < outLen; i++) {
            outS16[i] = monoS16[Math.floor(i * factor)];
        }
        return Buffer.from(outS16.buffer);
    }

    /**
     * Check if audio buffer is essentially silence
     */
    private isSilent(pcmBuffer: Buffer): boolean {
        let sum = 0;
        const step = 20; // Sample every 20th sample for speed
        let count = 0;

        for (let i = 0; i < pcmBuffer.length - 1; i += 2 * step) {
            const sample = pcmBuffer.readInt16LE(i);
            sum += sample * sample;
            count++;
        }

        if (count === 0) return true;
        const rms = Math.sqrt(sum / count);
        return rms < SILENCE_RMS_THRESHOLD;
    }

    /**
     * Add a WAV RIFF header to raw PCM data.
     * channels defaults to 1 (mono) because callers always resample to mono first.
     * Critical: Most REST STT APIs require a valid WAV file, NOT raw PCM.
     */
    private addWavHeader(samples: Buffer, sampleRate: number = 16_000, channels: number = 1): Buffer {
        const buffer = Buffer.alloc(44 + samples.length);
        // RIFF chunk descriptor
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(36 + samples.length, 4);
        buffer.write('WAVE', 8);
        // fmt sub-chunk
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
        buffer.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
        buffer.writeUInt16LE(channels, 22);
        buffer.writeUInt32LE(sampleRate, 24);
        buffer.writeUInt32LE(sampleRate * channels * (this.bitsPerSample / 8), 28); // ByteRate
        buffer.writeUInt16LE(channels * (this.bitsPerSample / 8), 32);              // BlockAlign
        buffer.writeUInt16LE(this.bitsPerSample, 34);
        // data sub-chunk
        buffer.write('data', 36);
        buffer.writeUInt32LE(samples.length, 40);
        // Copy raw PCM data
        samples.copy(buffer, 44);

        return buffer;
    }
}
