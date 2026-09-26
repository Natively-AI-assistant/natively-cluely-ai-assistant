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
export function resolveChatStreamToken(activeId, incomingId, activeSource, incomingSource) {
  const cur = typeof activeId === 'number' ? activeId : null;
  const curSrc = normalizeSource(activeSource);
  const inSrc = normalizeSource(incomingSource);
  const claimedSrc = claimOf(activeId, activeSource);
  if (typeof incomingId !== 'number') {
    // Backward-compatible path: no id on the wire → behave exactly as before.
    // Preserve the raw active source: with nothing adopted it stays null rather
    // than claiming a surface.
    return { accept: true, activeId: cur, activeSource: cur === null ? null : curSrc };
  }
  if (cur === null) {
    // R-17: a CLAIM is "surface known, id not yet" — the state the renderer
    // enters the moment the user sends from a surface, before main has
    // allocated that stream's id. Without it, F-303's surface scoping only
    // protected a stream that had ALREADY adopted the bubble: a desktop turn
    // typed while a phone turn was still streaming had nothing adopted, so the
    // phone's next token won the empty slot and every desktop token was then
    // rejected as cross-surface. The desktop answer was dropped in full and its
    // `done` went unhonored, leaving a spinner that only Escape cleared.
    // Clearing the refs alone cannot fix that: the phone is mid-stream and
    // would simply re-adopt long before the desktop's first token arrives.
    if (claimedSrc !== null && claimedSrc !== inSrc) {
      return { accept: false, activeId: null, activeSource: claimedSrc };
    }
    return { accept: true, activeId: incomingId, activeSource: inSrc };
  }
  // F-303: supersession is SURFACE-SCOPED. The desktop and phone-mirror paths
  // allocate from ONE shared counter in the main process, so a plain
  // newest-numeric-wins rule let a phone stream started mid-desktop-answer
  // adopt the desktop bubble, append its text, and then drop every remaining
  // desktop token as "stale" — truncating the answer on screen while the main
  // process happily kept streaming it. A stream from a different surface is
  // never a supersession of this one; the active stream owns its bubble until
  // it is done.
  if (curSrc !== inSrc) {
    return { accept: false, activeId: cur, activeSource: curSrc };
  }
  if (incomingId === cur) {
    return { accept: true, activeId: cur, activeSource: curSrc };
  }
  if (incomingId > cur) {
    // A newer stream on the SAME surface superseded the one we were rendering.
    return { accept: true, activeId: incomingId, activeSource: inSrc };
  }
  // incomingId < cur → an older, already-superseded stream is still emitting. Drop.
  return { accept: false, activeId: cur, activeSource: curSrc };
}

/**
 * The surface holding a CLAIM, or null when none is held.
 *
 * A claim is "source set, id still null": the window between the user sending
 * from a surface and main allocating that stream's id. An adopted stream (id
 * present) is NOT a claim — it is handled by the surface-scoping rules above.
 */
function claimOf(activeId, activeSource) {
  if (typeof activeId === 'number') return null;
  if (typeof activeSource !== 'string' || !activeSource) return null;
  return normalizeSource(activeSource);
}

/** Absent/unknown source means the legacy desktop path. */
function normalizeSource(source) {
  return typeof source === 'string' && source ? source : 'desktop';
}

/**
 * Decide whether a `gemini-stream-done` for `incomingId` should be honored given
 * the active id, and what the active id becomes afterward. A done for the active
 * (or id-less, backward-compat) stream finalizes and clears the active id; a done
 * for a stale (older) stream is ignored so it can't tear down a newer stream's row.
 *
 * `release` (CR-01) is set when a done is NOT honored but still belongs to a
 * request the local surface started — the caller must stop its own processing
 * indicator even though it must not finalize the active row.
 *
 * @param {number|null|undefined} activeId
 * @param {number|null|undefined} incomingId
 * @returns {{ honor: boolean, activeId: number|null, activeSource?: string|null, release?: boolean }}
 */
export function resolveChatStreamDone(activeId, incomingId, activeSource, incomingSource) {
  const cur = typeof activeId === 'number' ? activeId : null;
  const curSrc = normalizeSource(activeSource);
  const inSrc = normalizeSource(incomingSource);
  if (typeof incomingId !== 'number') {
    // No id → backward-compatible: honor and clear.
    return { honor: true, activeId: null, activeSource: null, release: false };
  }
  // F-303: a done from a DIFFERENT surface must not finalize (and clear) the
  // active stream's row — that is how a phone stream used to close a desktop
  // bubble with its own, finalText-less completion.
  if (cur !== null && curSrc !== inSrc) {
    // CR-01: F-303 was reasoned about in one direction only ("phone interrupts
    // desktop"). The inverse — the user types here while a phone-mirror answer
    // is streaming — hits this same branch, and the renderer returns on !honor
    // BEFORE setIsProcessing(false), so the desktop spinner never stops. Not
    // honoring the done is still correct (the phone stream owns the row), but
    // a done for a request THIS surface started must always release the local
    // processing state. `release` is scoped to the local surface so a stale
    // same-surface done (handled below) cannot stop a live spinner.
    return { honor: false, activeId: cur, activeSource: curSrc, release: inSrc === 'desktop' };
  }
  // R-17: nor may it finalize a CLAIM. Honoring a phone `done` here would
  // finalize the empty placeholder the desktop turn just reserved.
  if (claimOf(activeId, activeSource) !== null && claimOf(activeId, activeSource) !== inSrc) {
    return { honor: false, activeId: null, activeSource: normalizeSource(activeSource) };
  }
  if (cur === null || incomingId >= cur) {
    return { honor: true, activeId: null, activeSource: null, release: false };
  }
  // Stale done for an already-superseded stream — ignore, keep current active.
  return { honor: false, activeId: cur, activeSource: curSrc, release: false };
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

/**
 * Decide whether a `gemini-stream-error` from `incomingSource` must RELEASE the
 * adopted stream guard.
 *
 * R-02: the renderer deliberately discards phone-mirror errors so a phone
 * failure cannot deface a desktop bubble — but discarding the event must not
 * also discard the cleanup. Phone tokens are tagged 'phone' while the phone
 * error is tagged 'phone-mirror', and a provider that throws AFTER committing
 * tokens never sends a `done`. So a failed phone turn left the guard pinned to
 * the phone surface permanently, and every subsequent DESKTOP stream was
 * rejected as a cross-surface supersession — no text, endless spinner.
 *
 * An error always ends its own stream, so releasing is safe whenever the error
 * comes from the surface that currently owns the guard.
 *
 * @param {string|null|undefined} activeSource
 * @param {string|null|undefined} incomingSource
 * @returns {{ release: boolean }}
 */
export function resolveChatStreamSurfaceError(activeSource, incomingSource) {
  if (activeSource == null) return { release: false };
  return { release: sameSurface(activeSource, incomingSource) };
}

/** 'phone' (token tag) and 'phone-mirror' (error tag) are the same surface. */
function sameSurface(a, b) {
  const norm = (s) => (s === 'phone-mirror' ? 'phone' : normalizeSource(s));
  return norm(a) === norm(b);
}
