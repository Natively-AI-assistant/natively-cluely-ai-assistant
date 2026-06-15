/**
 * Speech-to-Text Provider Constants
 * Configuration for STT providers (Google gRPC, REST, WebSocket)
 */

export type SttProviderId = 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'gigastt';

export interface SttProviderConfig {
    id: SttProviderId;
    name: string;
    description: string;
    endpoint: string;
    model: string;
    /** Available models for this provider (for user selection) */
    availableModels?: { id: string; label: string }[];
    /** Upload type: 'multipart' for FormData, 'binary' for raw body, 'websocket' for streaming */
    uploadType?: 'multipart' | 'binary' | 'websocket';
    authHeader: (apiKey: string) => Record<string, string>;
    /** Path to extract transcript text from the JSON response */
    responseContentPath: string;
    /** Extra form fields to include in the multipart upload */
    extraFormFields?: Record<string, string>;
}

export const STT_PROVIDERS: Record<SttProviderId, SttProviderConfig> = {
    google: {
        id: 'google',
        name: 'Google Cloud (Default)',
        description: 'Uses gRPC streaming via Google Cloud Service Account',
        endpoint: '', // Google uses gRPC, not REST
        model: '',
        authHeader: () => ({}),
        responseContentPath: '',
    },
    groq: {
        id: 'groq',
        name: 'Groq Whisper (Fast)',
        description: 'Ultra-fast transcription via Groq API',
        endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
        model: 'whisper-large-v3-turbo',
        uploadType: 'multipart',
        availableModels: [
            { id: 'whisper-large-v3-turbo', label: 'Whisper Large V3 Turbo (Fastest)' },
            { id: 'whisper-large-v3', label: 'Whisper Large V3 (Most Accurate)' },
        ],
        authHeader: (apiKey: string) => ({
            Authorization: `Bearer ${apiKey}`,
        }),
        responseContentPath: 'text',
        extraFormFields: {
            temperature: '0',
            response_format: 'json',
            language: 'en',
        },
    },
    openai: {
        id: 'openai',
        name: 'OpenAI Whisper',
        description: 'Transcription via OpenAI Whisper API',
        endpoint: 'https://api.openai.com/v1/audio/transcriptions',
        model: 'whisper-1',
        uploadType: 'multipart',
        authHeader: (apiKey: string) => ({
            Authorization: `Bearer ${apiKey}`,
        }),
        responseContentPath: 'text',
    },
    deepgram: {
        id: 'deepgram',
        name: 'Deepgram Nova-3',
        description: 'Real-time streaming transcription via Deepgram WebSocket',
        endpoint: 'wss://api.deepgram.com/v1/listen',
        model: 'nova-3',
        uploadType: 'websocket',
        authHeader: (apiKey: string) => ({
            Authorization: `Token ${apiKey}`,
        }),
        responseContentPath: 'channel.alternatives[0].transcript',
    },
    elevenlabs: {
        id: 'elevenlabs',
        name: 'ElevenLabs Scribe',
        description: 'Scribe v2 Realtime API',
        endpoint: 'https://api.elevenlabs.io/v1/speech-to-text',
        model: 'scribe_v2',
        uploadType: 'multipart',
        authHeader: (apiKey: string) => ({
            'xi-api-key': apiKey,
        }),
        responseContentPath: 'text',
    },
    azure: {
        id: 'azure',
        name: 'Azure Speech',
        description: 'Microsoft Azure Cognitive Services STT',
        endpoint: 'https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1',
        model: '',
        uploadType: 'binary',
        authHeader: (apiKey: string) => ({
            'Ocp-Apim-Subscription-Key': apiKey,
        }),
        responseContentPath: 'DisplayText',
    },
    ibmwatson: {
        id: 'ibmwatson',
        name: 'IBM Watson',
        description: 'IBM Watson Speech-to-Text cloud service',
        endpoint: 'https://api.{region}.speech-to-text.watson.cloud.ibm.com/v1/recognize',
        model: '',
        uploadType: 'binary',
        authHeader: (apiKey: string) => ({
            Authorization: `Basic ${btoa(`apikey:${apiKey}`)}`,
        }),
        responseContentPath: 'results[0].alternatives[0].transcript',
    },
    gigastt: {
        id: 'gigastt',
        name: 'GigaSTT (Local Russian)',
        description: 'Russian-first local streaming STT server via ws://127.0.0.1:9876/v1/ws',
        endpoint: 'ws://127.0.0.1:9876/v1/ws',
        model: 'gigaam-v3-e2e-rnnt',
        uploadType: 'websocket',
        authHeader: () => ({}),
        responseContentPath: 'text',
    },
};

export const STT_PROVIDER_OPTIONS = Object.values(STT_PROVIDERS);

export const DEFAULT_STT_PROVIDER: SttProviderId = 'google';
