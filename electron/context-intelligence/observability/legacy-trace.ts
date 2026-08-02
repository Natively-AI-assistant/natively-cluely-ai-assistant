// electron/context-intelligence/observability/legacy-trace.ts
//
// Trace emission for the LEGACY decision layers.
//
// WHY THIS COMES BEFORE ANY SURFACE MIGRATION
// The brief (§25.3) migrates surfaces first. That is not executable here: of the
// three legacy decision layers only ONE produces a structured object
// (resolveCanonicalTurn, single call site); the other two produce nothing
// comparable. So shadow mode (§25.2) has nothing to diff and cross-surface
// parity (§21.4) has nothing to compare — which is exactly how previous fix
// rounds passed their own tests without improving production behaviour.
//
// This module makes the legacy path observable so the V3 path can later be
// proven equivalent BEFORE it is switched on.
//
// THREE HARD CONSTRAINTS, because this instruments live answer paths:
//   1. It must never change an answer.       → every entry point is wrapped and
//                                              swallows its own errors.
//   2. It must cost ~nothing when disabled.  → one boolean check, no allocation.
//   3. It must never carry source content.   → identity, lengths and scores only.
//
// NOTE ON THE FLAG: this is OBSERVABILITY, not behaviour, so a default-off flag
// here is not the F5 anti-pattern. F5 is about *behavioural* components shipping
// dev-only. Nothing about the answer changes when this is on or off.

import type {
  AnswerTrace, EvidenceTrace, TraceStatus, FallbackUsed,
} from './answer-trace';
import { redactTrace } from './answer-trace';
import type {
  AnswerSurface, GroundingPolicy, QuestionType, RetrievalPath, Answerability, EvidenceScope,
} from '../contracts/types';

const ENV_KEY = 'NATIVELY_CI_V3_TRACE';

export function isLegacyTraceEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = env[ENV_KEY];
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'on' || s === 'yes';
}

export interface TraceSink {
  write(trace: AnswerTrace): void;
}

/** Bounded ring buffer. A trace sink that grows without limit on a long meeting
 *  would be its own production incident. */
export class MemoryTraceSink implements TraceSink {
  private readonly buf: AnswerTrace[] = [];
  constructor(private readonly capacity = 200) {}
  write(t: AnswerTrace): void {
    this.buf.push(t);
    if (this.buf.length > this.capacity) this.buf.shift();
  }
  all(): AnswerTrace[] { return [...this.buf]; }
  byRequestId(id: string): AnswerTrace | undefined { return this.buf.find((t) => t.requestId === id); }
  clear(): void { this.buf.length = 0; }
  get size(): number { return this.buf.length; }
}

// Sink holder on globalThis (12 dist bundles): identical shape to the
// rollout-counters incident — a harness importing this module read an EMPTY
// ring while turns were being traced into another bundle's copy, so the F2
// evidence this module exists to collect silently read as "no traces".
const SINK_KEY = '__nativelyLegacyTraceSinkV1__';
function sinkSlot(): { sink: TraceSink } {
  const g = globalThis as unknown as Record<string, { sink: TraceSink } | undefined>;
  if (!g[SINK_KEY]) g[SINK_KEY] = { sink: new MemoryTraceSink() };
  return g[SINK_KEY]!;
}
export function setTraceSink(s: TraceSink): void { sinkSlot().sink = s; }
export function getTraceSink(): TraceSink { return sinkSlot().sink; }

/**
 * What a legacy layer can actually tell us.
 *
 * Everything is optional BY DESIGN. Layer C (assist, clarify, brainstorm,
 * code-hint, manual answer) constructs no source authority at all, so its trace
 * legitimately has no authorized sources and no grounding policy. Recording that
 * absence is the point — it is the evidence for F2, not a gap to be papered over
 * with a plausible default.
 */
export interface LegacyTraceInput {
  requestId: string;
  requestSequence?: number;
  surface: AnswerSurface;
  scope: EvidenceScope;

  originalQuestion?: string;
  resolvedQuestion?: string;

  modeId?: string;
  modePolicyVersion?: string;

  questionTypes?: QuestionType[];
  groundingPolicy?: GroundingPolicy;

  authorizedSources?: Array<{ sourceType: string; sourceId: string; versionId?: string; scopeId?: string }>;
  acceptedEvidence?: Array<Partial<EvidenceTrace> & { evidenceId: string }>;

  retrievalPath?: RetrievalPath;
  answerability?: Answerability;
  fallbackUsed?: FallbackUsed;

  status?: TraceStatus;
  errorCodes?: string[];
  totalMs?: number;

  /** Free-form marker for WHICH legacy code path produced this, so two traces
   *  for the same surface can be told apart during the dedup work. */
  legacyPath?: string;
}

/** Sentinel for "this layer genuinely has no policy", distinct from "unknown". */
export const NO_POLICY = 'legacy_none' as const;

function build(input: LegacyTraceInput): AnswerTrace {
  return {
    requestId: input.requestId,
    requestSequence: input.requestSequence ?? 0,
    scope: input.scope,
    surface: input.surface,

    originalQuestion: input.originalQuestion ?? '',
    resolvedQuestion: input.resolvedQuestion ?? input.originalQuestion ?? '',
    resolutionConfidence: input.resolvedQuestion ? 1 : 0,

    modeId: input.modeId ?? NO_POLICY,
    modePolicyVersion: input.modePolicyVersion ?? NO_POLICY,

    questionTypes: input.questionTypes ?? [],
    // 'OPEN_KNOWLEDGE' is NOT a safe default here — it would misrepresent an
    // ungrounded surface as a deliberate policy choice. Layer C has no policy,
    // and the trace says so.
    groundingPolicy: input.groundingPolicy ?? (NO_POLICY as unknown as GroundingPolicy),

    authorizedSources: (input.authorizedSources ?? []).map((s) => ({
      sourceType: s.sourceType as EvidenceTrace['sourceType'],
      sourceId: s.sourceId,
      versionId: s.versionId ?? 'unknown',
      scopeId: s.scopeId ?? 'unknown',
    })),
    prohibitedSources: [],

    retrievalPath: input.retrievalPath ?? ('GROUNDED' as RetrievalPath),
    retrievalAttempts: [],

    acceptedEvidence: (input.acceptedEvidence ?? []).map((e) => ({
      evidenceId: e.evidenceId,
      sourceType: (e.sourceType ?? 'REFERENCE_FILE') as EvidenceTrace['sourceType'],
      sourceId: e.sourceId ?? 'unknown',
      versionId: e.versionId ?? 'unknown',
      scopeId: e.scopeId ?? 'unknown',
      finalScore: e.finalScore ?? 0,
      semanticScore: e.semanticScore,
      keywordScore: e.keywordScore,
      answerabilityScore: e.answerabilityScore,
      contentLength: e.contentLength ?? 0,
    })),
    rejectedEvidence: [],

    answerability: input.answerability ?? ('NONE' as Answerability),
    claimPlan: [],
    fallbackUsed: input.fallbackUsed ?? 'NONE',

    promptTokenEstimate: 0,
    latency: {
      normalizationMs: 0, questionResolutionMs: 0, policyResolutionMs: 0, classificationMs: 0,
      retrievalMs: 0, rerankingMs: 0, evidenceEvaluationMs: 0, promptCompositionMs: 0,
      providerTtfbMs: 0, totalMs: input.totalMs ?? 0,
    },
    providerAttempts: [],
    status: input.status ?? 'COMPLETED',
    errorCodes: input.errorCodes ?? [],
    engine: 'legacy',
  };
}

/**
 * Record a legacy turn. NEVER THROWS.
 *
 * This runs inside live answer paths. A defect in observability must not be able
 * to break an answer, so every failure is swallowed — the worst case is a
 * missing trace, never a missing answer.
 */
export function recordLegacyTurn(input: LegacyTraceInput): AnswerTrace | null {
  if (!isLegacyTraceEnabled()) return null;
  try {
    const trace = build(input);
    // Redact at CONSTRUCTION, not at the sink: a trace that never holds content
    // cannot leak it through a log line, a crash dump, or a future exporter
    // written by someone who did not read this file.
    const safe = redactTrace(trace as unknown as Record<string, unknown>) as unknown as AnswerTrace;
    if (input.legacyPath) (safe as unknown as Record<string, unknown>).legacyPath = input.legacyPath;
    // Phase 10 §4: the same counters see BOTH engines, which is what makes the
    // §3 stage exits comparable — "within baseline" needs the baseline measured
    // by the same instrument, not a different one.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('./rollout-metrics').recordTurnMetrics(safe);
    } catch { /* observability only */ }
    sinkSlot().sink.write(safe);
    return safe;
  } catch {
    return null;
  }
}

/** Wrap a value-producing call so instrumentation can never change behaviour. */
export function traceSafely(fn: () => void): void {
  try { fn(); } catch { /* observability must not break answers */ }
}
