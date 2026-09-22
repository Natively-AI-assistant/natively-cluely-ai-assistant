// src/lib/rerankCandidateControl.mjs
//
// Whether Settings > Reranker should offer "Candidates to rerank", and why.
//
// The pool size means different things to different ports, and the panel used
// to present one control with one explanation for all of them:
//
//   LOCAL cross-encoder. The seam splits the pool into batches of
//   RERANK_BATCH_SIZE (6) — an ONNX arena-memory measure, see the crash
//   forensics in ModeHybridRetriever — so a 30-candidate pool is ~5 sequential
//   forward passes at tens of ms each. That fits the 1200ms bundled budget with
//   room to spare. Every value the control offers is BELOW the default pool, so
//   on this path the knob can only narrow retrieval, and it buys back latency
//   the user was never short of. Nothing to decide: hide it.
//
//   HOSTED ports (Natively, OpenRouter, Jina) and EXTENSION ports. Both declare
//   `batchSize = Number.MAX_SAFE_INTEGER`, so the entire pool goes in ONE call.
//   Pool size is then passages billed, and the difference between a round trip
//   that lands inside the 3000ms live / 8000ms manual budget and one that does
//   not — a rerank past its budget is dropped and the answer keeps cosine
//   order, so the spend buys nothing. This is the only lever the user has over
//   either. Show it.
//
// Kept in src/lib so it is one testable statement of the rule rather than a
// condition inlined in JSX.

/** Ports whose rerank cost is a forward pass, not a round trip. */
const FORWARD_PASS_KINDS = new Set(['local']);

/**
 * Does the candidate-count control decide anything for this reranker?
 *
 * Unknown kinds return true on purpose. Hiding on an unrecognised value would
 * silently remove the user's only cost control the moment a new hosted provider
 * is added — failing toward a visible-but-unnecessary control is strictly safer
 * than failing toward an invisible-but-needed one.
 */
export function candidateControlApplies(effectiveKind) {
  return !FORWARD_PASS_KINDS.has(effectiveKind);
}

/**
 * One sentence saying what raising or lowering the pool does on THIS port, or
 * null where the control does not apply.
 *
 * An extension runs locally over an RPC, so it is not billed per passage even
 * though its cost still scales with the pool — the two framings are different
 * and saying "spend" to an extension user would be wrong.
 */
export function candidateControlRationale(effectiveKind) {
  if (!candidateControlApplies(effectiveKind)) return null;
  if (effectiveKind === 'extension') {
    return 'Your extension scores the whole pool in one call, so fewer passages '
      + 'means a faster round trip — and less chance the rerank misses its budget '
      + 'and is discarded.';
  }
  return 'A hosted reranker scores the whole pool in one request, so this is what '
    + 'you pay for on every reranked query. Fewer passages cost less and return '
    + 'sooner; more passages give the reranker more to work with.';
}
