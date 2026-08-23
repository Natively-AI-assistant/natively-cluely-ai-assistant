// electron/intelligence/knowledgeOrchestratorGate.ts
//
// Phase 6 Slice 4 (context-rebuild, docs/context-rebuild/05_MIGRATION_PLAN.md
// "Slice 4" item 3): the type barrier at the `premium` submodule boundary
// (target arch §5, review Q2's required-not-optional item).
//
// `LLMHelper.getKnowledgeOrchestrator(): any` (electron/LLMHelper.ts:1842)
// is an unguarded, `any`-typed accessor with 19 real call sites (all in
// ipcHandlers.ts, grep-confirmed) — some of which are turn-scoped
// read/inject operations (the ones this barrier targets) and some of which
// are admin operations (delete/ingest) genuinely unrelated to any specific
// turn's answer-type policy. Changing `getKnowledgeOrchestrator()`'s own
// signature to require a `CanonicalTurn` would force EVERY one of those 19
// sites to supply one, including the admin ones that have none — a
// consequential, all-or-nothing migration this pass does not attempt (see
// 05_MIGRATION_PLAN.md's Slice 4 STATUS note for the reasoning).
//
// Instead, this module is a NEW, ADDITIVE, parallel path: any call site
// that wants to read/inject profile-flavored content and be COMPILE-TIME
// FORCED to consult the gate calls `processQuestionGated(...)` here, which
// requires a `CanonicalTurn` (or the narrower `AllowedSourcesProjection`)
// parameter — a call site omitting it cannot compile. The existing
// `getKnowledgeOrchestrator()` accessor and its 19 call sites are
// untouched; adoption of this gated path is incremental, not forced by
// this change.

import type { CanonicalTurn } from '../llm/resolveCanonicalTurn';
import { isLayerAllowed } from '../llm/contextRoute';

/**
 * The narrower projection target arch §5 names as the alternative to
 * threading a full `CanonicalTurn` — just the two source families
 * `KnowledgeOrchestrator`'s injection decision actually branches on.
 */
export interface AllowedSourcesProjection {
  resumeAllowed: boolean;
  jdAllowed: boolean;
}

export function projectAllowedSources(canonicalTurn: CanonicalTurn): AllowedSourcesProjection {
  return {
    resumeAllowed: isLayerAllowed(canonicalTurn.answerPlan, 'resume'),
    jdAllowed: isLayerAllowed(canonicalTurn.answerPlan, 'jd'),
  };
}

function isCanonicalTurn(value: CanonicalTurn | AllowedSourcesProjection): value is CanonicalTurn {
  return 'answerPlan' in value;
}

/** Minimal structural type for the orchestrator method this gate wraps — avoids importing the full class just for its shape. */
export interface QuestionProcessor {
  processQuestion(question: string): Promise<unknown>;
}

export interface GatedProcessQuestionResult {
  /** True when the call was short-circuited to bypass — resume was forbidden for this turn's answer type. */
  bypassed: boolean;
  reason?: string;
  /** Only set when NOT bypassed. */
  result: unknown | null;
}

/**
 * The one entry point a NEW premium consumer should call to read/inject
 * profile content for a turn — requires a `CanonicalTurn` (or the narrower
 * `AllowedSourcesProjection`), so a call site that omits it cannot compile.
 * Short-circuits to bypass (never calls the real orchestrator) when
 * `isLayerAllowed` forbids the resume layer for this turn's answer type —
 * this is the SAME decision Slice 4 item 2 will make
 * `KnowledgeOrchestrator.processQuestion` apply internally once its
 * bypass/seed/inject logic is replaced; this wrapper makes the same
 * decision available today, additively, without that internal rewrite.
 */
export async function processQuestionGated(
  orchestrator: QuestionProcessor,
  question: string,
  allowed: CanonicalTurn | AllowedSourcesProjection,
): Promise<GatedProcessQuestionResult> {
  const projection = isCanonicalTurn(allowed) ? projectAllowedSources(allowed) : allowed;
  if (!projection.resumeAllowed) {
    return { bypassed: true, reason: 'resume forbidden for this answer type (isLayerAllowed)', result: null };
  }
  // Note: `assertLayerUsageAllowedOrThrow` (contextRoute.ts, item 4) is NOT
  // called here — it would be a no-op tautology at this exact point (this
  // function already gates on the identical isLayerAllowed condition one
  // line above, so the assertion could never fire in either branch). That
  // assertion belongs at REAL retrieval-execution sites once Slice 4's full
  // UnifiedRetriever pipeline exists, as a confirming check that a layer
  // actually used matches what was authorized — not duplicated here.
  const result = await orchestrator.processQuestion(question);
  return { bypassed: false, result };
}
