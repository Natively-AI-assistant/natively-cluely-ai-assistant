/**
 * Chat-stream registry invalidation (Defect G fix, 2026-08-01).
 *
 * `ipcHandlers.ts` tracks one in-flight manual-chat stream per sender in
 * `_chatStreamsBySender`, and ~10 supersession guards all take the form
 * `_chatStreamsBySender.get(senderId)?.streamId !== myStreamId`.
 *
 * The `modes:set-active` handler used to only `abort()` each entry's
 * controller. That is a RACE, not a decision: the provider HTTP stream can
 * complete before the abort lands, and because the registry entry survived,
 * every streamId guard still evaluated to "I am current" — so an answer
 * generated under the OLD mode was emitted into a UI whose badge already
 * showed the NEW mode.
 *
 * Deleting the entry (mirroring the `gemini-chat-stream-stop` handler) is the
 * load-bearing half: once the entry is gone, every streamId guard reports
 * "superseded" DETERMINISTICALLY, regardless of how the abort raced the
 * provider. Extracted here (rather than inlined in the handler) so the
 * semantics are unit-testable — `ipcHandlers.ts` cannot be functionally
 * isolated under node:test.
 */

export interface ChatStreamEntry {
  streamId: number;
  controller: { abort(): void };
}

/**
 * Abort every in-flight chat stream AND remove it from the registry, so all
 * `get(senderId)?.streamId !== myStreamId` supersession guards become
 * deterministic for the aborted streams. Returns how many entries were
 * invalidated (log/telemetry convenience only).
 */
export function abortAndInvalidateChatStreams<T extends ChatStreamEntry>(
  streams: Map<number, T>,
): number {
  let invalidated = 0;
  for (const [senderId, entry] of streams) {
    try {
      entry.controller.abort();
    } catch {
      /* already finished — the delete below still must happen */
    }
    // Deleting while iterating a Map is safe in JS (spec-defined).
    streams.delete(senderId);
    invalidated += 1;
  }
  return invalidated;
}
