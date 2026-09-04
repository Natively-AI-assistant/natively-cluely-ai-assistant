// electron/context-intelligence/observability/answer-trace.ts
//
// One structured trace per turn.
//
// WHY THIS IS THE FIRST ARCHITECTURAL DELIVERABLE
// The brief (§25.3) puts surface migration first. That is not executable here:
// of the three legacy decision layers, only ONE produces a structured object
// (resolveCanonicalTurn, with a single call site). The other two produce nothing
// comparable. So shadow mode (§25.2) has nothing to diff and cross-surface
// parity (§21.4) has nothing to compare — which is precisely how previous fix
// rounds passed their own tests without improving production behaviour.
//
// Everything downstream — parity, shadow mode, acceptance gates, legacy removal
// — depends on this existing FIRST, retrofitted to the legacy layers.
//
// PRIVACY: this trace carries evidence IDENTITY, never evidence CONTENT.
// See docs/context-intelligence-v3/12_ROLLOUT_AND_ROLLBACK.md §4.

import type {
  AnswerSurface, GroundingPolicy, QuestionType, RetrievalPath,
  Answerability, SourceType, EvidenceRejectionReason, EvidenceScope,
} from '../contracts/types';

export interface SourceTrace {
  sourceType: SourceType;
  sourceId: string;
  versionId: string;
  scopeId: string;
}

export interface EvidenceTrace {
  evidenceId: string;
  sourceType: SourceType;
  sourceId: string;
  versionId: string;
  scopeId: string;
  finalScore: number;
  semanticScore?: number;
  keywordScore?: number;
  answerabilityScore?: number;
  /** Length only — never the text. */
  contentLength: number;
}

export interface RejectedEvidenceTrace extends EvidenceTrace {
  reason: EvidenceRejectionReason;
}

export interface RetrievalAttemptTrace {
  attempt: 1 | 2;
  strategy: string;
  queries: string[];
  candidateCount: number;
  admittedAfterScopeFilter: number;
  rejectedByScopeFilter: number;
  /**
   * WHAT was rejected and why, not merely how many.
   *
   * The count alone cannot distinguish "the superseded résumé was retrieved and
   * correctly rejected" from "nothing was rejected because the stale document
   * was never in the corpus". A gate written against the count reported a clean
   * pass in the second case for the entire mission. Reasons make the difference
   * observable — in this trace and in production telemetry.
   */
  rejections?: Array<{ sourceId: string; reason: string; documentTitle?: string; documentStatus?: string }>;
  durationMs: number;
  failed?: string;
}

export interface ClaimTrace {
  claimId: string;
  claimType: string;
  support: string;
  evidenceIds: string[];
  disclosure: string;
  action: string;
}

export interface ProviderAttemptTrace {
  provider: string;
  model: string;
  ok: boolean;
  ttfbMs?: number;
  errorCode?: string;
}

export type TraceStatus = 'COMPLETED' | 'SUPERSEDED' | 'CANCELLED' | 'FAILED';

export type FallbackUsed =
  | 'NONE' | 'GENERAL_KNOWLEDGE' | 'STRICT_NOT_FOUND'
  | 'PARTIAL_SUPPORT' | 'CLARIFICATION' | 'CONFLICT'
  /** A document-specific request whose evidence was empty/unsupporting — a
   *  retrieval miss, distinct from an intended general-knowledge answer
   *  (deep-run 2, issue 14). */
  | 'DOCUMENT_FACT_NOT_FOUND';

export interface AnswerTrace {
  requestId: string;
  requestSequence: number;
  scope: EvidenceScope;
  surface: AnswerSurface;

  originalQuestion: string;
  resolvedQuestion: string;
  resolutionConfidence: number;

  modeId: string;
  modePolicyVersion: string;

  questionTypes: QuestionType[];
  groundingPolicy: GroundingPolicy;

  authorizedSources: SourceTrace[];
  prohibitedSources: SourceTrace[];

  /**
   * The source types the turn PLANNED to read, before any retrieval.
   *
   * Contamination cannot be measured against `authorizedSources`: that field is
   * derived from the evidence that was accepted, so comparing accepted evidence
   * to it is tautological and scored a clean corpus at 45.2% contaminated. The
   * plan is the only checkable denominator, because it is fixed before anything
   * is retrieved. Optional so a trace built by an older caller still typechecks
   * — rollout-metrics treats a missing value as "not checkable", never as zero.
   */
  plannedSourceTypes?: SourceType[];

  retrievalPath: RetrievalPath;
  retrievalAttempts: RetrievalAttemptTrace[];

  acceptedEvidence: EvidenceTrace[];
  rejectedEvidence: RejectedEvidenceTrace[];

  answerability: Answerability;
  claimPlan: ClaimTrace[];
  fallbackUsed: FallbackUsed;

  promptTokenEstimate: number;

  latency: {
    normalizationMs: number;
    questionResolutionMs: number;
    policyResolutionMs: number;
    classificationMs: number;
    retrievalMs: number;
    rerankingMs: number;
    evidenceEvaluationMs: number;
    promptCompositionMs: number;
    providerTtfbMs: number;
    totalMs: number;
  };

  providerAttempts: ProviderAttemptTrace[];
  status: TraceStatus;
  errorCodes: string[];

  /** Which implementation produced this turn. Lets a shadow run diff
   *  legacy-vs-v3 on identical inputs. */
  engine: 'legacy' | 'v3';

  /**
   * Follow-up referent resolution outcome (context-debug logging, 2026-08-01).
   * Observability only — records what the resolver DID, plus the state
   * snapshot it resolved against (identity-scale strings, never content).
   * Optional so traces from older builders still typecheck.
   */
  referentResolution?: {
    applied: boolean;
    referent?: string;
    reason?: string;
    activePerson?: string;
    activeTopic?: string;
    previousQuestion?: string;
  };
}

// ── redaction ───────────────────────────────────────────────────────────────

// These fields can all contain user, meeting, document, or screen-derived text.
// Keep this list deliberately broader than the current trace schema: redactTrace
// is also used as the last line of defence when callers attach diagnostic data.
const CONTENT_KEYS = new Set([
  'content', 'text', 'evidenceText', 'prompt', 'answer', 'snippet',
  'originalQuestion', 'resolvedQuestion', 'previousQuestion',
  'question', 'original', 'resolved', 'currentRequest', 'systemPrompt', 'userPrompt',
  'query', 'queries', 'referent', 'activePerson', 'activeTopic',
  'transcript', 'manualContext', 'referenceContext', 'history', 'instructions',
  'dom', 'ocr', 'preview', 'finalAnswer', 'url', 'documentTitle',
]);

function contentLength(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) {
    let total = 0;
    for (const item of value) total += contentLength(item);
    return total;
  }
  if (value && typeof value === 'object') {
    let total = 0;
    for (const item of Object.values(value as Record<string, unknown>)) {
      total += contentLength(item);
    }
    return total;
  }
  return 0;
}

/**
 * Strip anything that could carry private source text.
 *
 * Applied at construction, not at the sink: a trace that never HOLDS content
 * cannot leak it through a log line, a crash dump, or a future telemetry
 * exporter written by someone who did not read this file.
 */
export function redactTrace<T extends Record<string, unknown>>(obj: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (CONTENT_KEYS.has(k)) {
          out[`${k}Length`] = contentLength(val);
          if (Array.isArray(val)) out[`${k}Count`] = val.length;
          continue;
        }
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(obj) as T;
}

// ── comparison (shadow mode) ────────────────────────────────────────────────

export interface TraceDivergence {
  field: string;
  legacy: unknown;
  v3: unknown;
}

/**
 * Compare the DECISION fields of two traces for the same request.
 *
 * Deliberately ignores latency, provider attempts and token estimates: shadow
 * mode exists to prove the two engines make the same DECISION, and comparing
 * answer text would require duplicate paid generation for a weaker signal.
 */
export function compareDecisions(legacy: AnswerTrace, v3: AnswerTrace): TraceDivergence[] {
  const out: TraceDivergence[] = [];
  const cmp = (field: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field, legacy: a, v3: b });
  };

  // Persisted traces intentionally replace questions with lengths. Compare raw
  // text while both inputs are live, otherwise compare the privacy-safe length
  // signal instead of manufacturing a divergence between raw and redacted data.
  const comparableQuestion = (t: AnswerTrace, key: 'resolvedQuestion') => {
    const raw = (t as unknown as Record<string, unknown>)[key];
    if (typeof raw === 'string') return { length: raw.length, raw };
    return { length: (t as unknown as Record<string, unknown>)[`${key}Length`] ?? null };
  };
  const legacyQuestion = comparableQuestion(legacy, 'resolvedQuestion');
  const v3Question = comparableQuestion(v3, 'resolvedQuestion');
  if ('raw' in legacyQuestion && 'raw' in v3Question) {
    if (legacyQuestion.raw !== v3Question.raw) {
      // Report the divergence without copying either private question into an
      // observability object that may later be logged or exported.
      out.push({
        field: 'resolvedQuestion',
        legacy: { length: legacyQuestion.length },
        v3: { length: v3Question.length },
      });
    }
  } else {
    cmp('resolvedQuestion', legacyQuestion.length, v3Question.length);
  }
  cmp('modeId', legacy.modeId, v3.modeId);
  cmp('questionTypes', [...legacy.questionTypes].sort(), [...v3.questionTypes].sort());
  cmp('groundingPolicy', legacy.groundingPolicy, v3.groundingPolicy);
  cmp('retrievalPath', legacy.retrievalPath, v3.retrievalPath);
  cmp('answerability', legacy.answerability, v3.answerability);
  cmp('fallbackUsed', legacy.fallbackUsed, v3.fallbackUsed);

  const ids = (t: AnswerTrace) => t.authorizedSources.map((s) => `${s.sourceType}:${s.sourceId}@${s.versionId}`).sort();
  cmp('authorizedSources', ids(legacy), ids(v3));

  const ev = (t: AnswerTrace) => t.acceptedEvidence.map((e) => e.evidenceId).sort();
  cmp('acceptedEvidence', ev(legacy), ev(v3));

  return out;
}

/** True when the two engines made an identical decision. */
export const decisionsMatch = (legacy: AnswerTrace, v3: AnswerTrace): boolean =>
  compareDecisions(legacy, v3).length === 0;
