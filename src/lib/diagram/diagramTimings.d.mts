export interface DiagramTimingEntry {
  id: string;
  marks: Record<string, number>;
  numbers: Record<string, number | string>;
}
export interface DiagramTimingSummary {
  id: string;
  hasRequestMark: boolean;
  firstTokenMs: number | null;
  firstTextVisibleMs: number | null;
  diagramReceivedMs: number | null;
  diagramRevealedMs: number | null;
  diagramVisibleMs: number | null;
  answerCompleteMs: number | null;
  [extra: string]: number | string | boolean | null;
}
export interface DiagramTimingLog {
  mark(id: string | null | undefined, name: string, at: number): void;
  set(id: string | null | undefined, name: string, value: number | string): void;
  rename(fromId: string, toId: string): void;
  get(id: string): DiagramTimingEntry | null;
  all(): DiagramTimingEntry[];
  summary(id: string): DiagramTimingSummary | null;
  clear(): void;
}
export function createDiagramTimingLog(options?: { max?: number }): DiagramTimingLog;
export const diagramTimings: DiagramTimingLog;
export function percentiles(values: number[]): { n: number; min: number; p50: number; p95: number; max: number } | null;
