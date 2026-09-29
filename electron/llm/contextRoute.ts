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
import { isVerificationModeEnabled } from '../intelligence/intelligenceFlags';

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
  // RC3 fix (Phase 6 Slice 2, context-rebuild, 2026-07-25): `prior_assistant_responses`
  // flips to FAIL-CLOSED specifically — not a blanket flip across every layer
  // (target arch §5's explicit rejection of an unaudited ~15-layer/~30-answerType
  // blast radius). Before this fix, any answerType that named this layer in
  // NEITHER forbiddenContextLayers NOR requiredContextLayers fell through to
  // this function's general fail-open default below, silently ALLOWING an
  // unrelated prior turn's content into the prompt. Every answerType that
  // legitimately needs it (project_followup_answer; follow_up_answer when NOT
  // document-grounded) already lists it in requiredContextLayers
  // (AnswerPlanner.ts's requiredLayersFor), so this only blocks the previously-
  // silent cases. This also aligns isLayerAllowed with buildContextRoute below,
  // which was ALREADY fail-closed by default for every layer (a layer must be
  // in requiredContextLayers to be selected) — the two routing functions no
  // longer silently diverge for this layer, closing exactly the class of gap
  // this module's own header comment warns against ("the two pipelines can no
  // longer silently diverge on what context a given answer type may see").
  if (layer === 'prior_assistant_responses' && !plan.requiredContextLayers.includes(layer)) {
    return false;
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

/**
 * Phase 6 Slice 4 (context-rebuild, docs/context-rebuild/05_MIGRATION_PLAN.md
 * "Slice 4" item 4): the required (not optional) dev-mode CI assertion
 * replacing `assertNoAuthorityContradiction` (deleted Slice 0, A6— see
 * electron/intelligence/context-os/integration.ts's removal note). No-ops
 * unless verification mode is explicitly enabled
 * (`NATIVELY_VERIFICATION_MODE=1`), mirroring
 * `assertVerificationFlagsOrThrow`'s exact opt-in convention
 * (intelligenceFlags.ts) — this NEVER affects a normal user boot, a
 * packaged build, or an ordinary dev session. When verification mode IS on,
 * throws immediately and loudly if a retrieval/injection path executes with
 * `isLayerAllowed(plan, layer)===false` for the layer it JUST used — the
 * actual condition RC1/RC2/RC3 were about (a forbidden layer's content
 * reaching the prompt), not `assertNoAuthorityContradiction`'s narrower,
 * unrelated `sourceOwner===clarify && finalAction==='answer'` condition.
 *
 * Per the plan's explicit instruction, this function itself is NOT
 * flag-gated behind `unifiedRetriever`/any Slice 4 rollout flag — it is a
 * compile-time-cheap, always-defined check that costs nothing at runtime
 * when verification mode is off (a single env-var string comparison), so it
 * ships immediately regardless of the broader retrieval-pipeline
 * consolidation's rollout stage. Call sites are added incrementally as real
 * retrieval/injection paths are audited — this function existing and being
 * tested does not itself constitute "every path is now checked."
 */
export function assertLayerUsageAllowedOrThrow(plan: AnswerPlan, layer: ContextLayer, context?: string): void {
  if (!isVerificationModeEnabled()) return;
  if (!isLayerAllowed(plan, layer)) {
    throw new Error(
      `[LayerUsageViolation] layer "${layer}" was used for answerType "${plan.answerType}"`
      + (context ? ` (${context})` : '')
      + ' but isLayerAllowed forbids it for this answer type. This is the required Slice 4 CI'
      + ' assertion (docs/context-rebuild/05_MIGRATION_PLAN.md) catching a real retrieval/injection'
      + ' bug — set NATIVELY_VERIFICATION_MODE=0 to run without this check while investigating.',
    );
  }
}
