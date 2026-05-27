/**
 * Pure overlay chat message updates (unit-tested).
 * Clarify and other intelligence streams must never wipe unrelated history.
 */

/**
 * Finalize or append a system row for a given intent without removing other messages.
 */
export function finalizeStreamingByIntentMessages(
  prev,
  intent,
  text,
  idFactory = () => Date.now().toString(),
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
  }
  const idx = prev.findLastIndex((m) => m.role === 'system' && m.intent === intent);
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
export function applyWhatToAnswerNullFeedbackMessages(prev, feedback, idFactory = () => Date.now().toString()) {
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
