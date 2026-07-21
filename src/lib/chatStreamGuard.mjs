// src/lib/chatStreamGuard.mjs
//
// Pure helper for the renderer's chat-stream token guard (audit finding #3).
//
// Background: the main process emits chat tokens on a single `gemini-stream-token`
// channel from BOTH the desktop chat path and the phone-mirror chat path. The
// renderer's streaming state machine keys only on the coarse `intent` ('chat'),
// so two genuinely-concurrent chat streams (e.g. desktop + phone) could interleave
// their tokens into one bubble. Main-side supersession already prevents the common
// case; this is renderer-side defense-in-depth.
//
// The wire now carries an optional numeric `streamId` per token. This reducer
// decides, given the renderer's currently-adopted stream id and an incoming token's
// id, whether to accept the token and what the new active id should be. It is
// deliberately backward-compatible: a token WITHOUT a streamId is always accepted
// and never changes the active id (preserves pre-change behavior exactly).
//
// Policy (mirrors the main-side "newest wins" supersession):
//   - no incoming id            → accept, active id unchanged
//   - no active id yet          → accept, adopt incoming id
//   - incoming id === active id  → accept, active id unchanged
//   - incoming id  >  active id  → accept, adopt incoming id (a newer stream took over)
//   - incoming id  <  active id  → DROP (stale stream still trickling tokens)

/**
 * @param {number|null|undefined} activeId  the renderer's currently-adopted chat stream id
 * @param {number|null|undefined} incomingId the streamId on the incoming token (may be absent)
 * @returns {{ accept: boolean, activeId: number|null }}
 */
export function resolveChatStreamToken(activeId, incomingId) {
  const cur = typeof activeId === 'number' ? activeId : null;
  if (typeof incomingId !== 'number') {
    // Backward-compatible path: no id on the wire → behave exactly as before.
    return { accept: true, activeId: cur };
  }
  if (cur === null) {
    return { accept: true, activeId: incomingId };
  }
  if (incomingId === cur) {
    return { accept: true, activeId: cur };
  }
  if (incomingId > cur) {
    // A newer stream superseded the one we were rendering — adopt it.
    return { accept: true, activeId: incomingId };
  }
  // incomingId < cur → an older, already-superseded stream is still emitting. Drop.
  return { accept: false, activeId: cur };
}

/**
 * Decide whether a `gemini-stream-done` for `incomingId` should be honored given
 * the active id, and what the active id becomes afterward. A done for the active
 * (or id-less, backward-compat) stream finalizes and clears the active id; a done
 * for a stale (older) stream is ignored so it can't tear down a newer stream's row.
 *
 * @param {number|null|undefined} activeId
 * @param {number|null|undefined} incomingId
 * @returns {{ honor: boolean, activeId: number|null }}
 */
export function resolveChatStreamDone(activeId, incomingId) {
  const cur = typeof activeId === 'number' ? activeId : null;
  if (typeof incomingId !== 'number') {
    // No id → backward-compatible: honor and clear.
    return { honor: true, activeId: null };
  }
  if (cur === null || incomingId >= cur) {
    return { honor: true, activeId: null };
  }
  // Stale done for an already-superseded stream — ignore, keep current active.
  return { honor: false, activeId: cur };
}

// ── Live-answer (what-to-answer) batch guard (audit finding #3, full) ──────────
//
// Background: the LIVE answer path streams on `intelligence-token-batch`
// (kind='suggested_answer') and the renderer keys it only on intent
// ('what_to_answer'). The engine supersedes a stale answer via its
// currentGenerationId, but tokens already queued in the main-process batch buffer
// (a setImmediate-deferred flush) when a NEWER answer starts will still arrive,
// and — sharing the same intent — would merge into the new answer's bubble
// (shouldFlushPreviousStream only separates on an intent CHANGE). Each live token
// now carries the request's `generationId`; this reducer drops a batch item that
// belongs to an older generation than the one the renderer has adopted.
//
// Policy is identical to resolveChatStreamToken ("newest wins"); the only
// difference is the field name on the wire (generationId vs streamId). Kept as a
// separate export so the two guards can evolve independently and read clearly at
// their call sites.
//
// Backward-compatible: an item WITHOUT a numeric generationId is always accepted
// and never changes the active id (the code-hint / brainstorm live streams emit
// id-less tokens, and so do older main builds).
//
/**
 * @param {number|null|undefined} activeId   the renderer's currently-adopted live-answer generation id
 * @param {number|null|undefined} incomingId the generationId on the incoming batch item (may be absent)
 * @returns {{ accept: boolean, activeId: number|null }}
 */
export function resolveLiveAnswerBatch(activeId, incomingId) {
  const cur = typeof activeId === 'number' ? activeId : null;
  if (typeof incomingId !== 'number') {
    return { accept: true, activeId: cur };
  }
  if (cur === null) {
    return { accept: true, activeId: incomingId };
  }
  if (incomingId === cur) {
    return { accept: true, activeId: cur };
  }
  if (incomingId > cur) {
    return { accept: true, activeId: incomingId };
  }
  return { accept: false, activeId: cur };
}
