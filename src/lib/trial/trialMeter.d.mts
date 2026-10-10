export const TRIAL_METER_HIGH_PCT: number;

export type TrialMeterTone = 'ok' | 'low' | 'out';

export interface TrialMeterRow {
  id: 'voice' | 'ai';
  used: number;
  limit: number;
  unit: 'minutes' | 'tokens';
  /** The real percentage, above 100 once the allowance is passed. */
  percent: number;
  /** The bar's width, 0 to 100. */
  fill: number;
  tone: TrialMeterTone;
}

export interface TrialMeterView {
  msLeft: number;
  clock: string;
  timeLow: boolean;
  rows: TrialMeterRow[];
  tone: TrialMeterTone;
}

export function trialClock(msLeft: number, capMs?: number | null): string;

export function trialMeterView(s: {
  now: number;
  expiresAt?: number | null;
  usage?: { ai_tokens?: number; stt_seconds?: number } | null;
  limits?: { ai_tokens?: number; stt_minutes?: number; duration_ms?: number } | null;
} | null | undefined): TrialMeterView | null;

export function shouldShowTrialMeter(tone: TrialMeterTone, closedAt: TrialMeterTone | null): boolean;
