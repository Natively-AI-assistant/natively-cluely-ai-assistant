/**
 * Pure overlay chat message updates (unit-tested).
 * Clarify and other intelligence streams must never wipe unrelated history.
 */

// Default id factory. Mirrors src/utils/messageId.ts genMessageId (which we
// cannot import directly: this file is .mjs and runs under Node's ESM in
// tests, where .ts resolution is not available). The counter is seeded with
// a random offset so HMR / test reloads cannot produce an id that collides
// with one still living in retained React state. The post-increment
// guarantees two calls in the same millisecond get distinct ids — closing
// the same collision window that `genMessageId` closes in the renderer.
//
// In production every caller in NativelyInterface.tsx passes an explicit
// `idFactory` that delegates to `genMessageId`. This default exists for
// (a) callers that forget and (b) test harnesses that don't need a custom
// factory. Either way, the default must NOT use bare `Date.now().toString()`
// because that lets `applyFirstStreamingToken`'s no-op-on-finalized-row
// branch silently drop the first token of a freshly-id'd stream that
// happens to collide with a just-finalized neighbor.
let _defaultIdCounter = Math.floor(Math.random() * 1_000_000);
const _defaultIdFactory = () => `${Date.now()}-${++_defaultIdCounter}`;

/**
 * Finalize or append a system row for a given intent without removing other messages.
 */
export function finalizeStreamingByIntentMessages(
  prev,
  intent,
  text,
  idFactory = _defaultIdFactory,
  streamingMsgId = null,
) {
  if (!Array.isArray(prev)) return [];
  if (streamingMsgId != null) {
    const byIdIdx = prev.findIndex((m) => m.id === streamingMsgId);
    if (byIdIdx !== -1) {
      const updated = [...prev];
      updated[byIdIdx] = { ...updated[byIdIdx], text, intent, isStreaming: false };
      return updated;
    }
    // Race: finalize landed before the streaming row mounted (token transition
    // still pending). Append USING the caller's streamingMsgId so the deferred
    // mount's applyFirstStreamingToken finds and updates this row in place
    // instead of creating a parallel duplicate. Idempotent commit by id.
    return [
      ...prev,
      {
        id: streamingMsgId,
        role: 'system',
        text,
        intent,
        isStreaming: false,
      },
    ];
  }
  // No streamingMsgId: only the *open* same-intent row (placeholder pattern).
  // Without isStreaming filter we would clobber a previously-finalized answer.
  const idx = prev.findLastIndex(
    (m) => m.role === 'system' && m.intent === intent && m.isStreaming,
  );
  if (idx !== -1) {
    const updated = [...prev];
    updated[idx] = { ...updated[idx], text, isStreaming: false };
    return updated;
  }
  return [
    ...prev,
    {
      id: idFactory(),
      role: 'system',
      text,
      intent,
      isStreaming: false,
    },
  ];
}

/**
 * Seal any in-flight streaming rows and mount an empty placeholder for the next stream.
 */
export function prepareIntelligenceStreamPlaceholderMessages(
  prev,
  intent,
  placeholderId,
) {
  if (!Array.isArray(prev)) return [];
  const base = prev.some((m) => m.isStreaming)
    ? prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
    : prev;
  return [
    ...base,
    {
      id: placeholderId,
      role: 'system',
      text: '',
      intent,
      isStreaming: true,
    },
  ];
}

/**
 * Apply WTA null-invoke feedback to message rows (cooldown / empty answer path).
 */
export function applyWhatToAnswerNullFeedbackMessages(prev, feedback, idFactory = _defaultIdFactory) {
  if (!Array.isArray(prev)) {
    return [
      {
        id: idFactory(),
        role: 'system',
        intent: 'what_to_answer',
        text: feedback,
        isStreaming: false,
      },
    ];
  }
  const openIdx = prev.findLastIndex(
    (m) => m.role === 'system' && m.intent === 'what_to_answer' && m.isStreaming,
  );
  if (openIdx !== -1) {
    const updated = [...prev];
    updated[openIdx] = {
      ...updated[openIdx],
      text: feedback,
      isStreaming: false,
    };
    return updated;
  }
  return [
    ...prev,
    {
      id: idFactory(),
      role: 'system',
      intent: 'what_to_answer',
      text: feedback,
      isStreaming: false,
    },
  ];
}

/**
 * Discard an in-flight what-to-answer scaffold row that will never receive a
 * final answer (stream superseded / declined / errored). Removes the open
 * streaming `what_to_answer` row so the user is never left with a permanent
 * "Working on…" scaffold card. No-op if no such open row exists (idempotent —
 * safe to call alongside the manual-path null cleanup). Only removes a row that
 * is STILL streaming, so a previously-finalized answer is never deleted.
 */
/**
 * Placeholder intent for an `intelligence-error` mode. Most modes open a
 * placeholder under their own name; What to Answer's is 'what_to_answer', and
 * follow-up opens one under its refinement ('shorten', 'rephrase'), which only
 * the renderer knows — so it is the active stream's intent when that is not one
 * of the named ones. null = no placeholder to settle (just report the error).
 */
const NAMED_STREAM_INTENTS = new Set(['what_to_answer', 'recap', 'clarify', 'follow_up_questions', 'code_hint', 'brainstorm', 'chat']);
export function intelligenceErrorIntent(mode, activeStreamIntent) {
  if (mode === 'what_to_say') return 'what_to_answer';
  if (mode === 'follow_up') {
    return activeStreamIntent && !NAMED_STREAM_INTENTS.has(activeStreamIntent) ? activeStreamIntent : null;
  }
  return NAMED_STREAM_INTENTS.has(mode) && mode !== 'chat' ? mode : null;
}

/**
 * Settle the open streaming row for `intent` when its generation errored, then
 * append the error. Partial text that already streamed is kept as a finished
 * row; an empty placeholder is dropped. Without this the "Thinking..." row
 * stayed open forever beside the error. Finalized rows are never touched.
 */
export function settleStreamingOnErrorMessages(prev, intent, partialText, errorText, idFactory = _defaultIdFactory) {
  const next = Array.isArray(prev) ? [...prev] : [];
  const idx = intent
    ? next.findLastIndex((m) => m.role === 'system' && m.intent === intent && m.isStreaming)
    : -1;
  if (idx !== -1) {
    const text = partialText || next[idx].text;
    if (text) next[idx] = { ...next[idx], text, isStreaming: false };
    else next.splice(idx, 1);
  }
  next.push({ id: idFactory(), role: 'system', text: errorText });
  return next;
}

export function discardStreamingByIntentMessages(prev, intent = 'what_to_answer') {
  if (!Array.isArray(prev)) return [];
  const openIdx = prev.findLastIndex(
    (m) => m.role === 'system' && m.intent === intent && m.isStreaming,
  );
  if (openIdx === -1) return prev;
  const updated = [...prev];
  updated.splice(openIdx, 1);
  return updated;
}
