// Regression test for the "pre-warm runs inside the deferred teardown body"
// bug.
//
// Symptom: MicrophoneCapture.stop() used to schedule a setImmediate that
// did TWO things in one body:
//   1. monitor.stop() — release the cpal stream / HAL handle
//   2. this.monitor = new RustMicCapture(...) — pre-warm the next start
// Side effects:
//   - With the awaitable-stop contract from Issue 4, `await capture.stop()`
//     would resolve only after BOTH ran. Pre-warm is wasted work when the
//     wrapper is being destroyed (device swap, aborted init, app quit) —
//     so destroy() would force callers to wait for an FFI constructor that
//     was about to be nulled out anyway.
//   - On `before-quit`, pre-warm would grab the OS mic for a process about
//     to die — leaking a native handle past V8 teardown.
//
// Fix:
//   - Pull pre-warm OUT of the setImmediate body. The body now only does
//     monitor.stop() and resolves the teardown promise.
//   - Pre-warm runs in a separate .then() chained off the teardown promise.
//   - A new `preWarmEnabled` instance flag gates the .then() body.
//   - destroy() flips preWarmEnabled=false BEFORE calling stop() so the
//     post-teardown pre-warm is skipped.
//   - main.ts can also call `disablePreWarm()` directly on a capture in
//     contexts where the wrapper will be reused but the next start is not
//     imminent (aborted init, app quit).
//
// Strategy: same fake-native-module harness as CaptureStopAwaitable; count
// the native constructor invocations across stop/destroy cycles and pin:
//   - default stop() pre-warms (constructor count goes up by 1 after stop)
//   - destroy() does NOT pre-warm (constructor count stays put)
//   - disablePreWarm() before stop() suppresses the next pre-warm

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

let micConstructorCalls = 0;
function makeFakeMic() {
    micConstructorCalls++;
    return {
        startCalls: 0,
        stopCalls: 0,
        torndown: false,
        start(_cb) { this.startCalls++; },
        stop() { this.stopCalls++; this.torndown = true; },
        getSampleRate() { return 48000; },
    };
}

const fakeNativeModule = {
    getHardwareId: () => 'fake',
    verifyGumroadKey: async () => 'fake',
    getInputDevices: () => [],
    getOutputDevices: () => [],
    SystemAudioCapture: function () { return { start() {}, stop() {}, getSampleRate: () => 48000 }; },
    MicrophoneCapture: function () { return makeFakeMic(); },
};

const origLoad = Module._load;
Module._load = function patched(request, _parent, _isMain) {
    if (request === 'electron') {
        return {
            app: {
                getAppPath: () => '/tmp/fake',
                isPackaged: false,
                isReady: () => false,
            },
        };
    }
    if (request.endsWith('.node') || request.includes('native-module')) {
        return fakeNativeModule;
    }
    return origLoad.apply(this, arguments);
};

const { MicrophoneCapture } = await import(path.join(distRoot, 'MicrophoneCapture.js'));

// Helper: wait for a microtask + setImmediate cycle so the
// teardownPromise.then() chained pre-warm gets a chance to run.
async function drainPostTeardown() {
    // setImmediate flush: the .then() callback enqueued via Promise then
    // resolution runs as a microtask after setImmediate, but we need to also
    // give the native fake's stop() call a tick to flip flags.
    await new Promise((r) => setImmediate(r));
    await Promise.resolve();
    await Promise.resolve();
}

test('default stop() pre-warms — constructor count increments by exactly 1 after teardown', async () => {
    micConstructorCalls = 0;
    const cap = new MicrophoneCapture('default-prewarm');
    assert.equal(micConstructorCalls, 1, 'constructor (eager init) should fire exactly once');
    cap.start();

    await cap.stop();
    // After await stop(), the native HAL is released but the pre-warm runs
    // in a separate .then() — give it a microtask + setImmediate to land.
    await drainPostTeardown();

    assert.equal(
        micConstructorCalls,
        2,
        `BUG: default stop() must pre-warm by constructing exactly 1 fresh native instance. Got ${micConstructorCalls} total constructions (expected 2 — eager init + 1 pre-warm).`,
    );

    await cap.destroy();
});

test('destroy() does NOT pre-warm', async () => {
    micConstructorCalls = 0;
    const cap = new MicrophoneCapture('destroy-no-prewarm');
    assert.equal(micConstructorCalls, 1);
    cap.start();

    await cap.destroy();
    await drainPostTeardown();

    assert.equal(
        micConstructorCalls,
        1,
        `BUG: destroy() must suppress the post-teardown pre-warm. Got ${micConstructorCalls} constructions (expected 1 — only the eager init).`,
    );
});

test('disablePreWarm() before stop() suppresses the pre-warm', async () => {
    micConstructorCalls = 0;
    const cap = new MicrophoneCapture('disable-prewarm-test');
    assert.equal(micConstructorCalls, 1);
    cap.start();

    cap.disablePreWarm();
    await cap.stop();
    await drainPostTeardown();

    assert.equal(
        micConstructorCalls,
        1,
        `BUG: disablePreWarm() must suppress the post-teardown pre-warm. Got ${micConstructorCalls} constructions (expected 1).`,
    );

    await cap.destroy();
});

test('pre-warm is queued, not run, during the synchronous portion of stop()', async () => {
    // The whole point of separating pre-warm from the synchronous body of
    // stop() is so that callers see "HAL handle released, native side
    // settled" as the contract of `await stop()` — without paying a
    // synchronous FFI constructor inside the JS event-loop turn that called
    // stop(). The pre-warm runs as a chained .then() microtask AFTER the
    // teardown promise resolves.
    //
    // We assert: immediately after the synchronous call `cap.stop()`
    // returns (before any microtask / setImmediate runs), the constructor
    // has NOT been called — i.e. pre-warm is purely scheduled, not
    // inline. Then we drain and verify it fires.
    micConstructorCalls = 0;
    const cap = new MicrophoneCapture('ordering-test');
    assert.equal(micConstructorCalls, 1, 'eager init only');
    cap.start();

    const stopP = cap.stop();          // synchronous return, promise pending
    assert.equal(
        micConstructorCalls,
        1,
        `BUG: stop() executed pre-warm synchronously. After the unawaited stop() call returns, constructor count is ${micConstructorCalls} (expected 1: pre-warm should be deferred to setImmediate + microtask).`,
    );

    await stopP;
    await drainPostTeardown();

    assert.equal(
        micConstructorCalls,
        2,
        `pre-warm should have fired after teardown resolved + microtask drain; got ${micConstructorCalls}.`,
    );

    await cap.destroy();
});

test('start() racing pre-warm: a fast start() before the .then() fires constructs its own native instance, and the pre-warm then skips', async () => {
    // The realistic shape of the race:
    //   1. cap.stop() — schedules setImmediate teardown; sets this.monitor=null
    //      synchronously and emits 'stop'.
    //   2. cap.start() — fired BEFORE the setImmediate has run. Sees
    //      this.monitor===null and constructs a fresh native instance.
    //   3. setImmediate fires — calls stop() on the OLD captured monitor,
    //      resolves the teardown promise.
    //   4. .then() body runs — sees this.monitor !== null (start() grabbed
    //      it), skips its own constructor call.
    // Invariant: total constructions = eager init + 1 from start() racing
    // pre-warm + 0 from pre-warm itself = 2.
    micConstructorCalls = 0;
    const cap = new MicrophoneCapture('start-races-prewarm');
    cap.start();

    cap.stop();         // synchronously nulls this.monitor; sets isRecording=false
    cap.start();        // races ahead: constructs B, monitor.start(B)

    // Drain teardown + pre-warm .then().
    await drainPostTeardown();
    await drainPostTeardown();  // a second tick to let the post-stop .then chain settle

    assert.equal(
        micConstructorCalls,
        2,
        `BUG: pre-warm should have skipped because start() raced ahead and grabbed a fresh native handle. ` +
        `Total constructions = ${micConstructorCalls} (expected 2: eager + start-race; ` +
        `3 would mean pre-warm built a third instance despite this.monitor !== null).`,
    );

    await cap.destroy();
});
