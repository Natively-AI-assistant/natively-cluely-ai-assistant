/**
 * A resumed meeting's chat (2026-11-03, Evin): when Resume continues a saved
 * meeting, the overlay shows that meeting's earlier answers again, so the chat
 * carries on from where it stopped instead of starting empty.
 *
 * Main sends the entries with the start's `session-reset`
 * (electron/services/meeting/meetingResume.ts resumedChatFrom: the newest 40,
 * oldest first, no images). This turns them into overlay messages: what was
 * typed shows as the user's question; a button or hotkey answer (What to
 * answer, Recap, a custom button) shows its name as a label, as it did live.
 *
 * Pure; the same on macOS and Windows.
 */

/** Typed by the user (the chat box or the live search), not a button. */
function wasTyped(entry) {
  return (entry.type === 'chat' && entry.source === 'manual_chat') || entry.type === 'rag_live';
}

/**
 * Overlay messages for the earlier answers: a question (or label) and its
 * answer per entry. Ids start with "resumed-" so they never meet a live id.
 */
export function resumedChatMessages(entries) {
  if (!Array.isArray(entries)) return [];
  const out = [];
  entries.forEach((entry, i) => {
    if (!entry || typeof entry.answer !== 'string' || !entry.answer.trim()) return;
    const question = typeof entry.question === 'string' ? entry.question.trim() : '';
    if (question) {
      out.push({
        id: `resumed-${i}-q`,
        role: 'user',
        text: question,
        ...(wasTyped(entry) ? {} : { isQuickActionLabel: true }),
        ...(entry.hasImages ? { hasScreenshot: true } : {}),
      });
    }
    out.push({ id: `resumed-${i}-a`, role: 'system', text: entry.answer });
  });
  return out;
}

/**
 * The typed turns as Direct Assist history (the last 12 question-answer
 * pairs), so a typed follow-up after a resume can refer to them.
 */
export function resumedDirectHistory(entries) {
  if (!Array.isArray(entries)) return [];
  const turns = [];
  for (const entry of entries) {
    if (!entry || !wasTyped(entry)) continue;
    const question = typeof entry.question === 'string' ? entry.question.trim() : '';
    const answer = typeof entry.answer === 'string' ? entry.answer.trim() : '';
    if (!question || !answer) continue;
    turns.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
  }
  return turns.slice(-24);
}
