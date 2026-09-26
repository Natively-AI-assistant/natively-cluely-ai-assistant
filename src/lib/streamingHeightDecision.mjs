/**
 * Pure decision for the overlay's streaming height channel (unit-tested).
 * Extracted from NativelyInterface.tsx's driveStreamingHeight on 2026-09-12
 * after a live repro of the "window size changes rapidly when sending
 * screenshots" review: the +96px headroom was committed the instant the empty
 * placeholder row mounted, then the exact height was reported again before
 * the first token, so every send bounced +96/-96 with nothing to show for it.
 *
 * Headroom only earns its keep while text is actually arriving (it batches the
 * per-line grows). Before the first token the exact height is reported and
 * the stream is deliberately NOT adopted, so the first token still takes the
 * brand-new-card branch and gets its own headroom.
 *
 * @param {{
 *   streamId: string | null,
 *   lastStreamId: string | null,
 *   committedHeight: number,
 *   measuredHeight: number,
 *   hasText: boolean,
 *   bufferPx: number,
 * }} input
 * @returns {{
 *   action: 'commit' | 'exact' | 'none',
 *   height: number,
 *   nextStreamId: string | null,
 *   nextCommittedHeight: number,
 * }}
 */
export function decideStreamingHeightCommit({
  streamId,
  lastStreamId,
  committedHeight,
  measuredHeight,
  hasText,
  bufferPx,
}) {
  const unchanged = {
    action: 'none',
    height: committedHeight,
    nextStreamId: lastStreamId,
    nextCommittedHeight: committedHeight,
  };
  if (!(measuredHeight > 0)) return unchanged;

  // No token yet: the exact height, and no adoption of the stream.
  if (!hasText) {
    return { ...unchanged, action: 'exact', height: measuredHeight };
  }

  // Brand-new answer card: commit fresh with its own headroom.
  if (streamId !== lastStreamId) {
    const committed = measuredHeight + bufferPx;
    return { action: 'commit', height: committed, nextStreamId: streamId, nextCommittedHeight: committed };
  }

  // Still inside the reserved headroom: nothing to send.
  if (measuredHeight <= committedHeight) return unchanged;

  // Content caught up to the headroom: grow again with a fresh buffer.
  const committed = measuredHeight + bufferPx;
  return { action: 'commit', height: committed, nextStreamId: streamId, nextCommittedHeight: committed };
}
