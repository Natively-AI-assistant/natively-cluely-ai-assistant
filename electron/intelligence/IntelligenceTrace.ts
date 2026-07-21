// electron/intelligence/IntelligenceTrace.ts
//
// The missing structured, per-answer "why did the assistant include this context"
// record (spec Phase 12 IntelligenceTrace + Phase 13 context-inclusion report).
//
// Today, observability is fragmented across PiLatencyTrace (latency), piTelemetry
// (scrubbed markers), and ad-hoc console.log. There is NO single record that says
// "for this answer: the router decided X, requested these sources, included these,
// dropped these (and why), spent N tokens, TTFT was M ms." This module is that
// record.
//
// DESIGN CONSTRAINTS (non-negotiable):
//   1. ZERO-COST WHEN OFF. Gated by intelligenceFlags.trace (default OFF). When off,
//      `beginTrace()` returns a shared NO-OP whose methods do nothing — no
//      allocation per call beyond the singleton, no buffer growth.
//   2. NEVER THROWS. Every method is wrapped so a tracing bug can never break an
//      answer. Tracing is a side-channel; the hot path must not depend on it.
//   3. CONTENT-FREE / PRIVACY-SAFE. Like piTelemetry, the trace stores MARKERS, not
//      raw content: the query is stored as a sha256 prefix + length, context blocks
//      as {source, trustLevel, included, reason, tokenEstimate, confidence} — never
//      the resume/JD/transcript/answer text. The trace is dev-inspectable and safe to
//      ship to telemetry; it cannot leak PII.
//
// The trace is OBSERVE-ONLY: building one never changes routing or an answer.

import { createHash } from 'crypto';
import { isIntelligenceTraceEnabled, intelligenceFlagSnapshot } from './intelligenceFlags';

/** A single context source's inclusion decision (the Phase 13 report row). */
export interface ContextInclusionEntry {
  /** Source name — a fixed vocabulary (profile_tree, live_transcript, hybrid_rag, …). */
  source: string;
  /** Trust level label (high | medium | low | untrusted) — mirrors TrustLevels. */
  trustLevel?: string;
  /** Was it requested by the router? */
  requested: boolean;
  /** Was content actually retrieved for it? */
  retrieved: boolean;
  /** Did it make it into the final prompt? */
  included: boolean;
  /** Why included or dropped (marker reason, not content). */
  reason?: string;
  /** Estimated tokens this block contributed (0 when dropped). */
  tokenEstimate?: number;
  /** Retrieval/confidence score when applicable (RAG/Hindsight). */
  score?: number;
}

/** A coarse latency stage marker. */
export interface TraceStage {
  stage: string;
  ms: number;
}

/** The full structured record for one answer (spec Phase 12). */
export interface IntelligenceTraceRecord {
  /** sha256(query).slice(0,12) — never the raw query. */
  queryHash: string;
  queryLength: number;
  // ── Correlation ids (audit finding #9) — let one answer be joined across the
  // IPC boundary, the engine trace, and the PiLatencyTrace. All are short opaque
  // markers (ids / hashes), never raw content. Optional + additive: a trace that
  // never calls setCorrelation() looks exactly as before.
  /** Per-answer request id minted at the IPC boundary (e.g. PiLatencyTrace.requestId). */
  requestId?: string;
  /** Renderer sender id / session id, when known. */
  sessionId?: string;
  /** Active meeting id, when an answer happens inside a meeting. */
  meetingId?: string;
  /** Surface marker: manual | what_to_answer | phone | system. */
  surface?: string;
  /** Mode id (distinct from the human-facing `mode` template label). */
  modeId?: string;
  /** Provider retry count, when the execution path tracks it. */
  retryCount?: number;
  /** True when the answer was aborted/superseded before completing. */
  aborted?: boolean;
  /** Coarse error category marker (e.g. rate_limit, timeout, network). */
  errorCategory?: string;
  mode?: string;
  source?: string; // manual | what_to_answer | transcript | system
  answerType?: string;
  answerContract?: string;
  /** Profile-routing markers (the prompt's "specific bugs to prevent" diagnostics). */
  deterministicFastPathUsed?: boolean;
  profileFactsReady?: boolean;
  promptContainsProfileContext?: boolean;
  /** The ContextRouter's structured decision (marker booleans + reason). */
  routerDecision?: Record<string, unknown>;
  /** Per-source inclusion report (Phase 13). */
  contextInclusion: ContextInclusionEntry[];
  /** Latency by stage. */
  stages: TraceStage[];
  model?: string;
  provider?: string;
  firstTokenMs?: number;
  firstUsefulMs?: number;
  totalMs?: number;
  fallbacksUsed: string[];
  errors: string[];
  /** Resolved flag snapshot at trace time. */
  flags: Record<string, boolean>;
  /** Wall-clock-independent counter id for ordering within a process. */
  seq: number;
}

const SOURCE_LABEL_RE = /^[\w.:_/+-]{1,40}$/;
const MAX_INCLUSION_ENTRIES = 32;
const MAX_STAGES = 64;
const MAX_LIST = 32;

function marker(v: string | undefined, max = 48): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.slice(0, max);
}

/**
 * One answer's trace. Obtain via beginTrace(); call recording methods through the
 * answer's lifecycle; read .toRecord() for the structured result. Every method is
 * exception-safe.
 */
export interface IntelligenceTrace {
  readonly enabled: boolean;
  /** Attach correlation ids so this answer can be joined across IPC/engine/latency traces. */
  setCorrelation(info: {
    requestId?: string;
    sessionId?: string;
    meetingId?: string;
    surface?: string;
    modeId?: string;
    retryCount?: number;
    aborted?: boolean;
    errorCategory?: string;
  }): IntelligenceTrace;
  setRouting(info: {
    mode?: string;
    source?: string;
    answerType?: string;
    answerContract?: string;
    deterministicFastPathUsed?: boolean;
    profileFactsReady?: boolean;
    promptContainsProfileContext?: boolean;
    routerDecision?: Record<string, unknown>;
  }): IntelligenceTrace;
  noteContext(entry: ContextInclusionEntry): IntelligenceTrace;
  stage(stage: string, ms: number): IntelligenceTrace;
  setProvider(info: { provider?: string; model?: string }): IntelligenceTrace;
  setLatency(info: { firstTokenMs?: number; firstUsefulMs?: number; totalMs?: number }): IntelligenceTrace;
  noteFallback(label: string): IntelligenceTrace;
  noteError(label: string): IntelligenceTrace;
  toRecord(): IntelligenceTraceRecord | null;
}

// A shared no-op so the disabled path allocates nothing per call.
const NOOP: IntelligenceTrace = {
  enabled: false,
  setCorrelation() { return NOOP; },
  setRouting() { return NOOP; },
  noteContext() { return NOOP; },
  stage() { return NOOP; },
  setProvider() { return NOOP; },
  setLatency() { return NOOP; },
  noteFallback() { return NOOP; },
  noteError() { return NOOP; },
  toRecord() { return null; },
};

let SEQ = 0;

class ActiveTrace implements IntelligenceTrace {
  readonly enabled = true;
  private rec: IntelligenceTraceRecord;

  constructor(query: string) {
    let hash = 'unknown';
    try { hash = createHash('sha256').update(String(query ?? '')).digest('hex').slice(0, 12); } catch { /* keep default */ }
    this.rec = {
      queryHash: hash,
      queryLength: typeof query === 'string' ? query.length : 0,
      contextInclusion: [],
      stages: [],
      fallbacksUsed: [],
      errors: [],
      flags: safeFlagSnapshot(),
      seq: SEQ++,
    };
  }

  setCorrelation(info: { requestId?: string; sessionId?: string; meetingId?: string; surface?: string; modeId?: string; retryCount?: number; aborted?: boolean; errorCategory?: string }): IntelligenceTrace {
    try {
      if (info.requestId !== undefined) this.rec.requestId = marker(info.requestId, 64);
      if (info.sessionId !== undefined) this.rec.sessionId = marker(info.sessionId, 64);
      if (info.meetingId !== undefined) this.rec.meetingId = marker(info.meetingId, 64);
      if (info.surface !== undefined) this.rec.surface = marker(info.surface, 24);
      if (info.modeId !== undefined) this.rec.modeId = marker(info.modeId, 40);
      if (typeof info.retryCount === 'number') this.rec.retryCount = numOrUndef(info.retryCount);
      if (typeof info.aborted === 'boolean') this.rec.aborted = info.aborted;
      if (info.errorCategory !== undefined) this.rec.errorCategory = marker(info.errorCategory, 32);
    } catch { /* never throw */ }
    return this;
  }

  setRouting(info: { mode?: string; source?: string; answerType?: string; answerContract?: string; deterministicFastPathUsed?: boolean; profileFactsReady?: boolean; promptContainsProfileContext?: boolean; routerDecision?: Record<string, unknown> }): IntelligenceTrace {
    try {
      this.rec.mode = marker(info.mode);
      this.rec.source = marker(info.source);
      this.rec.answerType = marker(info.answerType);
      this.rec.answerContract = marker(info.answerContract);
      if (typeof info.deterministicFastPathUsed === 'boolean') this.rec.deterministicFastPathUsed = info.deterministicFastPathUsed;
      if (typeof info.profileFactsReady === 'boolean') this.rec.profileFactsReady = info.profileFactsReady;
      if (typeof info.promptContainsProfileContext === 'boolean') this.rec.promptContainsProfileContext = info.promptContainsProfileContext;
      if (info.routerDecision && typeof info.routerDecision === 'object') {
        // Store only boolean / number / short-string marker fields.
        const d: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(info.routerDecision)) {
          if (typeof v === 'boolean' || typeof v === 'number') d[k] = v;
          else if (typeof v === 'string') d[k] = marker(v);
        }
        this.rec.routerDecision = d;
      }
    } catch { /* never throw */ }
    return this;
  }

  noteContext(entry: ContextInclusionEntry): IntelligenceTrace {
    try {
      if (this.rec.contextInclusion.length >= MAX_INCLUSION_ENTRIES) return this;
      const source = marker(entry.source, 40);
      if (!source || !SOURCE_LABEL_RE.test(source)) return this;
      this.rec.contextInclusion.push({
        source,
        trustLevel: marker(entry.trustLevel, 24),
        requested: Boolean(entry.requested),
        retrieved: Boolean(entry.retrieved),
        included: Boolean(entry.included),
        reason: marker(entry.reason),
        tokenEstimate: numOrUndef(entry.tokenEstimate),
        score: numOrUndef(entry.score),
      });
    } catch { /* never throw */ }
    return this;
  }

  stage(stage: string, ms: number): IntelligenceTrace {
    try {
      if (this.rec.stages.length >= MAX_STAGES) return this;
      const label = marker(stage, 40);
      if (!label) return this;
      this.rec.stages.push({ stage: label, ms: numOrUndef(ms) ?? 0 });
    } catch { /* never throw */ }
    return this;
  }

  setProvider(info: { provider?: string; model?: string }): IntelligenceTrace {
    try {
      this.rec.provider = marker(info.provider, 40);
      this.rec.model = marker(info.model, 40);
    } catch { /* never throw */ }
    return this;
  }

  setLatency(info: { firstTokenMs?: number; firstUsefulMs?: number; totalMs?: number }): IntelligenceTrace {
    try {
      this.rec.firstTokenMs = numOrUndef(info.firstTokenMs);
      this.rec.firstUsefulMs = numOrUndef(info.firstUsefulMs);
      this.rec.totalMs = numOrUndef(info.totalMs);
    } catch { /* never throw */ }
    return this;
  }

  noteFallback(label: string): IntelligenceTrace {
    try {
      const m = marker(label, 40);
      if (m && this.rec.fallbacksUsed.length < MAX_LIST) this.rec.fallbacksUsed.push(m);
    } catch { /* never throw */ }
    return this;
  }

  noteError(label: string): IntelligenceTrace {
    try {
      const m = marker(label, 80);
      if (m && this.rec.errors.length < MAX_LIST) this.rec.errors.push(m);
    } catch { /* never throw */ }
    return this;
  }

  toRecord(): IntelligenceTraceRecord {
    // Return a shallow copy with cloned arrays so a caller mutating the result can't
    // rewrite this trace's internal state (and, after commitTrace, the buffered
    // record). The record stays an immutable snapshot. (code-review 2026-06-12 LOW)
    return {
      ...this.rec,
      contextInclusion: this.rec.contextInclusion.map((e) => ({ ...e })),
      stages: this.rec.stages.map((s) => ({ ...s })),
      fallbacksUsed: [...this.rec.fallbacksUsed],
      errors: [...this.rec.errors],
      flags: { ...this.rec.flags },
      routerDecision: this.rec.routerDecision ? { ...this.rec.routerDecision } : undefined,
    };
  }
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function safeFlagSnapshot(): Record<string, boolean> {
  try { return intelligenceFlagSnapshot(); } catch { return {}; }
}

// Ring buffer of recent completed records for dev inspection / the debug command.
const RING_MAX = 200;
const ring: IntelligenceTraceRecord[] = [];

/**
 * Begin a trace for one answer. Returns a no-op (zero-cost) trace when the
 * `trace` flag is off, or an active recorder when on. Never throws.
 */
export function beginTrace(query: string): IntelligenceTrace {
  try {
    if (!isIntelligenceTraceEnabled()) return NOOP;
    return new ActiveTrace(query);
  } catch {
    return NOOP;
  }
}

/**
 * Commit a finished trace into the ring buffer (for "Show Intelligence Trace"
 * dev inspection). No-op for a disabled/no-op trace. Never throws.
 */
export function commitTrace(trace: IntelligenceTrace | null | undefined): void {
  try {
    if (!trace || !trace.enabled) return;
    const rec = trace.toRecord();
    if (!rec) return;
    ring.push(rec);
    if (ring.length > RING_MAX) ring.shift();
  } catch { /* never throw */ }
}

/** Recent committed traces (dev/diagnostics/tests). */
export function recentTraces(n = 50): IntelligenceTraceRecord[] {
  return ring.slice(-Math.max(0, n));
}

/** Clear the ring (tests). */
export function __resetTraceRing(): void {
  ring.length = 0;
}
