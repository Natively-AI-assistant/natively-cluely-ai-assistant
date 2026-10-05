export const CHART_SPEC_VERSION: number;
export const CHART_TYPES: readonly string[];
export const SERIES_STATUSES: readonly string[];
export const CHART_LIMITS: Readonly<Record<string, number>>;

export type SeriesStatus = 'observed' | 'calculated' | 'scenario' | 'illustrative';

export interface ChartSeries {
  name: string;
  status: SeriesStatus;
  values: Array<number | null>;
  projectedFrom: number | null;
  source: string;
  unit: string;
  computed: boolean;
}

export interface NormalisedChart {
  v: number;
  type: string;
  title: string;
  x: { label: string; unit: string; kind: 'time' | 'category' | 'number'; values: Array<string | number> };
  y: { label: string; unit: string; min: number | null; minReason: string };
  series: ChartSeries[];
  band: null | { name: string; low: Array<number | null>; high: Array<number | null>; meaning: 'scenario-range' | 'confidence-interval'; level: number | null; source: string };
  points: Array<{ label: string; x: number; y: number }>;
  quadrant: null | { rubric: string; xMin: number; xMax: number; yMin: number; yMax: number; labels: string[] };
  parts: Array<{ label: string; value: number; percent: number }>;
  stages: Array<{ label: string; value: number; ratePercent: number | null }>;
  steps: Array<{ label: string; kind: 'start' | 'delta' | 'total'; value: number; start: number; end: number }>;
  heat: null | { rows: string[]; cols: string[]; cells: Array<Array<number | string | null>>; numeric: boolean };
  badges: string[];
  notes: string[];
  assumptions: string[];
  sources: string[];
  calc: null | { version: number; runs: Array<Record<string, unknown> & { kind: string; formula: string }> };
}

export interface ChartTable {
  columns: string[];
  rows: Array<Array<string | number>>;
}

export type ChartSpecResult =
  | { ok: true; chart: NormalisedChart; table: ChartTable; issues: string[] }
  | { ok: false; code: string; message: string; missing?: string[]; issues: string[] };

export function parseChartJson(source: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; code: string };
export function normaliseChartSpec(source: string | Record<string, unknown>): ChartSpecResult;
export function chartTable(chart: NormalisedChart): ChartTable;
export function chartCsv(chart: NormalisedChart, table?: ChartTable): string;
export function chartLabel(chart: NormalisedChart): string;
export function describeChart(chart: NormalisedChart): string;
