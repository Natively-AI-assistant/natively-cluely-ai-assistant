// intelligence-eval-real-ui/helpers/latency-recorder-ui.ts
// Monotonic stage timing for one UI test, matching the spec's latency schema.

export type UiStage =
  | 'testStart' | 'appReady' | 'contextLoadStart' | 'contextLoadComplete'
  | 'questionSubmit' | 'buttonClick' | 'loadingIndicator'
  | 'firstNetworkRequest' | 'firstResponseByte' | 'firstStreamChunk'
  | 'firstVisibleText' | 'firstUsefulToken' | 'responseComplete';

export class UiLatencyRecorder {
  private marks = new Map<UiStage, number>();
  private origin = Number(process.hrtime.bigint());
  mark(s: UiStage, atMs?: number) {
    if (this.marks.has(s)) return;
    this.marks.set(s, atMs ?? (Number(process.hrtime.bigint()) - this.origin) / 1e6);
  }
  at(s: UiStage) { return this.marks.get(s) ?? 0; }
  toMetrics() {
    const r = (s: UiStage) => Math.round((this.marks.get(s) ?? 0) * 1000) / 1000;
    const start = this.marks.get('questionSubmit') ?? this.marks.get('buttonClick') ?? 0;
    const span = (s: UiStage) => { const v = this.marks.get(s); return v != null ? Math.round((v - start) * 1000) / 1000 : 0; };
    return {
      testStartMs: 0, appReadyMs: r('appReady'),
      contextLoadStartMs: r('contextLoadStart'), contextLoadCompleteMs: r('contextLoadComplete'),
      questionSubmitMs: r('questionSubmit'), buttonClickMs: r('buttonClick'),
      loadingIndicatorMs: span('loadingIndicator'),
      firstNetworkRequestMs: span('firstNetworkRequest'), firstResponseByteMs: span('firstResponseByte'),
      firstStreamChunkMs: span('firstStreamChunk'), firstVisibleTextMs: span('firstVisibleText'),
      firstUsefulTokenMs: span('firstUsefulToken'), responseCompleteMs: span('responseComplete'),
      totalResponseMs: span('responseComplete'),
    };
  }
}

export function percentile(values: number[], p: number): number {
  const v = values.filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  return v[Math.min(v.length - 1, Math.floor(v.length * p))];
}
