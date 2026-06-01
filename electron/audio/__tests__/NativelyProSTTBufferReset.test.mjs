// Regression test for the "buffer overflow latch not reset on stop()" bug in
// NativelyProSTT.
//
// Bug: `stop()` cleared `this.buffer = []` but did NOT reset
// `bufferDroppedChunks` (counter) or `bufferOverflowReported` (one-shot flag).
// On a subsequent session, the next buffer overflow:
//   1. Would log a misleading dropped-chunks count carried over from the
//      previous session's outage.
//   2. Would NOT emit the `buffer-overflow` event because
//      `bufferOverflowReported` was still latched true from the prior session.
//
// Fix: stop() now sets both bufferDroppedChunks=0 and
// bufferOverflowReported=false after clearing the buffer.
//
// Strategy: load the compiled `NativelyProSTT.js`, then for each "session"
// stub `connect()` so no real WebSocket is constructed (avoids network/DNS),
// and keep `isConnected === false` so `write()` takes the buffering branch
// where the overflow logic lives. Push BUFFER_MAX_CHUNKS + N chunks to trip
// the overflow, then stop() and repeat.
//
// We assert on internal fields (`bufferDroppedChunks`,
// `bufferOverflowReported`) and on emitted `buffer-overflow` events — these
// directly model the user-observable symptoms.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const { NativelyProSTT } = await import(path.join(distRoot, 'NativelyProSTT.js'));

test('NativelyProSTT.stop() resets buffer-overflow latch and dropped-chunk counter so the next session can re-emit buffer-overflow', () => {
    const stt = new NativelyProSTT('fake-key', 'mic');

    // Stub connect() so start() never opens a real WebSocket. We want the
    // wrapper to think it's "active but not connected", which is the exact
    // state under which write() exercises the buffering / overflow path.
    stt.connect = function patchedConnect() { /* no-op */ };

    const overflowEvents = [];
    stt.on('buffer-overflow', (evt) => { overflowEvents.push(evt); });

    const BUFFER_MAX_CHUNKS = 500;
    const OVERFLOW_BY = 50; // push 550 total — guaranteed > cap
    const chunk = Buffer.alloc(16);

    // ── Session 1 ─────────────────────────────────────────────────────────
    stt.start();
    assert.equal(stt.isActive, true, 'start() should mark the stream active');
    assert.equal(stt.isConnected, false, 'no real ws → isConnected must stay false');

    for (let i = 0; i < BUFFER_MAX_CHUNKS + OVERFLOW_BY; i++) {
        stt.write(chunk);
    }

    assert.equal(
        overflowEvents.length,
        1,
        `session 1 should emit exactly one buffer-overflow event (got ${overflowEvents.length})`,
    );
    assert.equal(
        stt.bufferDroppedChunks,
        OVERFLOW_BY,
        `session 1 should have dropped ${OVERFLOW_BY} chunks (got ${stt.bufferDroppedChunks})`,
    );
    assert.equal(stt.bufferOverflowReported, true, 'session 1 should latch bufferOverflowReported=true');
    assert.equal(stt.buffer.length, BUFFER_MAX_CHUNKS, 'buffer should be capped at BUFFER_MAX_CHUNKS');

    // ── stop() — the unit under test ─────────────────────────────────────
    stt.stop();
    assert.equal(stt.buffer.length, 0, 'stop() should clear the buffer');
    assert.equal(
        stt.bufferDroppedChunks,
        0,
        `BUG: stop() did not reset bufferDroppedChunks (still ${stt.bufferDroppedChunks}) — ` +
        `next session's "N chunks dropped during outage" log would reference the prior session.`,
    );
    assert.equal(
        stt.bufferOverflowReported,
        false,
        'BUG: stop() did not reset bufferOverflowReported — next session\'s overflow would be silent (no event, no warning).',
    );

    // ── Session 2 — must behave like a fresh session ─────────────────────
    // Re-install the connect stub: stop() does not detach it, but be defensive.
    stt.connect = function patchedConnect2() { /* no-op */ };

    stt.start();
    assert.equal(stt.isActive, true, 'second start() should re-activate');

    for (let i = 0; i < BUFFER_MAX_CHUNKS + OVERFLOW_BY; i++) {
        stt.write(chunk);
    }

    assert.equal(
        overflowEvents.length,
        2,
        `BUG: second session did not emit a buffer-overflow event — bufferOverflowReported latch was never reset. ` +
        `Total events seen: ${overflowEvents.length} (expected 2).`,
    );
    assert.equal(
        stt.bufferDroppedChunks,
        OVERFLOW_BY,
        `BUG: dropped-chunk counter did not restart from 0 — got ${stt.bufferDroppedChunks}, ` +
        `expected exactly ${OVERFLOW_BY} dropped in session 2 alone.`,
    );
    assert.equal(stt.bufferOverflowReported, true, 'session 2 should re-latch bufferOverflowReported=true after its own overflow');

    // Cleanup.
    stt.stop();
    stt.removeAllListeners();
});
