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
        const lang = languageKey ? RECOGNITION_LANGUAGES[languageKey]?.iso639 : undefined;
        return {
            endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
            model: 'whisper-large-v3-turbo',
            authHeader: { Authorization: `Bearer ${apiKey}` },
            uploadType: 'multipart',
            extraFormFields: {
                temperature: '0',
                response_format: 'json',
                ...(lang ? { language: lang } : {})
            },
            extractTranscript: (data: any) => {
                if (typeof data === 'string') return data;
                return data?.text ?? '';
            },
        };
    },
    openai: (apiKey, region, languageKey) => {
        const lang = languageKey ? RECOGNITION_LANGUAGES[languageKey]?.iso639 : undefined;
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
        const lang = languageKey ? RECOGNITION_LANGUAGES[languageKey]?.iso639 : undefined;
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
        const lang = languageKey ? RECOGNITION_LANGUAGES[languageKey]?.bcp47 : undefined;
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
        const lang = languageKey ? RECOGNITION_LANGUAGES[languageKey]?.bcp47 : undefined;
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

export class RestSTT extends EventEmitter {
    private provider: RestSttProvider;
    private apiKey: string;
    private region?: string;
    private config: RestSttProviderConfig;

    private chunks: Buffer[] = [];
    private totalBufferedBytes = 0;
    private safetyNetTimer: NodeJS.Timeout | null = null;
    private isActive = false;
    private isUploading = false;
    private flushPending = false;  // Bug #2 fix: queue flush when upload in progress

    // Audio config (must match SystemAudioCapture output)
    private sampleRate = 16000;
    private numChannels = 1;
    private bitsPerSample = 16;

    constructor(provider: RestSttProvider, apiKey: string, modelOverride?: string, region?: string) {
        super();
        this.provider = provider;
        this.apiKey = apiKey;
        this.region = region;
        this.config = PROVIDER_CONFIGS[provider](apiKey, region);
        if (modelOverride) {
            this.config.model = modelOverride;
        }
        console.log(`[RestSTT] Initialized for provider: ${provider}, model: ${this.config.model || '(default)'}`);
    }

    /**
     * Update API key (e.g., when user saves a new key)
     */
    public setApiKey(apiKey: string): void {
        this.apiKey = apiKey;
        this.config = PROVIDER_CONFIGS[this.provider](apiKey, this.region);
        console.log(`[RestSTT] API key updated for ${this.provider}`);
    }

    /**
     * Update sample rate to match the audio source
     */
    public setSampleRate(rate: number): void {
        if (this.sampleRate === rate) return;
        console.log(`[RestSTT] Updating sample rate to ${rate}Hz`);
        this.sampleRate = rate;
    }

    /**
     * Update channel count
     */
    public setAudioChannelCount(count: number): void {
        if (this.numChannels === count) return;
        console.log(`[RestSTT] Updating channel count to ${count}`);
        this.numChannels = count;
    }

    /**
     * Update recognition language
     */
    public setRecognitionLanguage(key: string): void {
        console.log(`[RestSTT] Updating recognition language to: ${key}`);
        this.config = PROVIDER_CONFIGS[this.provider](this.apiKey, this.region, key);
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

        // Safety-net timer: flush even during continuous speech to prevent
        // unbounded buffer growth and Whisper API file-size/timeout errors.
        // Primary flush is driven by Rust speech_ended events.
        this.safetyNetTimer = setInterval(() => {
            this.flushAndUpload();
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
    }

    /**
     * Called when the native SilenceSuppressor detects speech has ended.
     * The internal Rust engine already applies a 150-200ms VAD hangover to avoid
     * word-breaks, so we flush immediately without adding redundant TS debouncing.
     */
    public notifySpeechEnded(): void {
        if (!this.isActive) return;

        console.log(`[RestSTT] Speech ended detected by native VAD — flushing buffer immediately`);
        this.flushAndUpload();
    }

    /**
     * Concatenate buffered chunks, add WAV header, and upload to REST API
     */
    private async flushAndUpload(): Promise<void> {
        // Skip if no data
        if (this.chunks.length === 0 || this.totalBufferedBytes < MIN_BUFFER_BYTES) return;

        // Bug #2 fix: if currently uploading, queue a flush for when it completes
        if (this.isUploading) {
            this.flushPending = true;
            return;
        }

        // Reset safety-net timer to prevent double-flush
        if (this.safetyNetTimer) {
            clearInterval(this.safetyNetTimer);
            this.safetyNetTimer = setInterval(() => {
                this.flushAndUpload();
            }, SAFETY_NET_INTERVAL_MS);
        }

        // Grab current buffer and reset
        const currentChunks = this.chunks;
        this.chunks = [];
        const currentBytes = this.totalBufferedBytes;
        this.totalBufferedBytes = 0;

        // Concatenate all chunks
        const rawPcm = Buffer.concat(currentChunks);

        // Check for silence (skip upload if audio is too quiet)
        if (this.isSilent(rawPcm)) {
            if (Math.random() < 0.1) {
                console.log(`[RestSTT] Skipping silent buffer (${rawPcm.length} bytes)`);
            }
            return;
        }

        // Add WAV header
        const wavBuffer = this.addWavHeader(rawPcm, this.sampleRate);

        this.isUploading = true;

        try {
            const transcript = await this.uploadAudio(wavBuffer);

            if (transcript && transcript.trim().length > 0) {
                console.log(`[RestSTT] Transcript: "${transcript.substring(0, 60)}..."`);
                this.emit('transcript', {
                    text: transcript.trim(),
                    isFinal: true,
                    confidence: 1.0,
                });
            }
        } catch (err) {
            console.error(`[RestSTT] Upload error:`, err);
            this.emit('error', err instanceof Error ? err : new Error(String(err)));
        } finally {
            this.isUploading = false;

            // Bug #2 fix: if a flush was requested while we were uploading, process it now
            if (this.flushPending) {
                this.flushPending = false;
                this.flushAndUpload();
            }
        }
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
     * Add a WAV RIFF header to raw PCM data
     * Critical: Most REST STT APIs require a valid WAV file, NOT raw PCM
     */
    private addWavHeader(samples: Buffer, sampleRate: number = 16000): Buffer {
        const buffer = Buffer.alloc(44 + samples.length);
        // RIFF chunk descriptor
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(36 + samples.length, 4);
        buffer.write('WAVE', 8);
        // fmt sub-chunk
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
        buffer.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
        buffer.writeUInt16LE(this.numChannels, 22);  // NumChannels
        buffer.writeUInt32LE(sampleRate, 24); // SampleRate
        buffer.writeUInt32LE(sampleRate * this.numChannels * (this.bitsPerSample / 8), 28); // ByteRate
        buffer.writeUInt16LE(this.numChannels * (this.bitsPerSample / 8), 32); // BlockAlign
        buffer.writeUInt16LE(this.bitsPerSample, 34); // BitsPerSample
        // data sub-chunk
        buffer.write('data', 36);
        buffer.writeUInt32LE(samples.length, 40);
        // Copy raw PCM data
        samples.copy(buffer, 44);

        return buffer;
    }
}
