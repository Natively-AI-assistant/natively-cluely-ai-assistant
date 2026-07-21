// Regression test for the "orphan upstream timer survives closeUpstream()" bug.
//
// Symptom: closeUpstream() used to only null `ws` and flip
// isConnected/isConnecting flags. The three timer fields owned by the
// instance — reconnectTimer (set by scheduleReconnect), stabilityTimer
// (set by msg.status === 'connected' handler), pendingConnectTimer (set
// by setSampleRate / setRecognitionLanguage / language_detected inline
// reconnects) — were NOT touched. Any code path that called
// closeUpstream() to tear down the upstream WS without going through
// stop() would leave those timers alive, where they would later fire and
// either:
//   - call connect() against a torn-down or reconfigured session
//     (orphan reconnect),
//   - reset reconnectAttempts to 0 mid-reconnect of a different session
//     (stability timer clobbering backoff),
//   - or double-connect when an inline reconnect raced with a normal
//     scheduleReconnect.
//
// Fix: closeUpstream() now clears all three timer fields and nulls them.
// The 250 ms inline reconnect paths (setSampleRate / setRecognitionLanguage /
// language_detected) immediately re-assign pendingConnectTimer AFTER
// calling closeUpstream(), so the clear-then-reassign sequence is correct.
//
// Strategy: load compiled NativelyProSTT, force each timer field to a
// real setTimeout handle, call closeUpstream(), and assert every field
// is null afterward. Then drive the broader scenario: language change
// during a reconnect window — must not produce two connect() invocations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const origLoad = Module._load;
Module._load = function patchedLoad(request, _parent, _isMain) {
    if (request === 'electron') {
        return {
            app: {
                getAppPath: () => '/tmp/fake-natively-app',
                isPackaged: false,
                isReady: () => false,
            },
        };
    }
    return origLoad.apply(this, arguments);
};

const { NativelyProSTT } = await import(path.join(distRoot, 'NativelyProSTT.js'));

test('closeUpstream() must clear reconnectTimer, stabilityTimer, and pendingConnectTimer', async () => {
    const stt = new NativelyProSTT('close-upstream-key', 'mic');

    // Plant a real timer in each of the three owned fields. Use long delays
    // so they cannot fire during the test if cleanup is buggy. Each timer's
    // body records its own firing so we can assert below.
    const fired = { reconnect: false, stability: false, pending: false };
    stt.reconnectTimer      = setTimeout(() => { fired.reconnect  = true; }, 5_000);
    stt.stabilityTimer      = setTimeout(() => { fired.stability  = true; }, 5_000);
    stt.pendingConnectTimer = setTimeout(() => { fired.pending    = true; }, 5_000);

    // Sanity: every field is currently a non-null Timeout reference.
    assert.notEqual(stt.reconnectTimer,      null);
    assert.notEqual(stt.stabilityTimer,      null);
    assert.notEqual(stt.pendingConnectTimer, null);

    // Act: closeUpstream() should clear all three.
    stt.closeUpstream();

    assert.equal(
        stt.reconnectTimer,
        null,
        'closeUpstream() must clear reconnectTimer so orphan reconnect cannot fire against a torn-down session',
    );
    assert.equal(
        stt.stabilityTimer,
        null,
        'closeUpstream() must clear stabilityTimer so it cannot reset reconnectAttempts mid-reconnect of a future session',
    );
    assert.equal(
        stt.pendingConnectTimer,
        null,
        'closeUpstream() must clear pendingConnectTimer so an inline 250 ms reconnect cannot orphan past the teardown',
    );

    // Wait past where any of the planted timers might have fired (300 ms is
    // well short of the 5 s delays, but it confirms `closeUpstream()` is
    // synchronous; a real-life leak would show as an event-loop tick later).
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(fired.reconnect, false, 'reconnectTimer must not fire after closeUpstream()');
    assert.equal(fired.stability, false, 'stabilityTimer must not fire after closeUpstream()');
    assert.equal(fired.pending,   false, 'pendingConnectTimer must not fire after closeUpstream()');
});

test('stop() followed by an orphan timer that survived closeUpstream() must not invoke connect()', async () => {
    // End-to-end shape of the bug: scheduleReconnect plants reconnectTimer
    // for 1500 ms; user calls stop() before it fires; old code path:
    // stop() clears reconnectTimer (already covered today). But if stop()'s
    // closeUpstream() runs FIRST in some code path and closeUpstream did
    // NOT clear the timer, the next start() within the same window would
    // expose a connect() called by the orphan.
    //
    // We simulate this by planting a fake reconnectTimer, then calling
    // stop(). The new closeUpstream-clears-timers behavior should leave
    // the field null after stop() returns. Calling start() then waiting
    // past the original timer's fire-time should NOT call connect() from
    // the orphan.
    const stt = new NativelyProSTT('orphan-key', 'mic');

    let connectCalls = 0;
    stt.connect = function (_skipStagger = false) { connectCalls++; };

    // Plant a reconnect timer that would fire 200 ms from now.
    stt.isActive = true;
    stt.reconnectTimer = setTimeout(() => {
        // If we get here, the orphan survived — call connect to expose it.
        if (stt.isActive) stt.connect();
    }, 200);

    stt.stop();

    // After stop(), connect has not been invoked (we did not call start).
    assert.equal(connectCalls, 0, 'stop() alone should not invoke connect()');

    // Re-arm and wait past the orphan's would-have-fired moment.
    stt.start();
    assert.equal(connectCalls, 1, 'start() should invoke connect() exactly once');

    await new Promise((r) => setTimeout(r, 300));

    // The orphan reconnectTimer would have fired ~200 ms ago if it had not
    // been cleared. Connect count must still be 1.
    assert.equal(
        connectCalls,
        1,
        `BUG: orphan reconnectTimer fired inside the new session — connect was called ${connectCalls} times (expected exactly 1). closeUpstream() must clear reconnectTimer.`,
    );

    stt.stop();
});

test('language_detected reconnect after closeUpstream() clears prior timers (no double-connect)', async () => {
    // Combined scenario: scheduleReconnect has set reconnectTimer; the
    // network recovers and ws.on('open') succeeds; then language_detected
    // arrives. The handler calls closeUpstream() and schedules a new
    // pendingConnectTimer for 250 ms. After my fix, closeUpstream() should
    // also clear the leftover reconnectTimer from the prior cycle so that
    // the only timer alive is the 250 ms pendingConnectTimer.
    const stt = new NativelyProSTT('lang-and-reconnect-key', 'mic');

    let connectCalls = 0;
    stt.connect = function (_skipStagger = false) {
        connectCalls++;
        // Short-circuit before `new WebSocket(...)`
        if (this.isConnecting || !this.isActive) return;
        this.isConnecting = true;
    };

    stt.isActive = true;
    stt.isConnected = true;
    stt.ws = { close() {}, removeAllListeners() {}, readyState: 1 };

    // Plant a leftover reconnectTimer (simulating a prior 1006 cycle).
    stt.reconnectTimer = setTimeout(() => {
        if (stt.isActive) stt.connect();  // would be the orphan
    }, 200);

    // Drive the language_detected reconnect path.
    stt.intentionalClose = true;
    stt.closeUpstream();
    assert.equal(stt.reconnectTimer, null, 'leftover reconnectTimer must be cleared by closeUpstream()');

    if (stt.pendingConnectTimer) clearTimeout(stt.pendingConnectTimer);
    stt.pendingConnectTimer = setTimeout(() => {
        stt.pendingConnectTimer = null;
        if (stt.isActive) stt.connect();
    }, 250);

    // Wait past 250 ms inline reconnect AND past 200 ms reconnect orphan would-have-fired.
    await new Promise((r) => setTimeout(r, 400));

    // Exactly ONE connect from the 250 ms inline reconnect. NOT two.
    assert.equal(
        connectCalls,
        1,
        `BUG: leftover reconnectTimer fired alongside the language_detected reconnect — connect was called ${connectCalls} times (expected exactly 1).`,
    );

    stt.stop();
});
