// Integration test: proves SonioxStreamingSTT.write() is WIRED to the revive
// policy — i.e. the fix actually fires on the compiled class, not just in the
// pure helper (covered exhaustively by SttReconnectRevival.test.mjs).
//
// Scenario driven end-to-end on the real (compiled) class, no network:
//   1. Put the instance in the exact "exhausted & latched off, still active"
//      state the backoff ladder leaves after RECONNECT_MAX_ATTEMPTS failures
//      during a hidden/silent stretch.
//   2. write(audio) BEFORE the revive cooldown → must NOT reconnect.
//   3. write(audio) AFTER the cooldown → must revive: connect() called,
//      shouldReconnect re-enabled, attempts reset, exhaustion marker cleared.
//   4. write(audio) on a user-STOPPED session → must never reconnect.
//
// connect() is stubbed on the instance so no real WebSocket is opened.
//
// Run via `npm test` (which builds dist-electron first) or `node --test` after
// `npm run build:electron`. The compiled class is imported at module load, so a
// missing build fails LOUDLY here (matching CaptureRestartRegression.test.mjs
// et al.) rather than silently skipping the wiring coverage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Import the real default so this wiring test can't drift if the cooldown changes.
import { DEFAULT_REVIVE_COOLDOWN_MS } from '../sttReconnectPolicy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distFile = path.resolve(__dirname, '../../../dist-electron/electron/audio/SonioxStreamingSTT.js');

// Loud, explicit prerequisite: a missing compiled artifact throws here (module
// load) instead of letting each test t.skip() and the suite pass without ever
// validating the wiring.
const { SonioxStreamingSTT } = await import(pathToFileURL(distFile).href);

// Build a fresh instance parked in the exhausted-but-active state, with connect()
// stubbed to just count calls. Returns { stt, calls }.
function makeExhaustedInstance() {
    const stt = new SonioxStreamingSTT('test-key');
    const calls = { connect: 0 };
    // Private in TS, plain method on the compiled JS — override on the instance.
    stt.connect = () => { calls.connect++; };
    // Swallow the 'error' the exhaustion path emits so it doesn't crash the test.
    stt.on('error', () => {});
    // Exhausted-and-latched-off, still active (what the max-attempts branch leaves).
    stt.isActive = true;
    stt.shouldReconnect = false;
    stt.isConnecting = false;
    stt.ws = null;
    stt.configSent = false;
    stt.reconnectAttempts = 10;
    return { stt, calls };
}

test('write() before the cooldown does NOT reconnect an exhausted session', () => {
    const { stt, calls } = makeExhaustedInstance();
    stt.reconnectExhaustedAt = Date.now() - 1000; // only 1s ago, < cooldown
    stt.write(Buffer.from([1, 2, 3, 4]));
    assert.equal(calls.connect, 0, 'must not reconnect within the cooldown');
    assert.equal(stt.shouldReconnect, false, 'still latched off');
});

test('write() after the cooldown REVIVES: reconnect + reset state', () => {
    const { stt, calls } = makeExhaustedInstance();
    stt.reconnectExhaustedAt = Date.now() - (DEFAULT_REVIVE_COOLDOWN_MS + 1000);
    stt.write(Buffer.from([1, 2, 3, 4]));
    assert.equal(calls.connect, 1, 'resumed audio after cooldown must reconnect');
    assert.equal(stt.shouldReconnect, true, 'reconnect re-enabled');
    assert.equal(stt.reconnectAttempts, 0, 'attempt budget reset');
    assert.equal(stt.reconnectExhaustedAt, null, 'exhaustion marker cleared');
});

test('write() never revives a user-stopped session (isActive=false)', () => {
    const { stt, calls } = makeExhaustedInstance();
    stt.isActive = false; // stop() was called
    stt.reconnectExhaustedAt = Date.now() - (DEFAULT_REVIVE_COOLDOWN_MS + 1000);
    stt.write(Buffer.from([1, 2, 3, 4]));
    assert.equal(calls.connect, 0, 'a stopped session must stay stopped');
});
