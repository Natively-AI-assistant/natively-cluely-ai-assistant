import type { NormalisedChart } from './chartSpec.mjs';

export const CHART_WIDTH: number;
export function niceTicks(min: number, max: number, target?: number): number[];
export function renderChartSvg(
  chart: NormalisedChart,
  colors?: { text: string; muted: string; nodeFill: string; stroke: string; groupFill: string; accent: string; dark: boolean },
): { svg: string; width: number; height: number };
