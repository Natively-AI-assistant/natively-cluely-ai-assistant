export type SystemAudioHealthEvent =
  | { kind: 'capture-started'; nowMs: number }
  | { kind: 'capture-stopped'; nowMs: number }
  | { kind: 'chunk'; nowMs: number; chunk: Buffer }
  | { kind: 'watchdog-tick'; nowMs: number }
  | { kind: 'same-device-route-detected'; nowMs: number; device: string };

export type SystemAudioHealthDecision =
  | { type: 'none' }
  | { type: 'log'; level: 'warn' | 'info'; reason: string; message: string; gapMs?: number }
  | {
      type: 'warn-user';
      reason: 'same-device-input-output';
      device: string;
      terminal: false;
      stuck: true;
    };

export interface SystemAudioHealthClassifierOptions {
  watchdogMs?: number;
  zeroObservationMs?: number;
  meaningfulPeakToPeak?: number;
  interChunkGapLogMs?: number;
}

export class SystemAudioHealthClassifier {
  static supportedEventKinds: readonly string[];
  constructor(options?: SystemAudioHealthClassifierOptions);
  reset(): void;
  handle(event: SystemAudioHealthEvent): SystemAudioHealthDecision;
}

export function peakToPeakInt16LE(chunk: Buffer): number;
