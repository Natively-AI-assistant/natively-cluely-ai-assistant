// Regression test for the "orphan inline reconnect timer double-connect" bug
// in NativelyProSTT.setSampleRate / setRecognitionLanguage / language_detected.
//
// Symptom: setSampleRate (also setRecognitionLanguage and the language_detected
// handler) scheduled an inline `setTimeout(() => { if (this.isActive)
// this.connect(); }, 250)` after closeUpstream(). The handle was NEVER stored,
// so if `stop()` then `start()` ran within that 250 ms window, the orphan timer
// would fire INSIDE the new session. `this.isActive` was true (the new start
// flipped it back on), so the orphan called `connect()` a second time — a race
// against the connect() the new start() itself fires. One of the two WebSockets
// loses, emits close, and triggers a reconnect cascade that briefly drops
// transcripts. The fix introduces a `pendingConnectTimer` field that is
// reassigned on every inline setTimeout and cleared in `start()` and `stop()`.
//
// Strategy: load the COMPILED NativelyProSTT with `Module._load` patched so
// `require('electron')` is harmless, then spy on the instance's `connect`
// method (renamed via the wrapper's mangled-but-public-via-cast field on the
// JS side — esbuild preserves class method names) and assert the call count
// after a stop/start within 250 ms of a scheduled inline reconnect is exactly
// 2, not 3.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const origLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
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

test('setSampleRate inline 250ms reconnect timer must not fire after stop()/start() (no double-connect)', async () => {
    const stt = new NativelyProSTT('fake-api-key', 'mic');

    // Spy: replace `connect` with a counter that records calls and does
    // nothing else (no real WebSocket attempt). We replace the prototype
    // method on the instance via assignment — JS allows access to TS
    // `private` fields at runtime since they're not real privacy.
    let connectCalls = 0;
    stt.connect = function spyConnect() {
        connectCalls++;
    };

    // 1) First start — should call connect() exactly once.
    stt.start();
    assert.equal(connectCalls, 1, 'start() should invoke connect() exactly once');

    // 2) Force the conditions setSampleRate needs to schedule its inline
    //    setTimeout: both isActive and isConnected must be true, and the
    //    new rate must differ from the current rate.
    stt.isActive = true;
    stt.isConnected = true;
    stt.sampleRate = 16000;

    // 3) Trigger the inline 250ms setTimeout. closeUpstream() runs synchronously
    //    inside; ws is null so it's a no-op as expected.
    stt.setSampleRate(48000);

    // Sanity: a pending timer handle must exist now (the fix tracks it).
    assert.ok(
        stt.pendingConnectTimer !== null && stt.pendingConnectTimer !== undefined,
        'setSampleRate should have stored its inline reconnect timer on pendingConnectTimer',
    );

    // 4) Immediately stop() then start() within the 250 ms window. Without
    //    the fix, the orphan timer would survive and fire ~250ms later,
    //    yielding connectCalls === 3 (initial start + new start + orphan).
    stt.stop();
    stt.start();

    // After start(), connect has been called twice (initial + the new start).
    assert.equal(
        connectCalls,
        2,
        `after stop()/start() connect should be called exactly 2 times so far, got ${connectCalls}`,
    );

    // 5) Wait past the 250 ms inline window with margin.
    await new Promise((r) => setTimeout(r, 350));

    // 6) Critical assertion: the orphan timer from step 3 must NOT have fired.
    assert.equal(
        connectCalls,
        2,
        `BUG: orphan inline reconnect timer fired inside the new session — ` +
        `connect was called ${connectCalls} times (expected exactly 2). ` +
        `This means setSampleRate's setTimeout handle was not tracked by ` +
        `pendingConnectTimer (or not cleared by stop()/start()).`,
    );

    // Cleanup: stop() so no timers leak past this test.
    stt.stop();
});
