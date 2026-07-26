// electron/llm/contextRoute.ts
//
// THE unified context-routing contract (REPORT_TO_CHATGPT Phase 6). Both the
// app-layer prompt assembly (WhatToAnswerLLM/PromptAssembler) and the premium
// knowledge layer should derive their include/exclude decisions from THIS, so
// the two pipelines can no longer silently diverge on what context a given
// answer type may see.
//
// It is a PURE, deterministic projection of the AnswerPlan — no I/O, no LLM, no
// embeddings — so it is cheap to call on the live path and trivially testable.
// The plan already carries requiredContextLayers / forbiddenContextLayers; this
// module turns that into an explicit, self-describing route with a machine- and
// human-readable REASON per layer (for safe debug metadata) and per-layer token
// budgets, and it provides the single `isLayerAllowed` predicate the prompt
// builders call so the leak rules (coding excludes resume/JD/negotiation, etc.)
// are enforced in ONE place.

import type { AnswerPlan, ContextLayer } from './AnswerPlanner';

export interface ContextRouteLayer {
  layer: ContextLayer;
  selected: boolean;
  /** Short machine reason, e.g. 'required_by_answer_type' | 'forbidden_by_answer_type' | 'not_relevant'. */
  reason: string;
  /** Soft per-layer token budget (0 when excluded). */
  tokenBudget: number;
}

export interface ContextRoute {
  answerType: AnswerPlan['answerType'];
  selectedLayers: ContextLayer[];
  excludedLayers: ContextLayer[];
  /** Per-layer detail for debug metadata (never carries raw content). */
  layers: ContextRouteLayer[];
  /** Hard ceiling on the assembled prompt's context tokens. */
  maxTotalPromptTokens: number;
}

// Every context layer the router knows about. The route classifies each as
// selected/excluded so debug metadata is exhaustive (no silent "unknown" gaps).
const ALL_LAYERS: ContextLayer[] = [
  'stable_identity', 'resume', 'jd', 'custom_context', 'ai_persona',
  'negotiation', 'reference_files', 'live_transcript', 'prior_assistant_responses',
  'active_mode', 'screen_context', 'preferred_language',
];

// Default soft budgets (tokens) per layer when selected. Conservative — the
// assembler still enforces its own global cap; these just bias what to keep
// under pressure (profile facts > verbose mode context for factual recall).
const LAYER_BUDGET: Partial<Record<ContextLayer, number>> = {
  stable_identity: 200,
  resume: 1200,
  jd: 800,
  custom_context: 600,
  ai_persona: 200,
  negotiation: 600,
  reference_files: 1200,
  live_transcript: 1500,
  prior_assistant_responses: 600,
  active_mode: 800,
  screen_context: 1200,
  preferred_language: 50,
};

/**
 * Build the deterministic context route for a plan. Selected = in the plan's
 * requiredContextLayers AND not in forbiddenContextLayers (forbidden always
 * wins — the leak rules are non-negotiable). Everything else is excluded with
 * a reason so the route is a complete, auditable description.
 */
export const buildContextRoute = (plan: AnswerPlan): ContextRoute => {
  const required = new Set(plan.requiredContextLayers);
  const forbidden = new Set(plan.forbiddenContextLayers);

  const documentGroundedCustomModeActive = plan.documentGroundedCustomModeActive === true;
  const layers: ContextRouteLayer[] = ALL_LAYERS.map((layer) => {
    if (documentGroundedCustomModeActive && layer === 'reference_files') {
      return { layer, selected: true, reason: 'document_grounded_custom_mode_primary_source', tokenBudget: LAYER_BUDGET[layer] ?? 1200 };
    }
    if (documentGroundedCustomModeActive
        && (layer === 'resume' || layer === 'jd' || layer === 'negotiation' || layer === 'ai_persona')
        && !required.has(layer)) {
      return { layer, selected: false, reason: 'suppressed_by_document_grounded_custom_mode', tokenBudget: 0 };
    }
    if (forbidden.has(layer)) {
      return { layer, selected: false, reason: 'forbidden_by_answer_type', tokenBudget: 0 };
    }
    if (required.has(layer)) {
      return { layer, selected: true, reason: 'required_by_answer_type', tokenBudget: LAYER_BUDGET[layer] ?? 400 };
    }
    return { layer, selected: false, reason: 'not_required_by_answer_type', tokenBudget: 0 };
  });

  const selectedLayers = layers.filter(l => l.selected).map(l => l.layer);
  const excludedLayers = layers.filter(l => !l.selected).map(l => l.layer);
  const maxTotalPromptTokens = Math.max(
    1200,
    layers.reduce((sum, l) => sum + l.tokenBudget, 0) + 1200, // + headroom for system prompt/question
  );

  return { answerType: plan.answerType, selectedLayers, excludedLayers, layers, maxTotalPromptTokens };
};

/**
 * The single predicate the prompt builders call to decide whether a context
 * layer may be included for this plan. Forbidden always wins. Use this instead
 * of re-deriving include/exclude logic per call site.
 */
export const isLayerAllowed = (plan: AnswerPlan, layer: ContextLayer): boolean => {
  if (plan.documentGroundedCustomModeActive === true) {
    if (layer === 'reference_files') return true;
    if ((layer === 'resume' || layer === 'jd' || layer === 'negotiation' || layer === 'ai_persona')
        && !plan.requiredContextLayers.includes(layer)) return false;
  }
  return !plan.forbiddenContextLayers.includes(layer);
};

/**
 * Compact, PII-free summary of the route for safe debug metadata / telemetry.
 * Layer NAMES and counts only — never content.
 */
export const summarizeContextRoute = (route: ContextRoute): Record<string, unknown> => ({
  answerType: route.answerType,
  selected: route.selectedLayers,
  excluded: route.excludedLayers,
  maxTotalPromptTokens: route.maxTotalPromptTokens,
});
