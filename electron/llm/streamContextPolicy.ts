// electron/llm/streamContextPolicy.ts
//
// D1 fix (PROFILE_INTELLIGENCE_RESEARCH_AND_REDESIGN.md §15 R1): make the
// deterministic routing decision AUTHORITATIVE at the central execution
// choke-point (LLMHelper._streamChatInner).
//
// The spec (§4) requires the Profile Intelligence Router to run before final
// prompt assembly and the model to receive ONLY the context the answer type
// allows. Today the two in-stream injection sites in _streamChatInner —
//   (1) the knowledge-mode intercept (injects the user's profile contextBlock),
//   (2) the active-mode injection (retrieves the mode's custom context),
// never see the AnswerPlan, so exclusion depends entirely on each *caller*
// remembering to set the ignoreKnowledgeMode/skipModeInjection booleans, and the
// mode-injection site passes a HARDCODED 'general_meeting_answer' answer type
// that defeats the custom-context sensitivity scoping for every other answer
// type.
//
// This module is the single, pure, testable policy the execution path consults.
// No LLM, no I/O.

import type { AnswerType, ContextLayer } from './AnswerPlanner';

/**
 * Optional routing info threaded from a caller that already computed an
 * AnswerPlan. When absent, the execution path keeps its legacy behavior
 * (default answer type, no extra exclusion) so no existing caller breaks.
 */
export interface StreamRouteOptions {
  /** The plan's answer type — drives custom-context sensitivity scoping. */
  answerType?: AnswerType;
  /** The plan's forbidden context layers — the authoritative exclusion list. */
  forbiddenContextLayers?: ContextLayer[];
  /**
   * Round-7 Failure-2: the previous assistant answer, supplied by the caller
   * (the chat handler has it via getLastAssistantMessage()). For a short/
   * anaphoric doc-grounded follow-up the retriever extracts this text's
   * high-signal entities and appends them to the RETRIEVAL query only (never
   * shown to the model), so "What processor controls it?" can still find the
   * fact about the previously-named subject. Absent → legacy behavior.
   */
  followUpReferentHint?: string;
}

/**
 * Should the knowledge-mode intercept be allowed to inject the user's profile
 * context (resume facts, JD, persona/system-prompt injection) for this stream?
 *
 * The authoritative signal that an answer gets NO profile is "the `resume` layer
 * is forbidden" — this is exactly what marks the generic coding / technical /
 * sales / lecture answer types (AnswerPlanner.forbiddenLayersFor). Profile answer
 * types (identity, skills, projects, jd-fit, behavioral) only forbid narrower
 * layers (jd, negotiation, reference_files) while keeping `resume`, so they stay
 * allowed. Mirrors WhatToAnswerLLM's `!isLayerAllowed(plan,'resume')` gate.
 *
 * Absent route options → true (legacy behavior; the orchestrator still self-gates
 * via applyFullProfileGrounding, this is defence-in-depth on top of that).
 */
export function profileInterceptAllowedByRoute(route?: StreamRouteOptions): boolean {
  const forbidden = route?.forbiddenContextLayers;
  if (!forbidden || forbidden.length === 0) return true;
  return !forbidden.includes('resume');
}

/**
 * The answer type the active-mode custom-context retriever should be scoped by.
 * Uses the real plan answer type when available so sensitive custom-context
 * chunks are gated correctly (only a negotiation answer may surface them);
 * defaults to the conservative 'general_meeting_answer' when no plan was passed
 * (matches the prior hardcoded value, so legacy callers are unchanged).
 */
export function modeAnswerType(route?: StreamRouteOptions): AnswerType {
  const answerType = route?.answerType;
  if (answerType === 'definitional_answer'
      || answerType === 'list_answer'
      || answerType === 'exact_numeric_answer'
      || answerType === 'document_absent_fact_refusal'
      || answerType === 'document_followup_answer') {
    // Execution paths that predate these document-specific subtypes still gate
    // mode injection on lecture_answer as the mode-scoped document lane. Retrieval
    // receives the precise subtype via routeOptions; mode scoping remains enabled
    // by normalizing the active-mode injection answer type to lecture_answer.
    return 'lecture_answer';
  }
  return answerType ?? 'general_meeting_answer';
}
