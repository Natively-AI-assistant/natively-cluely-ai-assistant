// Regression test for the "pre-warm failure was silently swallowed" observability fix.
//
// Bug: In MicrophoneCapture.stop()'s deferred setImmediate callback, after the
// native monitor.stop() runs we eagerly construct a fresh RustMicCapture as a
// pre-warm for the next meeting. If that constructor throws (e.g. CoreAudio HAL
// transient failure, cpal init error, USB device yanked between stop and
// pre-warm), the previous implementation only console.error'd the failure. No
// event was emitted, so main.ts / AudioRecovery / telemetry had no observability
// hook — the next start()'s defensive re-init would surface a generic error far
// removed from the original cause.
//
// Fix: emit a structured 'pre_warm_failed' event with the underlying Error.
//
// Strategy: mirror CaptureRestartRegression.test.mjs — patch Module._load to
// inject a fake native module. Track `micInstanceCount` and throw from the
// MicrophoneCapture native constructor ONLY on the SECOND invocation, so:
//   1. lazy init: ctor does not construct  (instance count = 0)
//   2. start() works                       (instance #1 succeeds)
//   3. stop()'s deferred pre-warm throws   (instance #2 attempt)
// We then assert the 'pre_warm_failed' listener fired with the simulated error.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

// Per-test bookkeeping. The MicrophoneCapture native constructor consults this
// counter and throws on call #2.
let micInstanceCount = 0;

function makeFakeMicInstance() {
    return {
        startCalls: 0,
        stopCalls: 0,
        torndown: false,
        _dataCb: null,
        start(dataCb /*, speechEndedCb */) {
            this.startCalls++;
            this._dataCb = dataCb;
            // No chunks needed for this regression — the test only cares about
            // the setImmediate-driven pre-warm path inside stop().
        },
        stop() {
            this.stopCalls++;
            this.torndown = true;
        },
        getSampleRate() { return 48000; },
    };
}

const fakeNativeModule = {
    getHardwareId: () => 'fake-hw',
    verifyGumroadKey: async () => 'fake',
    getInputDevices: () => [],
    getOutputDevices: () => [],
    SystemAudioCapture: function SystemAudioCaptureCtor(_deviceId) {
        // Not exercised by this test, but keep a no-op shape so the loader
        // doesn't crash if some module-load side effect touches it.
        return makeFakeMicInstance();
    },
    MicrophoneCapture: function MicrophoneCaptureCtor(_deviceId) {
        micInstanceCount++;
        if (micInstanceCount === 2) {
            // Simulate a cpal/HAL init failure on the pre-warm attempt only.
            throw new Error('simulated pre-warm cpal init failure');
        }
        return makeFakeMicInstance();
    },
};

// --- Module._load patching (must run BEFORE importing compiled wrappers) -----

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
    if (typeof request === 'string' && request.endsWith('.node') && request.includes('native-module')) {
        return fakeNativeModule;
    }
    return origLoad.apply(this, arguments);
};

const { MicrophoneCapture } = await import(path.join(distRoot, 'MicrophoneCapture.js'));

// stop()'s deferred work runs inside `setImmediate`. We flush by awaiting one
// setImmediate of our own — Node's immediate queue is FIFO so ours runs after
// the wrapper's.
function flushSetImmediate() {
    return new Promise((resolve) => setImmediate(resolve));
}

test('MicrophoneCapture emits pre_warm_failed when deferred pre-warm constructor throws', async () => {
    micInstanceCount = 0;

    // Construction (lazy init): does NOT consume a native instance. The
    // native monitor is constructed lazily in start() (consumes instance #1).
    const cap = new MicrophoneCapture('mic-device-id');
    assert.equal(micInstanceCount, 0, 'lazy init must not construct the native monitor in the constructor');

    // Collect any 'pre_warm_failed' emissions.
    const preWarmFailures = [];
    cap.on('pre_warm_failed', (err) => {
        preWarmFailures.push(err);
    });
    // Suppress unhandled 'error' just in case (the fix only emits
    // 'pre_warm_failed', but be defensive so a regression doesn't blow up the
    // test runner via EventEmitter's unhandled-error semantics).
    cap.on('error', () => {});

    // start() constructs the monitor (instance #1, succeeds). It does NOT
    // construct a second one — start() reuses the monitor it just built.
    cap.start();
    assert.equal(micInstanceCount, 1, 'start() must construct exactly one native instance');

    // stop() defers monitor.stop() + pre-warm `new RustMicCapture(...)` via
    // setImmediate. The pre-warm is the SECOND constructor call, which our
    // fake native module is rigged to throw on.
    await cap.stop();
    await flushSetImmediate();

    assert.equal(
        micInstanceCount,
        2,
        `pre-warm should have ATTEMPTED to construct a second native instance ` +
        `(micInstanceCount=${micInstanceCount}). If this is 1, stop()'s ` +
        `setImmediate pre-warm path didn't run.`,
    );

    assert.equal(
        preWarmFailures.length,
        1,
        `BUG: expected exactly one 'pre_warm_failed' emission, got ${preWarmFailures.length}. ` +
        `This is the original observability gap — the catch in stop()'s ` +
        `setImmediate only console.error'd the failure.`,
    );

    const err = preWarmFailures[0];
    assert.ok(err instanceof Error, `'pre_warm_failed' payload must be an Error, got ${typeof err}`);
    assert.match(
        err.message,
        /simulated/,
        `'pre_warm_failed' Error.message should propagate the underlying cause; got: ${err.message}`,
    );

    await cap.destroy();
    await flushSetImmediate();
});
