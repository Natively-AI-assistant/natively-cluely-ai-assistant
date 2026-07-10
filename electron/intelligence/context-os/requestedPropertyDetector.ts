// electron/intelligence/context-os/requestedPropertyDetector.ts
//
// Context OS (Phase 2) — deterministic RequestedProperty detection.
//
// What KIND of evidence is the user asking for? Pure regex over the question —
// no LLM call, sub-millisecond, deterministic. Ambiguity returns 'unknown'
// (never guessed): a wrong 'unknown' degrades to today's behavior, a wrong
// specific property would wrongly reject evidence in Phase 5.
//
// Supersedes (but does not remove) the 8-value `classifyRequestedProperty` in
// customModeExecutionContract.ts — the legacy validator keeps its own copy
// until the Phase 15 cleanup; the kernel + orchestrator use THIS one.

import { PROPERTY_RULES } from './requestedProperty';
import type { RequestedProperty } from './types';

/**
 * Detect the requested property of a question. First matching rule wins
 * (PROPERTY_RULES is ordered most-specific-first: candidate_* possessive
 * shapes before document-property readings of the same nouns). Returns
 * 'unknown' when nothing matches.
 */
export function detectRequestedProperty(question: string): RequestedProperty {
  const q = String(question || '').trim();
  if (!q) return 'unknown';

  for (const rule of PROPERTY_RULES) {
    if (rule.questionPatterns.some((pattern) => pattern.test(q))) {
      return rule.property;
    }
  }

  return 'unknown';
}
