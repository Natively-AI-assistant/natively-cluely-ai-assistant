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
  rejections?: Array<{ sourceId: string; reason: string }>;
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
  | 'PARTIAL_SUPPORT' | 'CLARIFICATION' | 'CONFLICT';

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
}

// ── redaction ───────────────────────────────────────────────────────────────

const CONTENT_KEYS = new Set(['content', 'text', 'evidenceText', 'prompt', 'answer', 'snippet']);

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
          out[`${k}Length`] = typeof val === 'string' ? val.length : 0;
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

  cmp('resolvedQuestion', legacy.resolvedQuestion, v3.resolvedQuestion);
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
