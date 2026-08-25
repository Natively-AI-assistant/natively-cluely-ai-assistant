import { EventEmitter } from 'events';
import { RECOGNITION_LANGUAGES } from '../config/languages';
import { createNvcfStreamingRecognize } from './rivaProto';
import {
  DEFAULT_NVIDIA_NIM_STT_MODEL,
  NVIDIA_NIM_STT_MODEL_CONFIG,
  isNvidiaNimSttModel,
} from './nvidiaNimSttModels';

export {
  DEFAULT_NVIDIA_NIM_STT_MODEL,
  NVIDIA_NIM_STT_MODELS,
  NVIDIA_NIM_STT_MODEL_CONFIG,
  isNvidiaNimSttModel,
} from './nvidiaNimSttModels';
export type { NvidiaNimSttModel } from './nvidiaNimSttModels';

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

/** NVIDIA-hosted Riva/NIM low-latency streaming ASR. */
export class NvidiaNimStreamingSTT extends EventEmitter {
  private apiKey: string;
  private model: string;
  /** User-pinned recognition language; null means "let the model decide". */
  private language: string | null = null;
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

  /**
   * The gRPC stream factory, injectable so the response handling — notably the
   * endpoint emission below — can be exercised without a network, an API key
   * or audio. Production always uses the real Riva factory; only tests pass
   * their own (the same pattern as the injected Clock elsewhere).
   */
  private readonly streamFactory: typeof createNvcfStreamingRecognize;

  constructor(
    apiKey: string,
    model = DEFAULT_NVIDIA_NIM_STT_MODEL,
    streamFactory: typeof createNvcfStreamingRecognize = createNvcfStreamingRecognize,
  ) {
    super();
    this.apiKey = apiKey;
    this.model = isNvidiaNimSttModel(model) ? model : DEFAULT_NVIDIA_NIM_STT_MODEL;
    this.streamFactory = streamFactory;
  }

  setSampleRate(rate: number) { this.sampleRate = rate; }
  setAudioChannelCount(count: number) { this.channels = count; }
  setCredentials(_path: string) {}
  setRecognitionLanguage(key: string) {
    // 'auto' falls back to the model's own default, which for the multilingual
    // profiles is Riva's 'multi' auto-detect code — NOT an empty string, which
    // Riva rejects (language_code is documented Required).
    if (key === 'auto') { this.language = null; return; }
    this.language = RECOGNITION_LANGUAGES[key]?.bcp47 || RECOGNITION_LANGUAGES[key]?.iso639 || this.language;
  }

  /** The language_code actually sent; never empty. */
  private resolveLanguageCode(): string {
    const cfg = NVIDIA_NIM_STT_MODEL_CONFIG[this.model];
    if (!cfg) return this.language || 'en-US';
    // A single-locale deployment (the per-language Parakeet CTC builds) only
    // recognises its own language. Forwarding the user's recognition-language
    // pin there is not honouring a preference, it is sending zh-TW audio config
    // to a Spanish model — so the model's own locale wins.
    if (cfg.singleLocale) return cfg.languageCode;
    return this.language || cfg.languageCode || 'en-US';
  }
  start() {
    if (this.active) return;
    this.active = true;
    this.reconnectAttempts = 0;
    this.connect();
  }
  stop() {
    this.active = false;
    this.clearReconnectTimer();
    this.dropBuffer();
    try { this.stream?.end(); } catch {}
    this.stream = null;
  }

  /**
   * Flush the pending utterance without ending the session.
   *
   * The renderer calls this on every "Answer Now" to mean "transcribe what I
   * just said". Riva has NO flush control — StreamingRecognize is one long
   * call, and half-closing it is the only way to make the server release a
   * final it is still holding.
   *
   * Riva DOES endpoint on its own for completed utterances; live logs show
   * finals arriving mid-meeting with no press. What it will not do is release
   * the utterance still in flight at the moment the user asks for an answer,
   * and that trailing fragment is usually the question itself. Measured on one
   * press: a 14-char final had already landed from normal endpointing, and the
   * 39-char remainder — the actual question — only arrived once this closed the
   * call. Replacing end() with a no-op therefore did not merely delay finals,
   * it lost the one that mattered.
   *
   * So: ROTATE rather than close. End the current call (the server flushes its
   * final, which still reaches the listener — the 'data' handler emits
   * transcripts regardless of generation) and open a replacement immediately so
   * audio after the press keeps flowing.
   *
   * connect() runs BEFORE dying.end() on purpose: it bumps `generation`, so the
   * dying stream's 'end'/'error' handlers see a stale generation and return
   * early. That is what keeps this rotation from looking like a dropped stream —
   * no backoff, no error, and no "STT reconnecting" in the overlay, which is
   * exactly what the previous end()-without-replacement caused.
   *
   * stop() still ends the stream outright; that one really is end of session.
   */
  finalize() {
    if (!this.active) return;
    const dying = this.stream;
    if (!dying) return;
    this.stream = null;      // no further writes reach the call being closed
    this.connect();          // new stream first, so `dying`'s handlers go stale
    try { dying.end(); } catch { /* already gone; the replacement is live */ }
  }

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
    try {
      this.stream.write({ audioContent: chunk });
    } catch (e) {
      // The stream died between the null check above and this write — the peer
      // half-closed, or a teardown raced us. That is a transport hiccup the
      // reconnect ladder already handles, so drop the dead stream and let it
      // rebuild rather than raising an STT error the user cannot act on.
      console.warn('[NvidiaNimSTT] write failed, dropping stream for reconnect:', (e as Error)?.message);
      this.stream = null;
      if (this.active) this.scheduleReconnect();
    }
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
      const cfg = NVIDIA_NIM_STT_MODEL_CONFIG[this.model];
      this.stream = this.streamFactory(this.apiKey, cfg.functionId);
      this.stream.on('data', (response: any) => {
        // A response proves the session works; clear the backoff so a later
        // blip starts from 1s again instead of inheriting this session's count.
        if (gen === this.generation) this.reconnectAttempts = 0;
        for (const result of response?.results || []) {
          const alt = result?.alternatives?.[0];
          if (alt?.transcript) this.emit('transcript', { text: alt.transcript, isFinal: !!result.isFinal, confidence: alt.confidence || 1 });
          // Riva marks the end of an utterance with is_final. Auto Answer
          // treats that as a provider ENDPOINT and confirms the speaker
          // stopped in ENDPOINT_CONFIRM_MS instead of waiting the full
          // stability window (2026-08-25: without this, every Nemotron
          // stoppage paid the whole ~900 ms). Additive: consumers that do
          // not listen for 'endpoint' are unaffected.
          if (result?.isFinal) this.emit('endpoint', { type: 'speech_final' });
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
      // Field names are camelCase because the proto loads with keepCase:false.
      // An unrecognised key does not throw — it serializes to nothing.
      this.stream.write({ streamingConfig: { config: {
        encoding: 'LINEAR_PCM', sampleRateHertz: this.sampleRate, languageCode: this.resolveLanguageCode(),
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
