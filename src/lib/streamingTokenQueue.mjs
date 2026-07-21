/**
 * Pure helpers for imperative streaming token coalescing.
 * Used by NativelyInterface queueToken — extracted for unit tests.
 */

import {
  finalizeStreamingByIntentMessages,
  prepareIntelligenceStreamPlaceholderMessages,
} from './overlayMessagePersistence.mjs';
import { shouldAcceptIntelligenceIpc } from './overlayIntelligenceGeneration.mjs';

/**
 * Whether an open stream is active (placeholder or mid-token), regardless of buffered text.
 */
export function hasActiveOpenStream(activeMsgId) {
  return activeMsgId != null;
}

/**
 * Whether an incoming token should flush the active stream before appending.
 * Flush only when a *different* intent arrives while a stream is already open.
 * Same-intent tokens must accumulate in one bubble.
 */
export function shouldFlushPreviousStream(activeIntent, incomingIntent, activeMsgId) {
  if (!hasActiveOpenStream(activeMsgId)) return false;
  if (activeIntent == null) return false;
  return activeIntent !== incomingIntent;
}

/**
 * Last in-flight system row for an intent (or any intent when intent is null).
 */
export function findOpenStreamingRowIndex(messages, intent) {
  if (!Array.isArray(messages)) return -1;
  return messages.findLastIndex(
    (m) =>
      m.role === 'system' &&
      m.isStreaming &&
      (intent == null || m.intent === intent),
  );
}

/**
 * Pick the message id for the next token: active ref, existing open row, or new id.
 */
export function resolveStreamingMessageId(messages, activeMsgId, intent, idFactory) {
  if (activeMsgId != null) return activeMsgId;
  const idx = findOpenStreamingRowIndex(messages, intent);
  if (idx !== -1) return messages[idx].id;
  return idFactory();
}

/**
 * Mount the first token on an existing placeholder row or append a new streaming row.
 */
export function applyFirstStreamingToken(messages, { id, token, intent }) {
  if (!Array.isArray(messages)) {
    return [{ id, role: 'system', text: token, intent, isStreaming: true }];
  }
  const idx = messages.findIndex((m) => m.id === id);
  if (idx !== -1) {
    const row = messages[idx];
    // Idempotency: if finalize already committed this row (race: finalize ran
    // before the deferred mount transition), the row's text equals the final
    // payload and isStreaming is false. Re-appending the same token would
    // double the visible text AND re-open the stream. Treat the late mount
    // as a no-op so the row stays finalized with its final text.
    if (row.isStreaming === false) {
      return messages;
    }
    const updated = [...messages];
    updated[idx] = {
      ...row,
      text: row.text ? row.text + token : token,
      intent,
      isStreaming: true,
    };
    return updated;
  }
  return [...messages, { id, role: 'system', text: token, intent, isStreaming: true }];
}

/**
 * Commit imperative streaming buffer text onto an existing row (stream end).
 */
export function commitStreamingFlush(messages, msgId, text) {
  if (!Array.isArray(messages) || !msgId || !text) return messages;
  const idx = messages.findLastIndex((m) => m.id === msgId);
  if (idx === -1) return messages;
  const updated = [...messages];
  updated[idx] = { ...updated[idx], text, isStreaming: false };
  return updated;
}

/**
 * Finalize an imperatively-rendered stream with exactly one React state commit.
 * Prefer authoritative finalText when present (repair / server post-processing),
 * otherwise preserve the visible buffered stream text.
 */
export function finalizeImperativeStreamMessages(
  messages,
  { msgId, intent, bufferedText, finalText },
) {
  if (!Array.isArray(messages) || !msgId) return messages;
  const text = finalText || bufferedText;
  if (!text) return messages;
  const idx = messages.findLastIndex((m) => m.id === msgId);
  if (idx === -1) {
    return [...messages, { id: msgId, role: 'system', text, intent, isStreaming: false }];
  }
  const updated = [...messages];
  updated[idx] = { ...updated[idx], text, intent: intent ?? updated[idx].intent, isStreaming: false };
  return updated;
}

/**
 * Simulate pre-wired placeholder streaming: activeMsgId set before tokens arrive,
 * tokens accumulate in a buffer only (no per-token setMessages), then flush at end.
 */
export function simulatePrewiredPlaceholderStream(
  messages,
  tokens,
  intent,
  placeholderId,
) {
  let textBuf = '';
  let rows = Array.isArray(messages) ? [...messages] : [];
  let activeMsgId = placeholderId;
  let activeIntent = intent;

  for (const token of tokens) {
    if (shouldFlushPreviousStream(activeIntent, intent, activeMsgId)) {
      rows = commitStreamingFlush(rows, activeMsgId, textBuf);
      textBuf = '';
      activeMsgId = null;
      activeIntent = null;
    }
    if (activeMsgId == null) {
      activeMsgId = resolveStreamingMessageId(rows, null, intent, () => placeholderId);
      activeIntent = intent;
    }
    textBuf += token;
    activeIntent = intent;
  }
  return commitStreamingFlush(rows, activeMsgId, textBuf);
}

/**
 * In-memory simulation of multi-token same-intent streaming (one row).
 * Returns message list after all tokens are applied.
 */
export function simulateSameIntentTokenStream(messages, tokens, intent, idFactory = () => 'stream-1') {
  let activeMsgId = null;
  let activeIntent = null;
  let rows = Array.isArray(messages) ? [...messages] : [];

  for (const token of tokens) {
    if (shouldFlushPreviousStream(activeIntent, intent, activeMsgId)) {
      activeMsgId = null;
      activeIntent = null;
    }
    activeIntent = intent;
    if (activeMsgId != null) {
      const idx = rows.findIndex((m) => m.id === activeMsgId);
      if (idx !== -1) {
        const updated = [...rows];
        updated[idx] = { ...updated[idx], text: updated[idx].text + token };
        rows = updated;
      }
      continue;
    }
    const id = resolveStreamingMessageId(rows, null, intent, idFactory);
    activeMsgId = id;
    rows = applyFirstStreamingToken(rows, { id, token, intent });
  }
  return rows;
}

/**
 * flushToken when streamingMsgIdRef is null (NativelyInterface ~1488-1492).
 * Buffered text is discarded; no commitStreamingFlush runs.
 */
export function discardStreamingBufferWhenNoMsgId(streamingText) {
  return streamingText != null && streamingText.length > 0 ? '' : streamingText ?? '';
}

/**
 * Models WTA batch+final with Fix 1 (placeholder pre-wired) and Fix 3 (finalize by id).
 * queueToken uses the mid-stream path (streamingMsgIdRef set), so no deferred
 * applyFirstStreamingToken runs after sync finalize.
 */
export function simulateDeferredFirstTokenVsSyncFinalize(
  messages,
  { intent, token, finalText, idFactory = () => 'stream-1' },
) {
  let rows = Array.isArray(messages) ? [...messages] : [];

  let streamingMsgId = null;
  if (rows.length === 0) {
    streamingMsgId = idFactory();
    rows = prepareIntelligenceStreamPlaceholderMessages(rows, intent, streamingMsgId);
  } else {
    const lastIdx = rows.findLastIndex((m) => m.role === 'system' && m.intent === intent);
    if (lastIdx !== -1) {
      streamingMsgId = rows[lastIdx].id;
      rows = rows.map((m, i) =>
        i === lastIdx ? { ...m, isStreaming: true, text: '' } : m,
      );
    } else {
      streamingMsgId = idFactory();
      rows = prepareIntelligenceStreamPlaceholderMessages(rows, intent, streamingMsgId);
    }
  }

  const idx = rows.findIndex((m) => m.id === streamingMsgId);
  if (idx !== -1) {
    const updated = [...rows];
    const row = updated[idx];
    updated[idx] = {
      ...row,
      text: row.text ? row.text + token : token,
      intent,
      isStreaming: true,
    };
    rows = updated;
  }

  return finalizeStreamingByIntentMessages(rows, intent, finalText, idFactory, streamingMsgId);
}

/**
 * Control path: placeholder pre-wired before tokens (Clarify/Recap pattern), then sync finalize.
 */
export function simulatePrewiredPlaceholderWithSyncFinalize(
  messages,
  { intent, tokens, finalText, placeholderId, idFactory = () => 'final-1' },
) {
  const afterStream = simulatePrewiredPlaceholderStream(
    messages,
    tokens,
    intent,
    placeholderId,
  );
  // Production mirrors this: NativelyInterface.finalizeStreamingByIntent captures
  // streamingMsgIdRef.current BEFORE calling flushToken (which clears the ref +
  // sets isStreaming=false on the row), then passes the captured id to
  // finalizeStreamingByIntentMessages so the byId path always wins.
  return finalizeStreamingByIntentMessages(afterStream, intent, finalText, idFactory, placeholderId);
}

/**
 * RC-F: late what_to_answer finalize after manual submit opened a chat placeholder.
 * Returns messages unchanged when the generation guard rejects the event.
 */
export function simulateLateWtaAfterChatPlaceholder(
  messages,
  { wtaAnswer, chatPlaceholderId, idFactory = () => 'late-wta' },
) {
  const hasActiveOpenStream = Array.isArray(messages)
    && messages.some((m) => m.isStreaming && m.id === chatPlaceholderId);
  if (
    !shouldAcceptIntelligenceIpc({
      eventIntent: 'what_to_answer',
      activeStreamIntent: 'chat',
      hasActiveOpenStream,
    })
  ) {
    return messages;
  }
  return finalizeStreamingByIntentMessages(messages, 'what_to_answer', wtaAnswer, idFactory);
}
