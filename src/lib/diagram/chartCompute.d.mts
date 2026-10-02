export const CALC_VERSION: number;
export const CALC_LIMITS: Readonly<{ maxPeriods: number; maxStages: number; maxSamples: number; maxExpressionChars: number }>;
export const COMPUTE_KINDS: readonly string[];

export interface CalcFailure {
  ok: false;
  code: string;
  message: string;
  missing?: string[];
}
export interface SeriesCalc {
  ok: true;
  kind: string;
  values: number[];
  labels: string[];
  projectedFrom: number;
  formula: string;
  inputs: Record<string, unknown>;
  summary?: string;
  outcome?: string;
  breakEvenPeriod?: number | null;
}

export function roundTo(value: number, decimals?: number): number;
export function periodLabels(period: string, periods: number, includeBaseline?: boolean): string[];
export function compoundGrowth(input?: Record<string, unknown>): SeriesCalc | CalcFailure;
export function growthWithChurn(input?: Record<string, unknown>): SeriesCalc | CalcFailure;
export function percentageChange(input?: { from?: number; to?: number }): { ok: true; kind: string; percent: number; absolute: number; formula: string; inputs: Record<string, unknown> } | CalcFailure;
export function percentagePointChange(input?: { fromPercent?: number; toPercent?: number }): { ok: true; kind: string; points: number; formula: string; inputs: Record<string, unknown> } | CalcFailure;
export function stageConversion(input?: { stages?: Array<{ label?: string; count?: number; value?: number }> }):
  | { ok: true; kind: string; steps: Array<{ from: string; to: string; ratePercent: number | null }>; overallPercent: number | null; notes: string[]; formula: string; inputs: Record<string, unknown> }
  | CalcFailure;
export function cumulativeNet(input?: Record<string, unknown>): SeriesCalc | CalcFailure;
export function breakEven(input?: Record<string, unknown>): SeriesCalc | CalcFailure;
export function weightedPipeline(input?: { stages?: Array<{ label?: string; amount?: number; probabilityPercent?: number }> }):
  | { ok: true; kind: string; rows: Array<{ label: string; amount: number; probabilityPercent: number; weighted: number }>; total: number; weightedTotal: number; formula: string; inputs: Record<string, unknown> }
  | CalcFailure;
export function compileExpression(expression: unknown, variable?: string): ((x: number) => number) | null;
export function evaluateFunction(input?: Record<string, unknown>): { ok: true; kind: 'function'; xs: number[]; ys: Array<number | null>; formula: string; inputs: Record<string, unknown> } | CalcFailure;
export function runCompute(request: unknown): (Record<string, unknown> & { ok: true; kind: string }) | CalcFailure;
export function formatNumber(value: number, decimals?: number): string;
export function formatPercent(value: number): string;
