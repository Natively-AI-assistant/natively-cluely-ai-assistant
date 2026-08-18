// electron/llm/semanticAdmissionGate.ts
//
// Phase 1 of the semantic-retrieval repair (2026-08-13, audit
// reports/cosine-similarity-relevance-audit-2026-08-13.md §5).
//
// HybridSearchEngine's legacy admission predicate is `blendedScore > 0.55`,
// where blendedScore = 0.6·cosine + up to 1.35 of metadata boosts. Verified
// consequences (ScoreNodeAdmissionArithmetic2026_08_13.test.mjs, real code):
//   - cosine 0.90 with no boosts scores 0.540 → REJECTED (semantics can't admit)
//   - cosine 0.60 with only the two QUERY-INDEPENDENT boosts (tenure+recency)
//     scores 0.560 → ADMITTED (contamination floor)
//
// The fix separates ADMISSION from RANKING:
//   admit iff cosine ≥ SEMANTIC_FLOOR[embeddingSpaceKey]
//   rank  by the existing blended score — boosts order candidates, they can
//         no longer admit them.
//
// Floors are keyed by the composite embedding-space key
// (`${provider}:${model}:${dims}`, electron/rag/embeddingSpace.ts) because
// score distributions differ materially between spaces — a single constant
// cannot serve gemini-768 and MiniLM-384 (the audit's §10 finding; the repo's
// own MIN_LEXICAL_SCORE derivation in ModeHybridRetriever.ts:135-160 is the
// pattern precedent). An UNKNOWN space resolves to null and the caller falls
// back to legacy admission — enforcing an uncalibrated floor is worse than
// not enforcing one.
//
// Flag: `semanticAdmissionGate`, DEFAULT ON since 2026-08-14 (kill-switch
// model — the calibrated-floor flip; see isSemanticAdmissionGateEnabled's doc
// for the full contract):
//   - env  NATIVELY_SEMANTIC_ADMISSION_GATE = 'off' | 'false' | '0' | 'disabled' → disabled
//   - settings  semanticAdmissionGate === false                                  → disabled
// Uncached by design (per-call string compare; caching is what makes env-flag
// tests race — see the profileGroundingV2 P2 notes).

import { isKillSwitchFlagEnabled } from './runtimeKillSwitch';

/**
 * CALIBRATED floors (scripts/calibrate-semantic-floors.js, real embeddings,
 * 2026-08-14 — 8 labeled queries × 12 profile-style nodes = 43 pairs, with
 * boost-bait irrelevant nodes mirroring the audit-§5 failure shape):
 *
 * gemini-768: 0.69 — the two distributions did not overlap AT ALL on the
 *   calibration corpus (relevant [0.6977, 0.8353], irrelevant
 *   [0.5967, 0.6847]); 0.69 sits inside the empty gap → measured 0%
 *   false-admit, 0% false-reject. The earlier provisional 0.55 was vacuous
 *   on real gemini vectors (every candidate cleared it).
 * local-384 (Xenova/all-MiniLM-L6-v2): deliberately ABSENT — measured
 *   overlap 0.13 (relevant p10 = 0.089 BELOW irrelevant p90 = 0.170); any
 *   floor costs either ~45% false-admits or ~17% false-rejects, and a false
 *   reject manufactures an "I don't have that" answer. Keyless installs
 *   therefore keep legacy admission (resolveSemanticFloor → null) until a
 *   stronger local embedder ships. Re-run the calibration script before
 *   ever adding a local floor.
 */
const DEFAULT_SEMANTIC_FLOORS: Record<string, number> = {
  'gemini:gemini-embedding-2:768': 0.69,
};

/**
 * DEFAULT ON (kill-switch model, mirroring profileGroundingV2): calibrated
 * floors + live E2E (22/22, scripts/e2e-semantic-repair-deepseek.js) gated
 * the production flip. Disableable at runtime WITHOUT a redeploy:
 *   - env  NATIVELY_SEMANTIC_ADMISSION_GATE = 'off' | 'false' | '0' | 'disabled' → disabled
 *   - settings  semanticAdmissionGate === false                                  → disabled
 * ('on'/'true'/'1' still accepted for explicitness / older configs.)
 * Enforcement additionally requires a calibrated floor for the ACTIVE
 * embedding space — unknown spaces and failed embeds always fall back to
 * legacy admission, so flipping this ON cannot over-reject on uncalibrated
 * corpora by construction.
 */
export const isSemanticAdmissionGateEnabled = (): boolean =>
  isKillSwitchFlagEnabled('NATIVELY_SEMANTIC_ADMISSION_GATE', 'semanticAdmissionGate');

/**
 * Resolve the cosine admission floor for an embedding space.
 * Returns null when no calibrated floor exists (unknown space, or no space
 * threaded by the caller) — callers MUST treat null as "use legacy admission".
 *
 * Config override: NATIVELY_SEMANTIC_FLOORS='{"<spaceKey>":0.5,...}' merges
 * over the defaults (rollback/tuning lever without a redeploy, mirroring
 * NATIVELY_GEMINI_EMBED_MODEL's role in EmbeddingProviderResolver).
 */
export const resolveSemanticFloor = (spaceKey?: string | null): number | null =>
  resolveSpaceKeyedValue('NATIVELY_SEMANTIC_FLOORS', DEFAULT_SEMANTIC_FLOORS, spaceKey) ?? null;

/**
 * Shared env→JSON→merge resolver for space-keyed numeric config (code-review
 * R4, 2026-08-14 — resolveSemanticFloor and resolveMinSimilarity had grown
 * identical shapes). Returns undefined when the space has no value; each
 * caller applies ITS OWN fallback — that difference is the contract:
 * floors fall back to null (never enforce uncalibrated), minSimilarity falls
 * back to the legacy 0.25 (vector search always had a threshold).
 */
const resolveSpaceKeyedValue = (
  envVar: string,
  defaults: Record<string, number>,
  spaceKey?: string | null,
): number | undefined => {
  if (!spaceKey) return undefined;
  let map: Record<string, number> = defaults;
  try {
    const raw = (process.env[envVar] || '').trim();
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') map = { ...defaults, ...parsed };
    }
  } catch { /* malformed override → defaults */ }
  const v = map[spaceKey];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};

// ── Phase 3: space-aware minSimilarity for the meeting-RAG vector search ────
//
// VectorStore/RAGRetriever historically hard-coded `minSimilarity: 0.25` for
// every embedding space. Like the admission floors above, one constant cannot
// be right for both gemini-768 and MiniLM-384 (different cosine
// distributions). Phase 3 keys the threshold by space WITHOUT changing any
// value: every space resolves to the legacy 0.25 until the observe-only
// [SemanticAdmission] telemetry provides real distributions to calibrate from.

const DEFAULT_MIN_SIMILARITY = 0.25;

/**
 * Per-space minSimilarity overrides. Deliberately EMPTY at Phase 3 — this is
 * plumbing, not retuning. TODO(Phase 3 follow-up): populate from telemetry.
 */
const MIN_SIMILARITY_BY_SPACE: Record<string, number> = {};

/**
 * Resolve the vector-search minSimilarity for an embedding space. Always
 * returns a number (unlike resolveSemanticFloor — vector search always had a
 * threshold, so the legacy 0.25 is the safe universal fallback).
 *
 * Config override: NATIVELY_MIN_SIMILARITY_BY_SPACE='{"<spaceKey>":0.2}'
 * merges over the defaults.
 */
export const resolveMinSimilarity = (spaceKey?: string | null): number =>
  resolveSpaceKeyedValue('NATIVELY_MIN_SIMILARITY_BY_SPACE', MIN_SIMILARITY_BY_SPACE, spaceKey)
    ?? DEFAULT_MIN_SIMILARITY;
