// electron/llm/performance/capabilityView.ts
//
// A READ-ONLY consolidation of capability facts that already exist elsewhere.
//
// WHY A VIEW AND NOT A REGISTRY. `modelCapabilities.ts` carries a comment
// recording the exact debt this addresses:
//
//   "Single source: groqModels.ts (code-review 2026-08-23 — this fact was
//    encoded in four uncoordinated places; a vision-model swap that missed one
//    silently re-armed the 'Groq vision refused' bug)."
//
// The lesson there was consolidation, not duplication. So this module adds NO
// new source of truth — it calls `getModelCapabilities` and the vision helpers
// and reports what they say, with provenance. Every existing gate keeps the
// exact inputs it has today; nothing in the answer path reads this. It exists so
// a user (and a diagnostics dump) can see WHY a capability warning appeared, and
// so a future consolidation has one place to start from rather than five.
//
// PHASE 4, THE HARD RULE: capability truth is never inferred from latency. There
// is no code path in this file that can read a timeout, and there must not be
// one. A provider being slow is a performance fact; a provider not accepting
// images is a capability fact; conflating them is how "your model does not
// support vision" gets shown to someone whose network was simply bad.

import { getModelCapabilities } from '../modelCapabilities';
import { groqSupportsImages, isGroqModelId } from '../groqModels';
import type { CapabilityFacts } from './types';

/**
 * Outcome vocabulary for a capability question (Phase 4).
 *
 * `FAILED_TEMPORARILY` and `UNKNOWN` are distinct and both are needed: the first
 * says we asked and something went wrong that may not recur, the second says we
 * have not established it at all. Collapsing them would turn one bad network
 * moment into a permanent "unsupported".
 */
export type CapabilityVerdict = 'SUPPORTED' | 'UNSUPPORTED' | 'FAILED_TEMPORARILY' | 'UNKNOWN';

export function verdictFrom(value: boolean | 'unknown'): CapabilityVerdict {
  if (value === true) return 'SUPPORTED';
  if (value === false) return 'UNSUPPORTED';
  return 'UNKNOWN';
}

/**
 * Read the capability facts Natively already knows for one model.
 *
 * `isOllama` is passed through rather than sniffed, matching every existing
 * caller of `getModelCapabilities` — that predicate lives on LLMHelper and this
 * module deliberately does not reach for it.
 */
export function readCapabilityFacts(modelId: string, isOllama: boolean): CapabilityFacts {
  try {
    const caps = getModelCapabilities(modelId, isOllama);
    return {
      // Every provider Natively drives through the deadline driver is a
      // streaming provider; the non-streaming paths (executeCustomProvider,
      // generateWithCodexCli) never reach this layer.
      streaming: true,
      // Groq's vision answer comes from groqModels.ts, which the comment above
      // names as the single source. Asking it directly rather than trusting the
      // copy is the point of a view.
      vision: isGroqModelId(modelId) ? groqSupportsImages(modelId) : caps.supportsImages,
      // Natively has no tool-calling or structured-output registry to read, and
      // inventing one here would be exactly the speculative abstraction Phase 0
      // rule 22 forbids. 'unknown' is the honest value.
      tools: 'unknown',
      structuredOutput: 'unknown',
      contextWindowTokens: caps.maxContextTokens,
      source: 'model_registry',
    };
  } catch {
    return {
      streaming: true,
      vision: 'unknown',
      tools: 'unknown',
      structuredOutput: 'unknown',
      contextWindowTokens: 0,
      source: 'unknown',
    };
  }
}

/**
 * Would this request exceed what the model advertises?
 *
 * A CAPABILITY question with a capability answer, kept away from the latency
 * side of the profile entirely. Returns null when the context window is unknown
 * — an unknown limit is not a permission to warn.
 */
export function exceedsAdvertisedContext(
  facts: CapabilityFacts,
  inputTokens: number,
): { exceeds: boolean; limitTokens: number } | null {
  if (!facts.contextWindowTokens || facts.contextWindowTokens <= 0) return null;
  return { exceeds: inputTokens > facts.contextWindowTokens, limitTokens: facts.contextWindowTokens };
}

/**
 * The warning a poor large-context RESULT justifies.
 *
 * Phase 14 is explicit that repeated failure at 100K on a model advertising 128K
 * is a RELIABILITY finding, not a capability one — "surface this as 'Large-context
 * reliability is poor', not necessarily 'Model does not support 100K', unless
 * capability metadata/probes establish that fact." This function is the
 * enforcement of that sentence: it can only ever return a reliability phrasing,
 * because it is not given anything capability-shaped to return.
 */
export function largeContextReliabilityWarning(opts: {
  attempts: number;
  failures: number;
}): string | null {
  if (opts.attempts < 4) return null;
  const rate = opts.failures / opts.attempts;
  if (rate < 0.3) return null;
  return 'Large-context reliability is poor on this provider — big requests often fail or time out.';
}
