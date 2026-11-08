// TypeScript port of the RMS-only path of native-module/src/silence_suppression.rs
// (use_vad = false: system audio on both platforms, the Windows microphone), for
// the renderer capture fallback, which runs when the native module is missing.
// Same states, thresholds, hangovers, keepalives and latch rules, so speech
// edges and the audio STT receives behave as they do on the native path. Time is
// passed in (the audio clock, 20 ms per frame) so tests run without sleeping.
// Keep in step with the Rust file; SilenceGatePort2026_10_21.test.mjs pins the
// constants against it.

export interface SilenceGateConfig {
  /** Initial RMS threshold (i16 scale); adapts while suppressed. */
  speechThresholdRms: number;
  /** Full audio keeps flowing this long after speech. */
  speechHangoverMs: number;
  /** A silent frame is sent this often while suppressed. */
  keepaliveIntervalMs: number;
  adaptiveMultiplier: number;
  adaptiveMinFloor: number;
  emaAlpha: number;
  sampleRate: number;
}

/** SilenceSuppressionConfig::for_microphone_on(true): the Windows microphone. */
export const MIC_GATE: SilenceGateConfig = {
  speechThresholdRms: 100, speechHangoverMs: 500, keepaliveIntervalMs: 100,
  adaptiveMultiplier: 3, adaptiveMinFloor: 20, emaAlpha: 0.02, sampleRate: 16000,
};

/** SilenceSuppressionConfig::for_system_audio(). */
export const SYSTEM_GATE: SilenceGateConfig = {
  speechThresholdRms: 30, speechHangoverMs: 600, keepaliveIntervalMs: 100,
  adaptiveMultiplier: 3, adaptiveMinFloor: 10, emaAlpha: 0.02, sampleRate: 16000,
};

export const LATCH_WINDOW_SECS = 3;
export const LATCH_FLOOR_RUN_MS = 400;
export const LATCH_RELEASE_MARGIN = 1.5;

export type FrameAction = 'send' | 'silence' | 'suppress';
export type SpeechEdge = 'none' | 'started' | 'ended';
type State = 'active' | 'hangover' | 'suppressed';

/** Every 4th sample, as the Rust calculate_rms does. */
export function frameRms(frame: Int16Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i += 4) sum += frame[i] * frame[i];
  return Math.sqrt(sum / Math.ceil(frame.length / 4));
}

export class SilenceGate {
  private state: State = 'suppressed';
  private lastSpeech: number;
  private lastKeepalive: number;
  private noiseFloorEma: number;
  private adaptiveThreshold: number;
  private wasSpeaking = false;
  private latchWindowRms: number[] = [];
  private latchWindowSamples = 0;
  private latchedBackground: number | null = null;
  private latchedSpeaking = false;
  private latchedLastSpeech: number;

  constructor(private readonly config: SilenceGateConfig, now = 0) {
    this.noiseFloorEma = config.adaptiveMinFloor;
    this.adaptiveThreshold = config.speechThresholdRms;
    this.lastSpeech = now;
    this.lastKeepalive = now;
    this.latchedLastSpeech = now;
  }

  get threshold(): number {
    return this.adaptiveThreshold;
  }

  process(frame: Int16Array, now: number): { action: FrameAction; edge: SpeechEdge } {
    const rms = frameRms(frame);
    const hasSpeech = rms >= this.adaptiveThreshold;
    if (hasSpeech) this.observeLatch(rms, frame.length, now);
    else this.clearLatchWindow();
    const gated = this.gate(rms, hasSpeech, now);
    return { action: gated.action, edge: this.latchedEdge(rms, gated.edge, now) };
  }

  private gate(rms: number, hasSpeech: boolean, now: number): { action: FrameAction; edge: SpeechEdge } {
    if (hasSpeech) {
      this.state = 'active';
      this.lastSpeech = now;
      const edge: SpeechEdge = this.wasSpeaking ? 'none' : 'started';
      this.wasSpeaking = true;
      return { action: 'send', edge };
    }
    let ended = false;
    if (this.state === 'active' || this.state === 'hangover') {
      if (now - this.lastSpeech > this.config.speechHangoverMs) {
        this.state = 'suppressed';
        if (this.wasSpeaking) {
          ended = true;
          this.wasSpeaking = false;
        }
      } else {
        this.state = 'hangover';
        return { action: 'send', edge: 'none' };
      }
    }
    const a = this.config.emaAlpha;
    this.noiseFloorEma = this.noiseFloorEma * (1 - a) + rms * a;
    this.adaptiveThreshold = Math.max(this.noiseFloorEma * this.config.adaptiveMultiplier, this.config.adaptiveMinFloor);
    const edge: SpeechEdge = ended ? 'ended' : 'none';
    if (now - this.lastKeepalive >= this.config.keepaliveIntervalMs) {
      this.lastKeepalive = now;
      return { action: 'silence', edge };
    }
    return { action: 'suppress', edge };
  }

  private latchedEdge(rms: number, gateEdge: SpeechEdge, now: number): SpeechEdge {
    const background = this.latchedBackground;
    if (background === null) return gateEdge;
    if (this.state === 'suppressed') {
      this.latchedBackground = null;
      const speechOpen = this.latchedSpeaking;
      this.latchedSpeaking = false;
      return gateEdge === 'ended' && !speechOpen ? 'none' : gateEdge;
    }
    if (rms >= background * LATCH_RELEASE_MARGIN) {
      this.latchedLastSpeech = now;
      if (this.latchedSpeaking) return 'none';
      this.latchedSpeaking = true;
      return 'started';
    }
    if (this.latchedSpeaking && now - this.latchedLastSpeech > this.config.speechHangoverMs) {
      this.latchedSpeaking = false;
      return 'ended';
    }
    return 'none';
  }

  private observeLatch(rms: number, samples: number, now: number): void {
    this.latchWindowRms.push(rms);
    this.latchWindowSamples += samples;
    const rate = this.config.sampleRate;
    if (this.latchWindowSamples < rate * LATCH_WINDOW_SECS) return;
    const floor = Math.min(...this.latchWindowRms);
    const release = floor * LATCH_RELEASE_MARGIN;
    let run = 0;
    let longest = 0;
    for (const r of this.latchWindowRms) {
      run = r <= release ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    const longestMs = Math.floor((longest * samples * 1000) / Math.max(rate, 1));
    if (release > this.adaptiveThreshold && longestMs >= LATCH_FLOOR_RUN_MS) {
      if (this.latchedBackground === null) {
        this.latchedSpeaking = true;
        this.latchedLastSpeech = now;
      }
      this.latchedBackground = floor;
    }
    this.clearLatchWindow();
  }

  private clearLatchWindow(): void {
    this.latchWindowRms = [];
    this.latchWindowSamples = 0;
  }
}
