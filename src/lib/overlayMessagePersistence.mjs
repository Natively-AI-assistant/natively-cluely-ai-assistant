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
