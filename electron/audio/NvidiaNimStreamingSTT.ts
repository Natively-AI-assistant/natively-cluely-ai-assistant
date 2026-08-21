import { EventEmitter } from 'events';
import path from 'path';
import { RECOGNITION_LANGUAGES } from '../config/languages';

export const NVIDIA_NIM_STT_MODELS = [
  { id: 'nemotron-asr-streaming', label: 'Nemotron ASR Streaming (Fast English)' },
  { id: 'nemotron-3.5-asr-streaming-multilingual', label: 'Nemotron 3.5 ASR Streaming (Multilingual)' },
  { id: 'parakeet-1.1b-rnnt-multilingual-asr', label: 'Parakeet 1.1B RNNT (Multilingual)' },
] as const;

const MODEL_CONFIG: Record<string, { functionId: string; language: string }> = {
  'nemotron-asr-streaming': { functionId: 'bb0837de-8c7b-481f-9ec8-ef5663e9c1fa', language: 'en-US' },
  'nemotron-3.5-asr-streaming-multilingual': { functionId: 'bb0837de-8c7b-481f-9ec8-ef5663e9c1fa', language: '' },
  'parakeet-1.1b-rnnt-multilingual-asr': { functionId: '71203149-d3b7-4460-8231-1be2543a1fca', language: '' },
};

/** NVIDIA-hosted Riva/NIM low-latency streaming ASR. */
export class NvidiaNimStreamingSTT extends EventEmitter {
  private apiKey: string;
  private model: string;
  private language = 'en-US';
  private sampleRate = 16000;
  private channels = 1;
  private active = false;
  private stream: any = null;
  private buffer: Buffer[] = [];
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private closing = false;
  private readonly maxBufferedChunks = 250;

  constructor(apiKey: string, model = 'nemotron-asr-streaming') {
    super(); this.apiKey = apiKey; this.model = MODEL_CONFIG[model] ? model : 'nemotron-asr-streaming';
  }

  setSampleRate(rate: number) { this.sampleRate = rate; }
  setAudioChannelCount(count: number) { this.channels = count; }
  setCredentials(_path: string) {}
  setRecognitionLanguage(key: string) {
    if (key === 'auto') { this.language = ''; return; }
    this.language = RECOGNITION_LANGUAGES[key]?.bcp47 || RECOGNITION_LANGUAGES[key]?.iso639 || this.language;
  }
  start() {
    if (this.active) return;
    this.active = true;
    this.closing = false;
    this.reconnectAttempts = 0;
    this.connect();
  }
  stop() {
    this.active = false;
    this.closing = true;
    this.buffer = [];
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    try { this.stream?.end(); } catch {}
    this.stream = null;
  }
  finalize() {
    this.closing = true;
    try { this.stream?.end(); } catch {}
  }
  write(chunk: Buffer) {
    if (!this.active) return;
    if (!this.stream) {
      // Keep only a short live-audio window while the provider reconnects.
      // This prevents an outage from growing memory without bound.
      if (this.buffer.length >= this.maxBufferedChunks) this.buffer.shift();
      this.buffer.push(chunk);
      return;
    }
    // proto-loader is configured with keepCase:false below, so protobuf field
    // names are camel-cased at runtime. Using audio_content here silently
    // drops live PCM frames before they reach the NVIDIA Riva stream.
    try { this.stream.write({ audioContent: chunk }); } catch (e) { this.emit('error', e); }
  }

  private connect() {
    try {
      const grpc = require('@grpc/grpc-js');
      const loader = require('@grpc/proto-loader');
      const proto = path.join(__dirname, 'audio', 'riva_asr.proto');
      const def = loader.loadSync(proto, { keepCase: false, longs: String, enums: String, defaults: true, oneofs: true });
      const pkg = grpc.loadPackageDefinition(def).nvidia.riva.asr;
      const cfg = MODEL_CONFIG[this.model];
      const metadata = new grpc.Metadata();
      metadata.add('authorization', `Bearer ${this.apiKey.trim()}`);
      metadata.add('function-id', cfg.functionId);
      const client = new pkg.RivaSpeechRecognition('grpc.nvcf.nvidia.com:443', grpc.credentials.createSsl());
      this.stream = client.streamingRecognize(metadata);
      this.stream.on('data', (response: any) => {
        for (const result of response?.results || []) {
          const alt = result?.alternatives?.[0];
          if (alt?.transcript) this.emit('transcript', { text: alt.transcript, isFinal: !!result.isFinal, confidence: alt.confidence || 1 });
        }
      });
      this.stream.on('error', (error: Error) => this.handleDisconnect(error));
      this.stream.on('end', () => this.handleDisconnect());
      this.stream.write({ streamingConfig: { config: {
        encoding: 'LINEAR_PCM', sampleRateHertz: this.sampleRate, languageCode: this.language || cfg.language,
        maxAlternatives: 1, enableAutomaticPunctuation: true, verbatimTranscripts: true,
      }, interimResults: true } });
      for (const chunk of this.buffer.splice(0)) this.stream.write({ audioContent: chunk });
    } catch (error) { this.handleDisconnect(error as Error); }
  }

  private handleDisconnect(error?: Error) {
    this.stream = null;
    if (!this.active || this.closing) return;
    if (error) this.emit('error', error);
    if (this.reconnectTimer) return;

    const delay = Math.min(5000, 250 * Math.pow(2, this.reconnectAttempts++));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.active && !this.closing) this.connect();
    }, delay);
  }
}
