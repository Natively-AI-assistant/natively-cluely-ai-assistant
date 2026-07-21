import { telemetryService } from './TelemetryService';

/**
 * PiLatencyTrace — one per live Profile-Intelligence request (manual answer or
 * "What to answer?"). Records the full click→render path as a sequence of
 * milestones, each carrying the elapsed-ms-from-start so the live trace can be
 * reconstructed offline. Emits one telemetry event per milestone (non-blocking,
 * never throws). Privacy: callers pass METADATA only (counts/sizes/hashes/
 * provider/model/timings) — the TelemetryService sanitizer strips any raw
 * content key, but the contract here is "no raw resume/JD/custom/persona/
 * negotiation/transcript text, ever".
 *
 * The trace is also queryable in-process (`snapshot()`) so the eval harnesses /
 * debug-metadata path can attach the timings object to their reports without
 * re-reading the JSONL log.
 */
export type PiMilestone =
  | 'question_submitted'
  | 'what_to_answer_clicked'
  | 'transcript_window_loaded'
  | 'latest_question_extracted'
  | 'intent_classified'
  | 'answer_type_selected'
  | 'context_selected'
  | 'context_build_started'
  | 'context_build_completed'
  | 'prompt_built'
  | 'provider_request_started'
  | 'first_response_byte'
  | 'first_stream_chunk'
  | 'first_visible_text'
  | 'first_useful_token'
  | 'response_completed'
  | 'validation_started'
  | 'validation_completed'
  | 'validation_failed'
  | 'repair_used'
  | 'retry_used'
  | 'degraded_context'
  | 'ui_render_completed'
  // What-to-answer live-copilot guardrails (Phase 9 / Phase 4 telemetry).
  | 'provider_timeout'
  | 'fallback_answer_used'
  // Verified code execution (background, post-answer).
  | 'code_verify_started'
  | 'code_verify_skipped'
  | 'tests_extracted'
  | 'code_executed'
  | 'code_verify_passed'
  | 'code_verify_failed'
  | 'code_correction_used'
  | 'code_correction_error'
  | 'code_correction_reverified'
  | 'code_verify_error';

function monotonicNow(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = (globalThis as any).performance;
    if (p && typeof p.now === 'function') return p.now();
  } catch { /* ignore */ }
  return Date.now();
}

export interface PiTraceInit {
  /** 'manual' (typed question) or 'what_to_answer' (overlay action). */
  source: 'manual' | 'what_to_answer' | 'system';
  sessionId?: string;
  modeId?: string;
  /** Opaque request id so renderer + main milestones can be joined. */
  requestId?: string;
}

export class PiLatencyTrace {
  private readonly t0: number;
  private readonly source: PiTraceInit['source'];
  private readonly sessionId?: string;
  private readonly modeId?: string;
  readonly requestId: string;
  private readonly timings: Record<string, number> = {};
  private firstUsefulEmitted = false;
  private static counter = 0;

  constructor(init: PiTraceInit) {
    this.t0 = monotonicNow();
    this.source = init.source;
    this.sessionId = init.sessionId;
    this.modeId = init.modeId;
    this.requestId = init.requestId ?? `pi_${Math.round(this.t0)}_${++PiLatencyTrace.counter}`;
  }

  /** ms elapsed since the trace started. */
  elapsedMs(): number {
    return Math.max(0, Math.round(monotonicNow() - this.t0));
  }

  /**
   * Record a milestone. `props` must be metadata only (no raw content). The
   * milestone's elapsed-from-start is stored under timings[milestone] and
   * emitted as the event's durationMs.
   */
  mark(milestone: PiMilestone, props?: Record<string, unknown>): number {
    const elapsed = this.elapsedMs();
    // Keep the FIRST occurrence for idempotent milestones (first_useful_token
    // can be attempted per-chunk; only the first matters).
    if (!(milestone in this.timings)) this.timings[milestone] = elapsed;
    telemetryService.track({
      name: milestone,
      sessionId: this.sessionId,
      modeId: this.modeId,
      durationMs: elapsed,
      properties: { source: this.source, requestId: this.requestId, ...(props ?? {}) },
    });
    return elapsed;
  }

  /**
   * Idempotent first-useful-token marker — call on every emitted chunk; only
   * the first call records/emits. Returns true the first time.
   */
  markFirstUseful(props?: Record<string, unknown>): boolean {
    if (this.firstUsefulEmitted) return false;
    this.firstUsefulEmitted = true;
    this.mark('first_useful_token', props);
    return true;
  }

  hasFirstUseful(): boolean {
    return this.firstUsefulEmitted;
  }

  /** All recorded milestone elapsed-times (for debug metadata / eval reports). */
  snapshot(): Record<string, number> {
    return { ...this.timings };
  }

  /**
   * Print a human-readable per-stage breakdown to the console — gated behind
   * MEASURE_LATENCY=true (or PI_LATENCY_TRACE=true) so it's a deliberate
   * diagnostic, never production noise. Shows BOTH the elapsed-from-start AND
   * the delta between consecutive milestones, so it's obvious where the wall
   * time actually goes (pre-work vs prompt-build vs provider TTFT vs stream).
   * Call once when the request completes. Metadata only — no answer content.
   */
  finish(extra?: Record<string, unknown>): void {
    const on = (() => {
      try {
        return process.env.MEASURE_LATENCY === 'true' || process.env.PI_LATENCY_TRACE === 'true';
      } catch { return false; }
    })();
    if (!on) return;

    // Order milestones by their recorded elapsed time so the breakdown reads
    // chronologically regardless of insertion order.
    const entries = Object.entries(this.timings).sort((a, b) => a[1] - b[1]);
    const total = this.elapsedMs();
    const lines: string[] = [];
    lines.push(`\n┌─ PI LATENCY TRACE (${this.source}, req=${this.requestId}) ─ total ${total}ms`);
    let prev = 0;
    let firstUseful: number | null = null;
    for (const [name, at] of entries) {
      const delta = at - prev;
      // Flag the dominant gaps so the eye lands on them.
      const flag = delta >= 1000 ? '  ⟵ SLOW' : delta >= 400 ? '  ⟵' : '';
      lines.push(`│  +${String(delta).padStart(5)}ms   @${String(at).padStart(6)}ms  ${name}${flag}`);
      if (name === 'first_useful_token' && firstUseful === null) firstUseful = at;
      prev = at;
    }
    if (firstUseful !== null) {
      lines.push(`├─ FIRST USEFUL TOKEN: ${firstUseful}ms  (this is what the user perceives as "speed")`);
    }
    if (extra && Object.keys(extra).length) {
      lines.push(`├─ ${JSON.stringify(extra)}`);
    }
    lines.push(`└─ end trace`);
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
  }
}
