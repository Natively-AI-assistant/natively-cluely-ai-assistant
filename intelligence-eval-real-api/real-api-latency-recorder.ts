// intelligence-eval-real-api/real-api-latency-recorder.ts
//
// Real wall-clock latency recorder for the live Natively API path. Stamps the
// streaming milestones the spec requires:
//   request_start → context_ready → provider_request_start → first_byte →
//   first_token → first_useful_token → stream_completed → total_response
//
// "first_useful_token" = first streamed chunk that contains a non-empty,
// non-whitespace candidate-answer character (i.e. the first token a human would
// actually see as the answer). Uses process.hrtime.bigint() (monotonic).

export type RealStage =
  | 'requestStart'
  | 'contextReady'
  | 'providerRequestStart'
  | 'firstByte'
  | 'firstToken'
  | 'firstUsefulToken'
  | 'streamCompleted';

export class RealLatencyRecorder {
  private marks = new Map<RealStage, number>();
  private originNs: bigint;

  constructor() {
    this.originNs = process.hrtime.bigint();
    this.marks.set('requestStart', 0);
  }

  private nowMs(): number {
    return Number(process.hrtime.bigint() - this.originNs) / 1e6;
  }

  mark(stage: RealStage): void {
    if (!this.marks.has(stage)) this.marks.set(stage, this.nowMs());
  }

  at(stage: RealStage): number {
    return this.marks.get(stage) ?? 0;
  }

  private span(from: RealStage, to: RealStage): number {
    if (!this.marks.has(from) || !this.marks.has(to)) return 0;
    return Math.max(0, this.at(to) - this.at(from));
  }

  /** Spec latency fields (ms). */
  metrics() {
    return {
      requestStartMs: 0,
      contextReadyMs: round(this.at('contextReady')),
      providerRequestStartMs: round(this.at('providerRequestStart')),
      firstByteMs: round(this.at('firstByte')),
      firstTokenMs: round(this.at('firstToken')),
      firstUsefulTokenMs: round(this.at('firstUsefulToken')),
      streamCompletedMs: round(this.at('streamCompleted')),
      totalResponseMs: round(this.at('streamCompleted')),
      // Derived stage spans:
      contextBuildMs: round(this.span('requestStart', 'contextReady')),
      providerConnectMs: round(this.span('providerRequestStart', 'firstByte')),
    };
  }

  raw(): Record<string, number> {
    return Object.fromEntries([...this.marks.entries()].map(([k, v]) => [k, round(v)]));
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function percentile(values: number[], p: number): number {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return 0;
  return v[Math.min(v.length - 1, Math.floor(v.length * p))];
}
