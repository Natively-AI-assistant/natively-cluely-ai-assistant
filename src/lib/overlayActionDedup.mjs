/**
 * Pure helpers for overlay quick-action deduplication (unit-tested).
 * Prevents duplicate LLM calls when the same action fires twice within a window.
 */

/** Normalize action keys for duplicate comparison. */
export function normalizeActionKey(actionKey) {
  return String(actionKey ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Returns true when the same action key was invoked within windowMs.
 */
export function shouldDedupeOverlayAction({
  actionKey,
  lastActionKey,
  lastAtMs,
  nowMs,
  windowMs = 5000,
}) {
  const norm = normalizeActionKey(actionKey);
  if (!norm) return false;
  if (lastActionKey == null || lastAtMs == null) return false;
  if (nowMs - lastAtMs > windowMs) return false;
  return normalizeActionKey(lastActionKey) === norm;
}

/**
 * Collapse consecutive system messages with identical text (UI last resort).
 */
export function collapseConsecutiveDuplicateSystemMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const out = [messages[0]];
  for (let i = 1; i < messages.length; i++) {
    const prev = out[out.length - 1];
    const cur = messages[i];
    if (
      prev.role === 'system' &&
      cur.role === 'system' &&
      prev.text === cur.text &&
      prev.intent === cur.intent
    ) {
      continue;
    }
    out.push(cur);
  }
  return out;
}
