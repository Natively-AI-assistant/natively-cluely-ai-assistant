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
// Flag: `semanticAdmissionGate`, DEFAULT OFF (opt-in).
//   - env  NATIVELY_SEMANTIC_ADMISSION_GATE = 'on' | 'true' | '1' → enabled
//   - settings  semanticAdmissionGate === true                    → enabled
// Uncached by design (per-call string compare; caching is what makes env-flag
// tests race — see the profileGroundingV2 P2 notes).

/**
 * Provisional floors. TODO(Phase 3): calibrate from the observe-only
 * telemetry ([SemanticAdmission] lines) — these values are starting points,
 * not measurements.
 *
 * gemini-768: 0.55 — chosen so the floor sits where the old blended threshold
 * *pretended* to sit (a real cosine bar instead of a blended-scale constant).
 * local-384 (Xenova/all-MiniLM-L6-v2): TBD — deliberately ABSENT until
 * calibrated; MiniLM cosine distributions are wider than Gemini's and a
 * copied 0.55 would over-reject. Absent ⇒ resolveSemanticFloor → null ⇒
 * legacy admission even with the flag ON.
 */
const DEFAULT_SEMANTIC_FLOORS: Record<string, number> = {
  'gemini:gemini-embedding-2:768': 0.55,
};

export const isSemanticAdmissionGateEnabled = (): boolean => {
  try {
    const v = (process.env.NATIVELY_SEMANTIC_ADMISSION_GATE || '').trim().toLowerCase();
    if (v === 'on' || v === 'true' || v === '1') return true;
  } catch { /* fall through to settings */ }
  try {
    const { SettingsManager } = require('../services/SettingsManager');
    if (SettingsManager.getInstance().get('semanticAdmissionGate') === true) return true;
  } catch { /* settings unavailable → default OFF */ }
  return false;
};

/**
 * Resolve the cosine admission floor for an embedding space.
 * Returns null when no calibrated floor exists (unknown space, or no space
 * threaded by the caller) — callers MUST treat null as "use legacy admission".
 *
 * Config override: NATIVELY_SEMANTIC_FLOORS='{"<spaceKey>":0.5,...}' merges
 * over the defaults (rollback/tuning lever without a redeploy, mirroring
 * NATIVELY_GEMINI_EMBED_MODEL's role in EmbeddingProviderResolver).
 */
export const resolveSemanticFloor = (spaceKey?: string | null): number | null => {
  if (!spaceKey) return null;
  let floors: Record<string, number> = DEFAULT_SEMANTIC_FLOORS;
  try {
    const raw = (process.env.NATIVELY_SEMANTIC_FLOORS || '').trim();
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') floors = { ...DEFAULT_SEMANTIC_FLOORS, ...parsed };
    }
  } catch { /* malformed override → defaults */ }
  const floor = floors[spaceKey];
  return typeof floor === 'number' && Number.isFinite(floor) ? floor : null;
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
export const resolveMinSimilarity = (spaceKey?: string | null): number => {
  let map: Record<string, number> = MIN_SIMILARITY_BY_SPACE;
  try {
    const raw = (process.env.NATIVELY_MIN_SIMILARITY_BY_SPACE || '').trim();
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') map = { ...MIN_SIMILARITY_BY_SPACE, ...parsed };
    }
  } catch { /* malformed override → defaults */ }
  const v = spaceKey ? map[spaceKey] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_MIN_SIMILARITY;
};
