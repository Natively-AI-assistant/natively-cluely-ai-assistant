/**
 * Smart Browser Context v2 — hard policy engine (desktop, authoritative).
 *
 * This module has the FINAL say on what may be done with a page. It runs AFTER
 * the AI metadata classifier and OVERRIDES unsafe AI output. The cardinal rule:
 * a sensitive page (email/chat/banking/auth, or a locally-detected sensitive
 * signal) is ALWAYS forced to 'blocked', no matter what the AI returned.
 *
 * Pure + dependency-free (only type imports) so it can be unit-tested directly
 * from the compiled dist-electron output and reused by the classifier service.
 */

import type {
  AiWebsiteClassification,
  AutoPolicy,
  BrowserContextCategory,
  BrowserContextSensitivity,
} from './types';

/** Categories that are never capturable — always forced to 'blocked'. */
export const SENSITIVE_CATEGORIES: ReadonlySet<BrowserContextCategory> = new Set([
  'email',
  'chat',
  'banking',
  'auth',
]);

/** Coding categories eligible to auto-attach at sufficient confidence. */
const CODING_CATEGORIES: ReadonlySet<BrowserContextCategory> = new Set([
  'coding_problem',
  'coding_editor',
  'interview_assessment',
]);

/** AI confidence (0..1) required before a coding page may AUTO-attach. */
export const CODING_AUTO_MIN_CONFIDENCE = 0.9;

export interface PolicyInput {
  /** The AI classifier verdict (or a local-only one). */
  classification: AiWebsiteClassification;
  /**
   * Hard sensitive flag from the local sensitive-page detector. When true the
   * page is blocked regardless of the AI's category/confidence — this is the
   * "AI says Gmail is a coding problem → final = blocked" guarantee.
   */
  localSensitive?: boolean;
  /** The locally-detected category, if any (used to corroborate sensitivity). */
  localCategory?: BrowserContextCategory;
}

export interface PolicyDecision {
  category: BrowserContextCategory;
  autoPolicy: AutoPolicy;
  sensitivity: BrowserContextSensitivity;
  reason: string;
}

/** Default sensitivity per category (the chip/telemetry use this). */
function sensitivityFor(category: BrowserContextCategory): BrowserContextSensitivity {
  if (SENSITIVE_CATEGORIES.has(category)) return 'critical';
  if (category === 'google_docs_visible' || category === 'notes') return 'high';
  return 'low';
}

/**
 * Resolve the final, authoritative policy. Order of precedence:
 *   1. local sensitive flag  → blocked
 *   2. sensitive category    → blocked
 *   3. coding category       → auto (≥0.9) / auto_if_high_confidence / ask
 *   4. docs / job_description→ ask
 *   5. google_docs / notes   → manual
 *   6. unknown / anything else → manual
 */
export function decideFinalPolicy(input: PolicyInput): PolicyDecision {
  const { classification, localSensitive, localCategory } = input;
  const aiCategory = classification.category;
  const confidence = clamp01(classification.confidenceScore);

  // 1 + 2. Hard sensitive overrides. The category reported to the UI is the
  // sensitive one (prefer the local detector's category if it flagged it).
  if (localSensitive || SENSITIVE_CATEGORIES.has(aiCategory) || (localCategory && SENSITIVE_CATEGORIES.has(localCategory))) {
    const blockedCategory =
      (localCategory && SENSITIVE_CATEGORIES.has(localCategory)) ? localCategory
        : SENSITIVE_CATEGORIES.has(aiCategory) ? aiCategory
          : (localCategory ?? aiCategory);
    return {
      category: blockedCategory,
      autoPolicy: 'blocked',
      sensitivity: 'critical',
      reason: localSensitive
        ? 'local sensitive signal → blocked (overrides AI)'
        : 'sensitive category → blocked',
    };
  }

  // 3. Coding categories.
  if (CODING_CATEGORIES.has(aiCategory)) {
    if (aiCategory === 'coding_editor') {
      return {
        category: aiCategory,
        autoPolicy: confidence >= CODING_AUTO_MIN_CONFIDENCE ? 'auto' : 'auto_if_high_confidence',
        sensitivity: 'low',
        reason: `coding editor (confidence ${confidence.toFixed(2)})`,
      };
    }
    // coding_problem / interview_assessment auto only at ≥0.9.
    return {
      category: aiCategory,
      autoPolicy: confidence >= CODING_AUTO_MIN_CONFIDENCE ? 'auto' : 'ask',
      sensitivity: 'low',
      reason: `coding problem (confidence ${confidence.toFixed(2)})`,
    };
  }

  // 4. Docs / job description → ask.
  if (aiCategory === 'developer_docs' || aiCategory === 'job_description') {
    return { category: aiCategory, autoPolicy: 'ask', sensitivity: 'low', reason: `${aiCategory} → ask` };
  }

  // 5. Google Docs / notes → manual (never auto, high sensitivity).
  if (aiCategory === 'google_docs_visible' || aiCategory === 'notes') {
    return { category: aiCategory, autoPolicy: 'manual', sensitivity: 'high', reason: `${aiCategory} → manual` };
  }

  // 6. unknown / article / everything else → manual.
  return {
    category: aiCategory,
    autoPolicy: 'manual',
    sensitivity: sensitivityFor(aiCategory),
    reason: `${aiCategory} → manual (conservative default)`,
  };
}

function clamp01(n: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
