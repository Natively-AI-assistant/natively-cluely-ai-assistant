// Regression test for the "deferred native teardown is fire-and-forget"
// bug.
//
// Symptom: MicrophoneCapture.stop() and SystemAudioCapture.stop() used to
// return `void`. Internally they flipped isRecording=false synchronously,
// then scheduled the blocking `monitor.stop()` via setImmediate so the
// renderer's "Stop" click could return without waiting for the native
// HAL handle to release. The cost of that ergonomic choice was that
// callers had no way to know when teardown was *actually* done — every
// stop() was fire-and-forget. The most expensive consequence was the
// HAL property-listener race: endMeeting() returned, the next
// startMeeting() constructed a fresh native instance, and the dying
// monitor's `monitor.stop()` (still queued in setImmediate) ran
// concurrently with the new constructor — both grabbing the CoreAudio
// HAL lock, deadlocking the Electron main thread and freezing UI mid-paint.
//
// Fix: stop() now returns Promise<void> that resolves only after the
// setImmediate body has called monitor.stop() (and the in-class
// pre-warm reconstruction has finished). Subsequent stop() calls during
// the same teardown return the same in-flight promise (idempotent).
// destroy() awaits stop() before removeAllListeners() so in-flight Rust
// callbacks cannot fire on a wrapper the caller considers dead.
//
// Strategy: reuse the fake-native-module harness from
// CaptureRestartRegression to control monitor.stop() timing and assert
// that `await capture.stop()` only resolves after monitor.stop() has run.
// We DO NOT call `flushSetImmediate` — the awaitable contract says the
// promise itself drives the timing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const created = { system: [], microphone: [] };

function makeFakeNative(kind) {
    const inst = {
        kind,
        startCalls: 0,
        stopCalls: 0,
        torndown: false,
        _dataCb: null,
        start(dataCb) {
            this.startCalls++;
            this._dataCb = dataCb;
        },
        stop() {
            this.stopCalls++;
            this.torndown = true;
        },
        getSampleRate() { return 48000; },
    };
    return inst;
}

const fakeNativeModule = {
    getHardwareId: () => 'fake',
    verifyGumroadKey: async () => 'fake',
    getInputDevices: () => [],
    getOutputDevices: () => [],
    SystemAudioCapture: function (_d) {
        const i = makeFakeNative('system');
        created.system.push(i);
        return i;
    },
    MicrophoneCapture: function (_d) {
        const i = makeFakeNative('microphone');
        created.microphone.push(i);
        return i;
    },
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
const { SystemAudioCapture } = await import(path.join(distRoot, 'SystemAudioCapture.js'));

test('MicrophoneCapture.stop() returns a Promise that resolves after native teardown', async () => {
    created.microphone.length = 0;
    const cap = new MicrophoneCapture('test-mic');
    cap.start();

    const first = created.microphone[0];
    assert.equal(first.stopCalls, 0, 'native stop has not been called yet');

    const p = cap.stop();
    assert.ok(p instanceof Promise, 'stop() must return a Promise');
    // Synchronously after stop() returns the JS-side isRecording flag is
    // off, but the native monitor.stop() is still queued in setImmediate.
    assert.equal(cap.isRecording, false, 'isRecording must flip synchronously inside stop()');
    assert.equal(
        first.stopCalls,
        0,
        'native stop must NOT have run synchronously — it should still be queued in setImmediate',
    );

    await p;

    assert.equal(
        first.stopCalls,
        1,
        'after awaiting stop(), native monitor.stop() MUST have run — the awaitable contract is "promise resolves only when HAL handle is released".',
    );
    assert.equal(first.torndown, true, 'fake instance must be marked torn down');

    await cap.destroy();
});

test('SystemAudioCapture.stop() returns a Promise that resolves after native teardown', async () => {
    created.system.length = 0;
    const cap = new SystemAudioCapture('test-output');
    cap.start();

    const first = created.system[0];
    assert.equal(first.stopCalls, 0);

    const p = cap.stop();
    assert.ok(p instanceof Promise, 'stop() must return a Promise');
    assert.equal(first.stopCalls, 0, 'native stop deferred to setImmediate');

    await p;

    assert.equal(
        first.stopCalls,
        1,
        'after awaiting stop(), native monitor.stop() MUST have run.',
    );
    assert.equal(first.torndown, true);

    await cap.destroy();
});

test('stop() is idempotent: two concurrent stop() calls return the same in-flight promise', async () => {
    created.system.length = 0;
    const cap = new SystemAudioCapture('idempotent-test');
    cap.start();

    const first = created.system[0];

    const p1 = cap.stop();
    const p2 = cap.stop();
    // Either same promise reference OR both resolve before the native stop
    // has been called more than once. The strong invariant is "no extra
    // native teardown" — two concurrent stops must not cause two
    // monitor.stop() calls.
    await Promise.all([p1, p2]);

    assert.equal(
        first.stopCalls,
        1,
        `BUG: concurrent stop() calls must coalesce to a single native teardown. Got stopCalls=${first.stopCalls} (expected 1).`,
    );

    // A subsequent stop() after teardown has settled is a no-op resolved
    // promise — does not fire another native stop.
    const p3 = cap.stop();
    await p3;
    assert.equal(
        first.stopCalls,
        1,
        `post-teardown stop() should be a no-op; got stopCalls=${first.stopCalls}.`,
    );

    await cap.destroy();
});

test('destroy() awaits stop() before removing listeners', async () => {
    created.microphone.length = 0;
    const cap = new MicrophoneCapture('destroy-await-test');
    cap.start();

    const first = created.microphone[0];

    // Attach a marker listener; assert it's still attached during
    // monitor.stop() and only removed after the await resolves.
    let stopEmittedAtListenerPresent = false;
    cap.on('stop', () => {
        // listenerCount('stop') > 0 trivially — we're inside one. Real
        // check: removeAllListeners() inside destroy() has NOT yet run.
        stopEmittedAtListenerPresent = cap.listenerCount('stop') > 0;
    });

    await cap.destroy();

    assert.equal(first.stopCalls, 1, 'destroy() must invoke native stop()');
    assert.equal(first.torndown, true);
    assert.equal(
        cap.listenerCount('stop'),
        0,
        'after destroy() resolves, all listeners must be removed',
    );
    assert.equal(
        stopEmittedAtListenerPresent,
        true,
        'the synchronous on("stop") emit inside stop() must fire BEFORE destroy() calls removeAllListeners — otherwise the watchdog disarm and other cleanup listeners never run.',
    );
});

test('Promise<void> shape: stop() can be safely fire-and-forget (no unhandled-rejection regression)', async () => {
    // Many existing callers in main.ts call stop() without `await`. With the
    // signature change those become un-awaited Promise<void>. This test
    // verifies the resolution path does not throw — otherwise it would
    // produce an unhandled-rejection process warning in production.
    created.microphone.length = 0;
    const cap = new MicrophoneCapture('fire-and-forget-test');
    cap.start();

    cap.stop();  // intentionally unawaited

    // Settle the event loop so the setImmediate body and the .then chain
    // both run. If stop() rejects, this assertion site is the one that
    // would surface it as a node:test diagnostic.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const first = created.microphone[0];
    assert.equal(first.stopCalls, 1, 'fire-and-forget stop() must still tear down natively after the event loop drains');

    await cap.destroy();
});
