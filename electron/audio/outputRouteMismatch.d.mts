export const MIN_PEAK: number;
export const QUIET_MS: number;
export const QUIET_AFTER_SIGNAL_MS: number;
export const WINDOW_MS: number;
export const HITS_REQUIRED: number;
export const SWITCH_COOLDOWN_MS: number;

export interface OutputRouteObservation {
  nowMs: number;
  quietSinceMs: number;
  heardSignal: boolean;
  capturedId: string;
  explicit: boolean;
  defaultId: string;
  commsId: string;
  peaks: { id: string; peak: number }[];
}

export type OutputRouteDecision =
  | { type: 'none' }
  | { type: 'switch' | 'warn'; deviceId: string };

export class OutputRouteMismatchDetector {
  constructor();
  reset(): void;
  observe(s: OutputRouteObservation): OutputRouteDecision;
}
