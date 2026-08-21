import { EventEmitter } from 'events';
import path from 'path';
import { RECOGNITION_LANGUAGES } from '../config/languages';

// Same ladder as DeepgramStreamingSTT / SonioxStreamingSTT so a flapping
// network cannot drive an indefinite reconnect storm.
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_MAX_ATTEMPTS = 10;
// Audio buffered while no stream is up. 16 kHz mono 16-bit is ~32 KB/s, so this
// is ~5s of speech. A gRPC stream that dies mid-meeting used to leave `active`
// true with no stream and no reconnect, so every subsequent write() appended
// here forever (~115 MB/hour) and none of it was ever sent.
const MAX_BUFFERED_BYTES = 160 * 1024;

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
  private bufferedBytes = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  // Bumped on every connect(). Handlers capture their own generation so a dead
  // stream's late 'error'/'end' cannot null out its replacement.
  private generation = 0;

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
  start() { if (this.active) return; this.active = true; this.reconnectAttempts = 0; this.connect(); }
  stop() {
    this.active = false;
    this.clearReconnectTimer();
    this.dropBuffer();
    try { this.stream?.end(); } catch {}
    this.stream = null;
  }
  finalize() { try { this.stream?.end(); } catch {} }
  write(chunk: Buffer) {
    if (!this.active) return;
    if (!this.stream) {
      // No stream right now (pre-connect, or a reconnect in flight). Keep the
      // most RECENT audio and drop the oldest: replaying a long stale backlog
      // at a realtime endpoint is worse than losing it.
      this.buffer.push(chunk);
      this.bufferedBytes += chunk.length;
      while (this.bufferedBytes > MAX_BUFFERED_BYTES && this.buffer.length > 1) {
        this.bufferedBytes -= this.buffer.shift()!.length;
      }
      return;
    }
    try { this.stream.write({ audioContent: chunk }); } catch (e) { this.emit('error', e); }
  }

  private dropBuffer() { this.buffer = []; this.bufferedBytes = 0; }

  private clearReconnectTimer() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  /**
   * A gRPC stream that ends or errors mid-meeting is normal (idle timeouts,
   * network blips). Without this the class stayed `active` with a null stream
   * forever: transcription was silently dead for the rest of the session and
   * the audio buffer grew without bound.
   */
  private scheduleReconnect() {
    if (!this.active || this.reconnectTimer) return;
    // Clear anything left over from an earlier gap. Audio written DURING this
    // gap still buffers (bounded to MAX_BUFFERED_BYTES) and is flushed on
    // reconnect, so a short blip costs latency rather than the user's words.
    this.dropBuffer();
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      console.error('[NvidiaNimSTT] Max reconnect attempts reached — giving up');
      this.emit('error', new Error('NvidiaNimStreamingSTT: max reconnect attempts exceeded'));
      return;
    }
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts), RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempts++;
    console.log(`[NvidiaNimSTT] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.active) this.connect();
    }, delay);
  }

  private connect() {
    const gen = ++this.generation;
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
        // A response proves the session works; clear the backoff so a later
        // blip starts from 1s again instead of inheriting this session's count.
        if (gen === this.generation) this.reconnectAttempts = 0;
        for (const result of response?.results || []) {
          const alt = result?.alternatives?.[0];
          if (alt?.transcript) this.emit('transcript', { text: alt.transcript, isFinal: !!result.isFinal, confidence: alt.confidence || 1 });
        }
      });
      this.stream.on('error', (error: Error) => {
        if (gen !== this.generation) return;
        this.stream = null;
        if (this.active) { this.emit('error', error); this.scheduleReconnect(); }
      });
      this.stream.on('end', () => {
        if (gen !== this.generation) return;
        this.stream = null;
        if (this.active) this.scheduleReconnect();
      });
      this.stream.write({ streamingConfig: { config: {
        encoding: 'LINEAR_PCM', sampleRateHertz: this.sampleRate, languageCode: this.language || cfg.language,
        maxAlternatives: 1, enableAutomaticPunctuation: true, verbatimTranscripts: true,
      }, interimResults: true } });
      for (const chunk of this.buffer.splice(0)) this.stream.write({ audioContent: chunk });
      this.bufferedBytes = 0;
    } catch (error) {
      if (gen !== this.generation) return;
      this.stream = null;
      this.emit('error', error);
      this.scheduleReconnect();
    }
  }
}
