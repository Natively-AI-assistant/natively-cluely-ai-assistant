// src/lib/__tests__/StreamingHeightPreTokenBounce2026_09_12.test.mjs
//
// In-app review (2026-09-07, Windows, 2★): "when sending screenshots its window
// size changes rapidly". Reproduced live on macOS 2026-09-12 with the dev-only
// resize trace: after Enter the overlay grew +96px at +0.07s (the streaming
// headroom, committed the moment the empty placeholder row mounted), then
// snapped back -96px at +0.65s before a single token had arrived, then grew
// and snapped again at stream end. Six native setBounds for one short answer.
//
// The headroom exists to batch per-line grows WHILE text is streaming. Before
// the first token there is nothing to batch, so the decision must report the
// exact measured height and leave the headroom for the first real token.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { decideStreamingHeightCommit } from '../streamingHeightDecision.mjs';

const BUFFER = 96;

describe('decideStreamingHeightCommit — headroom waits for the first token', () => {
  test('a brand-new empty placeholder reports the exact height, no headroom', () => {
    const d = decideStreamingHeightCommit({
      streamId: 'm2', lastStreamId: 'm1', committedHeight: 400,
      measuredHeight: 489, hasText: false, bufferPx: BUFFER,
    });
    assert.equal(d.action, 'exact');
    assert.equal(d.height, 489);
    // The stream is NOT adopted yet: the first token must still take the
    // brand-new-card branch and get its own headroom.
    assert.equal(d.nextStreamId, 'm1');
    assert.equal(d.nextCommittedHeight, 400);
  });

  test('the first token on a new stream commits measured + headroom', () => {
    const d = decideStreamingHeightCommit({
      streamId: 'm2', lastStreamId: 'm1', committedHeight: 400,
      measuredHeight: 502, hasText: true, bufferPx: BUFFER,
    });
    assert.equal(d.action, 'commit');
    assert.equal(d.height, 598);
    assert.equal(d.nextStreamId, 'm2');
    assert.equal(d.nextCommittedHeight, 598);
  });

  test('inside the reserved headroom nothing is sent', () => {
    const d = decideStreamingHeightCommit({
      streamId: 'm2', lastStreamId: 'm2', committedHeight: 598,
      measuredHeight: 560, hasText: true, bufferPx: BUFFER,
    });
    assert.equal(d.action, 'none');
    assert.equal(d.nextStreamId, 'm2');
    assert.equal(d.nextCommittedHeight, 598);
  });

  test('content past the headroom grows again with a fresh buffer', () => {
    const d = decideStreamingHeightCommit({
      streamId: 'm2', lastStreamId: 'm2', committedHeight: 598,
      measuredHeight: 610, hasText: true, bufferPx: BUFFER,
    });
    assert.equal(d.action, 'commit');
    assert.equal(d.height, 706);
    assert.equal(d.nextCommittedHeight, 706);
  });

  test('a still-empty placeholder that reflows (status pill) stays exact', () => {
    const d = decideStreamingHeightCommit({
      streamId: 'm2', lastStreamId: 'm1', committedHeight: 400,
      measuredHeight: 510, hasText: false, bufferPx: BUFFER,
    });
    assert.equal(d.action, 'exact');
    assert.equal(d.height, 510);
  });

  test('non-positive measurements are ignored', () => {
    const d = decideStreamingHeightCommit({
      streamId: 'm2', lastStreamId: 'm1', committedHeight: 400,
      measuredHeight: 0, hasText: true, bufferPx: BUFFER,
    });
    assert.equal(d.action, 'none');
  });
});
