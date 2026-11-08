// Stand-ins for the native MicrophoneCapture / SystemAudioCapture classes, used
// by the JS wrappers (MicrophoneCapture.ts, SystemAudioCapture.ts) when the
// renderer fallback is active. Same surface: constructor(deviceId),
// start(onData, onSpeechEnded, onSpeechEdge), stop(), getSampleRate(),
// getNativeSampleRate(), getActiveBackend(); same output: 16 kHz mono 16-bit
// PCM in 20 ms frames through the silence gate (silenceGate.ts), up to 3
// frames per callback or 100 ms, speech edges through the shared tracker.
// Everything above the wrappers (STT, recovery, watchdogs) is unchanged.
//
// Failures arrive the way native ones do: as the first callback argument, which
// the wrappers turn into 'error' and the existing recovery handles.

import { captureHost, type CaptureKind, type CaptureSession } from './captureHost';
import { MIC_GATE, SYSTEM_GATE, SilenceGate, type SilenceGateConfig } from './silenceGate';
import { sharedFallbackTracker, type ChannelTracker, type FallbackChannel, type FallbackSpeechEdgeEvent } from './channelTracker';

const RATE = 16000;
const FRAME = 320; // 20 ms
const BATCH_FRAMES = 3;
const BATCH_TIMEOUT_MS = 100;

type DataCallback = (err: Error | null, chunk?: Buffer) => void;
type EndedCallback = (err: Error | null, ended?: boolean) => void;
type EdgeCallback = (err: Error | null, edge?: FallbackSpeechEdgeEvent) => void;

export interface CaptureOpener {
  open(kind: CaptureKind, deviceLabel: string | null, handlers: { onData(pcm: Int16Array): void; onEnded(reason: string): void }): Promise<CaptureSession>;
}

/** Framing, gating and batching of the PCM a capture session delivers. */
export class FallbackPcmPipeline {
  private gate: SilenceGate;
  private frame = new Int16Array(FRAME);
  private fill = 0;
  private clockMs = 0;
  private batch: Buffer[] = [];
  private batchFrames = 0;
  private batchStartedMs = 0;

  constructor(
    gateConfig: SilenceGateConfig,
    private readonly channel: FallbackChannel,
    private readonly tracker: ChannelTracker,
    private readonly out: { data(chunk: Buffer): void; speechEnded(): void; edge(event: FallbackSpeechEdgeEvent): void },
    private readonly wallClock: () => number = Date.now,
  ) {
    this.gate = new SilenceGate(gateConfig, 0);
  }

  begin(): void {
    this.reportEdge(false);
  }

  push(pcm: Int16Array): void {
    let i = 0;
    while (i < pcm.length) {
      const take = Math.min(FRAME - this.fill, pcm.length - i);
      this.frame.set(pcm.subarray(i, i + take), this.fill);
      this.fill += take;
      i += take;
      if (this.fill === FRAME) {
        this.processFrame(this.frame);
        this.frame = new Int16Array(FRAME);
        this.fill = 0;
      }
    }
  }

  /** Audio time: frames processed × 20 ms. */
  get audioMs(): number {
    return this.clockMs;
  }

  private processFrame(frame: Int16Array): void {
    this.clockMs += 20;
    const { action, edge } = this.gate.process(frame, this.clockMs);
    if (action === 'send') this.enqueue(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
    else if (action === 'silence') this.enqueue(Buffer.alloc(FRAME * 2));
    if (edge === 'started') this.reportEdge(true);
    if (edge === 'ended') {
      this.flush();
      this.out.speechEnded();
      this.reportEdge(false);
    }
  }

  private enqueue(bytes: Buffer): void {
    if (this.batchFrames === 0) this.batchStartedMs = this.wallClock();
    this.batch.push(bytes);
    this.batchFrames++;
    if (this.batchFrames >= BATCH_FRAMES) this.flush();
  }

  maybeFlushTimeout(): void {
    if (this.batchFrames > 0 && this.wallClock() - this.batchStartedMs >= BATCH_TIMEOUT_MS) this.flush();
  }

  flush(): void {
    if (this.batchFrames === 0) return;
    const chunk = Buffer.concat(this.batch);
    this.batch = [];
    this.batchFrames = 0;
    this.out.data(chunk);
  }

  private reportEdge(speaking: boolean): void {
    const event = this.tracker.onEdge(this.channel, speaking, this.wallClock());
    if (event) this.out.edge(event);
  }
}

class RendererCaptureMonitor {
  private session: CaptureSession | null = null;
  private running = false;
  private generation = 0;
  private nativeRate = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private pipeline: FallbackPcmPipeline | null = null;

  constructor(
    private readonly kind: CaptureKind,
    private readonly deviceId: string | null,
    private readonly opener: CaptureOpener = captureHost(),
  ) {}

  start(onData: DataCallback, onSpeechEnded?: EndedCallback, onSpeechEdge?: EdgeCallback): void {
    if (this.running) throw new Error('Capture already running');
    this.running = true;
    const generation = ++this.generation;
    const live = () => this.running && this.generation === generation;
    const pipeline = new FallbackPcmPipeline(
      this.kind === 'mic' ? MIC_GATE : SYSTEM_GATE,
      this.kind === 'mic' ? 'user' : 'interviewer',
      sharedFallbackTracker(),
      {
        data: (chunk) => { if (live()) onData(null, chunk); },
        speechEnded: () => { if (live()) onSpeechEnded?.(null, true); },
        edge: (event) => { if (live()) onSpeechEdge?.(null, event); },
      },
    );
    this.pipeline = pipeline;
    pipeline.begin();
    this.flushTimer = setInterval(() => pipeline.maybeFlushTimeout(), 50);

    const fail = (reason: string) => {
      if (!live()) return;
      pipeline.flush();
      this.teardown();
      onData(new Error(`[AudioFallback] ${this.kind === 'mic' ? 'Microphone' : 'System audio'} capture failed: ${reason}`));
    };
    this.opener
      .open(this.kind, this.kind === 'mic' ? this.deviceId : null, {
        onData: (pcm) => {
          if (!live()) return;
          pipeline.push(pcm);
          pipeline.maybeFlushTimeout();
        },
        onEnded: (reason) => fail(reason),
      })
      .then((session) => {
        if (!live()) {
          session.close();
          return;
        }
        this.session = session;
        this.nativeRate = session.nativeRate;
      })
      .catch((err: Error) => fail(err?.message ?? String(err)));
  }

  stop(): void {
    if (!this.running) return;
    this.pipeline?.flush();
    this.teardown();
  }

  private teardown(): void {
    this.running = false;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.session?.close();
    this.session = null;
    this.pipeline = null;
  }

  getSampleRate(): number {
    return RATE;
  }

  getNativeSampleRate(): number {
    return this.nativeRate;
  }

  getActiveBackend(): string {
    return this.kind === 'system' ? 'chromium-loopback' : 'chromium';
  }
}

/** Drop-in for the native MicrophoneCapture class. */
export class RendererMicCapture extends RendererCaptureMonitor {
  constructor(deviceId?: string | null, opener?: CaptureOpener) {
    super('mic', deviceId || null, opener);
  }
}

/** Drop-in for the native SystemAudioCapture class (output device is not selectable: loopback is the default output). */
export class RendererSystemAudioCapture extends RendererCaptureMonitor {
  constructor(_deviceId?: string | null, opener?: CaptureOpener) {
    super('system', null, opener);
  }
}
