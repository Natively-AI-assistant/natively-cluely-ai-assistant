// electron/llm/FinalAnswerGenerationPolicy.ts
//
// Full-JIT final-answer law (2026-07-07).
// AOT/deterministic code may prepare evidence, metadata, prompt skeletons, and
// source policy. It may not produce a user-visible natural-language final answer.

export type FinalGenerationMode =
  | 'jit_llm'
  | 'jit_llm_repaired'
  | 'source_safe_refusal'
  | 'provider_error_no_answer';

export type ForbiddenFinalAnswerPath =
  | 'atomic_deterministic'
  | 'deterministic_fast_path'
  | 'aot_final_answer'
  | 'cached_final_answer'
  | 'template_final_answer';

export type FinalAnswerPolicyViolation =
  | 'forbidden_final_answer_path_detected'
  | 'provider_not_used_for_user_visible_answer'
  | 'exact_question_missing_from_final_prompt'
  | 'unknown_generation_mode';

export interface FinalAnswerGenerationTrace {
  finalGenerationMode: FinalGenerationMode;
  providerUsed: boolean;
  exactQuestionIncluded: boolean;
  usedDeterministicEvidenceSelection?: boolean;
  forbiddenFinalAnswerPath?: ForbiddenFinalAnswerPath;
  violation?: FinalAnswerPolicyViolation;
  sourceContractHonored?: boolean;
}

export interface FinalAnswerPolicyInput {
  mode: FinalGenerationMode | string;
  providerUsed: boolean;
  exactQuestionIncluded: boolean;
  userVisible: boolean;
  forbiddenFinalAnswerPath?: ForbiddenFinalAnswerPath | null;
  usedDeterministicEvidenceSelection?: boolean;
  sourceContractHonored?: boolean;
}

const ALLOWED_FINAL_MODES = new Set<FinalGenerationMode>([
  'jit_llm',
  'jit_llm_repaired',
  'source_safe_refusal',
  'provider_error_no_answer',
]);

export function isFinalGenerationMode(value: unknown): value is FinalGenerationMode {
  return typeof value === 'string' && ALLOWED_FINAL_MODES.has(value as FinalGenerationMode);
}

export function legacyFastPathToForbiddenPath(usedDeterministicFastPath?: boolean): ForbiddenFinalAnswerPath | null {
  return usedDeterministicFastPath ? 'deterministic_fast_path' : null;
}

export function finalAnswerRequiresProvider(mode: FinalGenerationMode): boolean {
  return mode === 'jit_llm' || mode === 'jit_llm_repaired';
}

export function evaluateFinalAnswerPolicy(input: FinalAnswerPolicyInput): FinalAnswerGenerationTrace {
  const mode = isFinalGenerationMode(input.mode) ? input.mode : 'provider_error_no_answer';
  const trace: FinalAnswerGenerationTrace = {
    finalGenerationMode: mode,
    providerUsed: input.providerUsed,
    exactQuestionIncluded: input.exactQuestionIncluded,
    usedDeterministicEvidenceSelection: input.usedDeterministicEvidenceSelection === true,
    sourceContractHonored: input.sourceContractHonored,
  };

  if (!input.userVisible) return trace;

  if (input.forbiddenFinalAnswerPath) {
    return {
      ...trace,
      forbiddenFinalAnswerPath: input.forbiddenFinalAnswerPath,
      violation: 'forbidden_final_answer_path_detected',
    };
  }

  if (!isFinalGenerationMode(input.mode)) {
    return { ...trace, violation: 'unknown_generation_mode' };
  }

  if (finalAnswerRequiresProvider(mode) && !input.providerUsed) {
    return { ...trace, violation: 'provider_not_used_for_user_visible_answer' };
  }

  if (finalAnswerRequiresProvider(mode) && !input.exactQuestionIncluded) {
    return { ...trace, violation: 'exact_question_missing_from_final_prompt' };
  }

  return trace;
}

export function assertNoForbiddenFinalAnswerPath(input: FinalAnswerPolicyInput): FinalAnswerGenerationTrace {
  const trace = evaluateFinalAnswerPolicy(input);
  if (trace.violation) {
    throw new Error(`[FinalAnswerGenerationPolicy] ${trace.violation}${trace.forbiddenFinalAnswerPath ? `:${trace.forbiddenFinalAnswerPath}` : ''}`);
  }
  return trace;
}

// ── Bypass telemetry (Stage 0) ───────────────────────────────────────────────
//
// A user-visible final answer that is emitted WITHOUT a provider dispatch is a
// full-JIT-law violation. This logger makes the violation observable (dev throw
// is done by assertNoForbiddenFinalAnswerPath; this is the always-on counter).
export interface ForbiddenFinalAnswerBypassEvent {
  questionHash: string;
  answerType: string;
  sourceOwner?: string;
  route?: string;
  finalGenerationMode: string;
  providerActuallyDispatched: boolean;
  emitSite?: string;
}

/**
 * Emit a single-line, PII-free `FORBIDDEN_FINAL_ANSWER_BYPASS` record. Never
 * throws; call from any final-emit site when a user-visible answer is produced
 * without a committed provider dispatch. `traceEnabled` gates the console line
 * so prod stays quiet unless the trace flag is on — the returned event is
 * always available for structured telemetry.
 */
export function logForbiddenFinalAnswerBypass(
  event: ForbiddenFinalAnswerBypassEvent,
  traceEnabled = false,
): ForbiddenFinalAnswerBypassEvent {
  if (traceEnabled) {
    try {
      // eslint-disable-next-line no-console
      console.warn('[FinalAnswerGenerationPolicy] FORBIDDEN_FINAL_ANSWER_BYPASS', {
        questionHash: event.questionHash,
        answerType: event.answerType,
        sourceOwner: event.sourceOwner,
        route: event.route,
        finalGenerationMode: event.finalGenerationMode,
        providerActuallyDispatched: event.providerActuallyDispatched,
        emitSite: event.emitSite,
      });
    } catch { /* logging must never throw */ }
  }
  return event;
}

export interface SessionWriteDecisionInput {
  finalGenerationMode: FinalGenerationMode;
  validationOk?: boolean;
  criticalViolations?: string[];
  sourceContractHonored?: boolean;
}

export type SessionWritePolicy = 'store_conversational_only' | 'store_non_authoritative' | 'do_not_store';

export interface SessionWriteDecision {
  policy: SessionWritePolicy;
  blockedFromSessionTracker: boolean;
  reason: string;
}

export function decideSessionWritePolicy(input: SessionWriteDecisionInput): SessionWriteDecision {
  if (input.finalGenerationMode === 'provider_error_no_answer') {
    return { policy: 'do_not_store', blockedFromSessionTracker: true, reason: 'provider_error_no_answer' };
  }
  if (input.validationOk === false && (input.criticalViolations?.length || 0) > 0) {
    return { policy: 'do_not_store', blockedFromSessionTracker: true, reason: `critical_validation_failed:${input.criticalViolations?.join(',')}` };
  }
  if (input.sourceContractHonored === false) {
    return { policy: 'do_not_store', blockedFromSessionTracker: true, reason: 'source_contract_not_honored' };
  }
  return { policy: 'store_conversational_only', blockedFromSessionTracker: false, reason: 'valid_non_authoritative_conversation' };
}
