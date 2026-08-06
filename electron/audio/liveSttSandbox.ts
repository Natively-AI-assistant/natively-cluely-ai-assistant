/**
 * Settings Audio live-STT sandbox wiring.
 *
 * Pure EventEmitter glue — no Electron imports. Unit-tested via node:test
 * (mock provider OK). Glossary: live-transcript-surfaces.
 *
 * Level meters / credential ping are separate; this path streams real
 * partial/final transcript text from the same STT provider stack used in
 * meetings.
 */

export interface LiveSttSandboxTranscript {
  text: string;
  final: boolean;
  confidence?: number;
  speaker: 'user';
  timestamp: number;
}

export type LiveSttSandboxStartResult =
  | { ok: true }
  | { ok: false; reason: 'stt_unready' };

/** Minimal STT surface used by the sandbox (matches createSTTProvider providers). */
export interface LiveSttSandboxStt {
  on(
    event: 'transcript',
    cb: (segment: { text: string; isFinal: boolean; confidence?: number }) => void,
  ): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  removeListener?(event: string, cb: (...args: unknown[]) => void): unknown;
  off?(event: string, cb: (...args: unknown[]) => void): unknown;
  start(): void;
  stop(): void;
  write(chunk: Buffer): void;
  setSampleRate?(rate: number): void;
}

/** Minimal mic capture surface (MicrophoneCapture). */
export interface LiveSttSandboxCapture {
  on(event: 'data', cb: (chunk: Buffer) => void): unknown;
  on(event: 'sample_rate_changed', cb: (rate: number) => void): unknown;
  removeListener?(event: string, cb: (...args: unknown[]) => void): unknown;
  off?(event: string, cb: (...args: unknown[]) => void): unknown;
  getSampleRate?(): number;
}

export interface WireLiveSttSandboxOptions {
  stt: LiveSttSandboxStt;
  capture: LiveSttSandboxCapture;
  emitTranscript: (payload: LiveSttSandboxTranscript) => void;
  emitError?: (message: string) => void;
  /** When false, ignore late STT/capture events (epoch / stop guard). */
  isCurrent?: () => boolean;
  now?: () => number;
}

function detach(
  target: { removeListener?: Function; off?: Function },
  event: string,
  cb: (...args: unknown[]) => void,
): void {
  if (typeof target.removeListener === 'function') {
    target.removeListener(event, cb);
  } else if (typeof target.off === 'function') {
    target.off(event, cb);
  }
}

/**
 * Gate sandbox start when STT provider is none / unconfigured.
 * Mirrors listen-transport unready (`stt_unready`) without importing that module.
 */
export function resolveLiveSttSandboxStart(sttReady: boolean): LiveSttSandboxStartResult {
  if (!sttReady) {
    return { ok: false, reason: 'stt_unready' };
  }
  return { ok: true };
}

/**
 * Pipe mic chunks → STT.write and STT transcripts → emitTranscript.
 * Returns a dispose function that detaches listeners (does not stop STT/capture).
 */
export function wireLiveSttSandbox(opts: WireLiveSttSandboxOptions): () => void {
  const {
    stt,
    capture,
    emitTranscript,
    emitError,
    isCurrent = () => true,
    now = () => Date.now(),
  } = opts;

  let rateApplied = false;

  const onData = (chunk: Buffer) => {
    if (!isCurrent()) return;
    if (!rateApplied && typeof stt.setSampleRate === 'function' && typeof capture.getSampleRate === 'function') {
      try {
        stt.setSampleRate(capture.getSampleRate());
        rateApplied = true;
      } catch {
        /* non-fatal */
      }
    }
    try {
      stt.write(chunk);
    } catch {
      /* non-fatal — provider may reject during reconnect */
    }
  };

  const onRate = (rate: number) => {
    if (!isCurrent()) return;
    try {
      stt.setSampleRate?.(rate);
      rateApplied = true;
    } catch {
      /* non-fatal */
    }
  };

  const onTranscript = (segment: { text: string; isFinal: boolean; confidence?: number }) => {
    if (!isCurrent()) return;
    const text = typeof segment?.text === 'string' ? segment.text : '';
    if (!text.trim()) return;
    emitTranscript({
      text,
      final: !!segment.isFinal,
      confidence: segment.confidence,
      speaker: 'user',
      timestamp: now(),
    });
  };

  const onError = (err: Error) => {
    if (!isCurrent()) return;
    emitError?.(err?.message || String(err));
  };

  capture.on('data', onData);
  capture.on('sample_rate_changed', onRate);
  stt.on('transcript', onTranscript);
  stt.on('error', onError);

  return () => {
    detach(capture, 'data', onData as (...args: unknown[]) => void);
    detach(capture, 'sample_rate_changed', onRate as (...args: unknown[]) => void);
    detach(stt, 'transcript', onTranscript as (...args: unknown[]) => void);
    detach(stt, 'error', onError as (...args: unknown[]) => void);
  };
}
