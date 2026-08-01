import type { DefenceConfig } from './config';

export interface AudioChunkMetadata {
  sessionId: string;
  sequence: number;
  mimeType: string;
  codec: string;
  sampleRate: number;
  channelCount: number;
  durationMs: number;
  finalChunk: boolean;
  clientTimestamp: string;
}

export type AudioChunkDecision = { action: 'accept'; bytes: Buffer; metadata: AudioChunkMetadata } | { action: 'duplicate'; expectedSequence: number };

const ALLOWED_MIME = new Map<string, string>([
  ['audio/webm', 'webm'], ['audio/webm;codecs=opus', 'webm'], ['audio/ogg', 'ogg'], ['audio/ogg;codecs=opus', 'ogg'],
  ['audio/mp4', 'm4a'], ['audio/mp4;codecs=mp4a.40.2', 'm4a'], ['audio/wav', 'wav'], ['audio/x-wav', 'wav'],
]);

export function audioExtension(mimeType: string): string | undefined { return ALLOWED_MIME.get(mimeType.toLowerCase().replace(/\s/g, '')); }
export function allowedAudioMimeTypes(): string[] { return [...ALLOWED_MIME.keys()]; }

export class AudioProtocolError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'AudioProtocolError'; }
}

export class AudioChunkTracker {
  private expectedSequence = 0; private confirmed = new Set<number>();
  get nextSequence(): number { return this.expectedSequence; }
  accept(data: unknown, config: Pick<DefenceConfig, 'maxAudioBytes' | 'maxAudioDurationMs'>, sessionId: string): AudioChunkDecision {
    if (!data || typeof data !== 'object') throw new AudioProtocolError('INVALID_AUDIO_METADATA', 'Audio metadata is missing.');
    const input: any = data; const sequence = Number(input.sequence);
    if (String(input.sessionId || '') !== sessionId) throw new AudioProtocolError('SESSION_MISMATCH', 'Audio session does not match the authenticated session.');
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new AudioProtocolError('INVALID_AUDIO_SEQUENCE', 'Audio sequence must be a non-negative integer.');
    if (this.confirmed.has(sequence) || sequence < this.expectedSequence) return { action: 'duplicate', expectedSequence: this.expectedSequence };
    if (sequence > this.expectedSequence) throw new AudioProtocolError('AUDIO_OUT_OF_ORDER', `Expected audio sequence ${this.expectedSequence}.`);
    const mimeType = String(input.mimeType || '').toLowerCase().replace(/\s/g, '');
    if (!audioExtension(mimeType)) throw new AudioProtocolError('UNSUPPORTED_AUDIO_FORMAT', 'The browser audio format is not supported.');
    const durationMs = Number(input.durationMs); if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > config.maxAudioDurationMs) throw new AudioProtocolError('INVALID_AUDIO_DURATION', 'Audio chunk duration is invalid or too long.');
    const sampleRate = Number(input.sampleRate); if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) throw new AudioProtocolError('INVALID_SAMPLE_RATE', 'Audio sample rate is invalid.');
    const channelCount = Number(input.channelCount); if (![1, 2].includes(channelCount)) throw new AudioProtocolError('INVALID_CHANNEL_COUNT', 'Only mono or stereo audio is supported.');
    const bytes = Buffer.from(String(input.data || ''), 'base64');
    if (bytes.length === 0) throw new AudioProtocolError('EMPTY_AUDIO', 'The audio chunk is empty.');
    if (bytes.length > config.maxAudioBytes) throw new AudioProtocolError('AUDIO_TOO_LARGE', 'The audio chunk exceeds the configured size limit.');
    const timestamp = new Date(String(input.clientTimestamp || '')); if (!Number.isFinite(timestamp.getTime())) throw new AudioProtocolError('INVALID_CLIENT_TIMESTAMP', 'Audio timestamp is invalid.');
    const metadata: AudioChunkMetadata = { sessionId, sequence, mimeType, codec: String(input.codec || ''), sampleRate, channelCount, durationMs, finalChunk: Boolean(input.finalChunk), clientTimestamp: timestamp.toISOString() };
    this.confirmed.add(sequence); this.expectedSequence++;
    return { action: 'accept', bytes, metadata };
  }
}
