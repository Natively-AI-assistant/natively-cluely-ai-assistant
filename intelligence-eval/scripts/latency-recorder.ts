// intelligence-eval/scripts/latency-recorder.ts
//
// Per-stage latency recorder for the intelligence e2e harness. Uses
// process.hrtime.bigint() for monotonic, sub-millisecond timing. Each stage is
// stamped as it happens; the recorder derives the spec's metric fields
// (contextBuildMs, intentDetectionMs, questionExtractionMs,
// providerRequestStartMs, firstTokenMs, totalResponseMs) from the stamps.
//
// The "most important" metric is time-to-first-useful-token (firstTokenMs),
// measured from requestStart to the first streamed/composed token.

export type Stage =
  | 'requestStart'
  | 'transcriptCleaned'
  | 'questionExtracted'
  | 'intentClassified'
  | 'contextReady'        // context routing + building done
  | 'promptBuilt'
  | 'providerRequestStart'
  | 'firstToken'
  | 'responseComplete';

export class LatencyRecorder {
  private marks = new Map<Stage, number>();
  private originNs: bigint;

  constructor() {
    this.originNs = process.hrtime.bigint();
    this.marks.set('requestStart', 0);
  }

  /** Stamp a stage at the current time (ms since requestStart). */
  mark(stage: Stage): void {
    const ms = Number(process.hrtime.bigint() - this.originNs) / 1e6;
    // Keep the FIRST stamp for a stage (e.g. firstToken).
    if (!this.marks.has(stage)) this.marks.set(stage, ms);
  }

  private at(stage: Stage): number {
    return this.marks.get(stage) ?? 0;
  }

  private span(from: Stage, to: Stage): number {
    if (!this.marks.has(from) || !this.marks.has(to)) return 0;
    return Math.max(0, this.at(to) - this.at(from));
  }

  /** Build the spec's latency fields. */
  toMetrics(): {
    contextBuildMs: number;
    intentDetectionMs: number;
    questionExtractionMs: number;
    providerRequestStartMs: number;
    firstTokenMs: number;
    totalResponseMs: number;
    // Streaming-specific spec fields:
    requestStartMs: number;
    contextReadyMs: number;
  } {
    return {
      // Extraction = requestStart → questionExtracted (transcript clean happens inside)
      questionExtractionMs: this.span('requestStart', 'questionExtracted'),
      intentDetectionMs: this.span('questionExtracted', 'intentClassified'),
      // Context build = intentClassified (or extraction) → contextReady
      contextBuildMs: this.span('intentClassified', 'contextReady'),
      providerRequestStartMs: this.at('providerRequestStart'),
      firstTokenMs: this.at('firstToken'),
      totalResponseMs: this.at('responseComplete'),
      requestStartMs: 0,
      contextReadyMs: this.at('contextReady'),
    };
  }

  /** Raw stamps for debugging. */
  raw(): Record<string, number> {
    return Object.fromEntries(this.marks.entries());
  }
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}
