/**
 * Guards for intelligence IPC events vs active overlay stream state (RC-F).
 */

/**
 * Whether an incoming intelligence finalize/token should mutate message rows.
 * Rejects late what_to_answer when the user sealed a manual chat submit placeholder.
 */
export function shouldAcceptIntelligenceIpc({
  eventIntent,
  activeStreamIntent,
  hasActiveOpenStream,
}) {
  if (
    eventIntent === 'what_to_answer' &&
    hasActiveOpenStream &&
    activeStreamIntent === 'chat'
  ) {
    return false;
  }
  return true;
}
