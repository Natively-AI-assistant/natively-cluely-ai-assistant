// Regression test for the "second meeting silent capture / STT handshake timeout"
// bug.
//
// Symptom: starting a second meeting after ending the first (with the same
// audio devices) produces ~8 seconds of silence and an STT WebSocket handshake
// timeout, perceived by the user as a "hang".
//
// Root cause:
//   - `electron/main.ts` `reconfigureAudio()` short-circuits when device IDs
//     are unchanged, so the previous meeting's `SystemAudioCapture` /
//     `MicrophoneCapture` wrapper is reused.
//   - Their `stop()` defers `monitor.stop()` via `setImmediate` but does NOT
//     null `this.monitor`.
//   - The next `start()` sees `this.monitor != null`, skips the
//     `new RustAudioCapture()` branch, and calls `monitor.start()` on the
//     already-torn-down native instance, which silently drops chunks.
//
// Strategy: load the COMPILED capture modules with `Module._load` patched so
//   - `require('electron')` returns a stub `app`,
//   - `require('<binary>.node')` returns a fake native module whose
//     `SystemAudioCapture`/`MicrophoneCapture` constructors record per-instance
//     start/stop calls and mark themselves "torn down" after stop.
//
// We then run the start→stop→start sequence on the wrapper and assert the
// next start did NOT call `start()` on the torn-down native instance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

// Bookkeeping across the whole test file. We track every native instance the
// loader hands out so tests can assert against per-instance state.
const created = {
    system: [],
    microphone: [],
};

function makeFakeNativeInstance(kind) {
    const inst = {
        kind,
        startCalls: 0,
        stopCalls: 0,
        torndown: false,
        // Last data callback we were handed by the wrapper. After teardown the
        // Rust DSP thread is gone, so a real torn-down instance would never
        // emit chunks. We simulate that by simply not invoking the callback
        // again once `torndown === true`.
        _dataCb: null,
        start(dataCb /*, speechEndedCb */) {
            this.startCalls++;
            this._dataCb = dataCb;
            // If wrapper calls start() on an already-stopped native instance,
            // the real bug behaviour is "no chunks ever arrive" — we just don't
            // invoke the callback. The wrapper's `this.isRecording` still flips
            // true, masking the silent failure.
            if (this.torndown) {
                // Intentionally do nothing — simulates the silent-capture bug.
                return;
            }
            // Otherwise, simulate a single live chunk on next tick. Not strictly
            // required for these assertions but makes the model more realistic.
            setImmediate(() => {
                if (this.torndown) return;
                try {
                    this._dataCb && this._dataCb(null, Buffer.alloc(1920));
                } catch { /* swallow */ }
            });
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
    getHardwareId: () => 'fake-hw',
    verifyGumroadKey: async () => 'fake',
    getInputDevices: () => [],
    getOutputDevices: () => [],
    SystemAudioCapture: function SystemAudioCaptureCtor(_deviceId) {
        const inst = makeFakeNativeInstance('system');
        created.system.push(inst);
        return inst;
    },
    MicrophoneCapture: function MicrophoneCaptureCtor(_deviceId) {
        const inst = makeFakeNativeInstance('microphone');
        created.microphone.push(inst);
        return inst;
    },
};

// --- Module._load patching ----------------------------------------------------
//
// We must patch BEFORE requiring the compiled wrappers — esbuild has bundled
// the native loader into each wrapper, and the loader caches the native module
// in a module-local variable on first import.

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
    // The loader builds candidate paths like
    //   <appPath>/native-module/index.<platform>-<arch>.node
    // We intercept any require for a path ending in `.node` AND containing
    // `native-module` so the loader's first attempt succeeds.
    if (typeof request === 'string' && request.endsWith('.node') && request.includes('native-module')) {
        return fakeNativeModule;
    }
    return origLoad.apply(this, arguments);
};

// Now we can safely import the compiled wrappers.
const { SystemAudioCapture } = await import(path.join(distRoot, 'SystemAudioCapture.js'));
const { MicrophoneCapture } = await import(path.join(distRoot, 'MicrophoneCapture.js'));

// setImmediate-flush helper. `stop()` defers `monitor.stop()` via setImmediate;
// we wait one macrotask so the deferred teardown actually runs.
function flushSetImmediate() {
    return new Promise((resolve) => setImmediate(resolve));
}

test('SystemAudioCapture restart after stop must not reuse a torn-down native monitor', async () => {
    created.system.length = 0;

    const cap = new SystemAudioCapture('same-device-id');

    // First meeting: start → stop.
    cap.start();
    assert.equal(created.system.length, 1, 'first start should construct a native instance');
    const first = created.system[0];
    assert.equal(first.startCalls, 1, 'first native instance should have been started exactly once');

    await cap.stop();
    await flushSetImmediate();
    assert.equal(first.stopCalls, 1, 'deferred native stop() should have run after setImmediate flush');
    assert.equal(first.torndown, true, 'first native instance must be marked torn down');

    // Second meeting on the SAME wrapper / same device id.
    cap.start();
    await flushSetImmediate();

    // The wrapper must NOT have called start() on the torn-down first instance
    // a second time. Two equivalent ways the production code could be correct:
    //   (a) construct a fresh native instance (created.system.length === 2),
    //   (b) recreate `this.monitor` before calling start, leaving first untouched.
    // Either way the invariant "first.startCalls === 1" holds.
    assert.equal(
        first.startCalls,
        1,
        `BUG: wrapper called start() again on the torn-down native instance — ` +
        `this is exactly the silent-capture bug. first.startCalls=${first.startCalls}, ` +
        `created.system.length=${created.system.length}`,
    );

    // Belt and braces: a fresh native instance should exist for the second meeting.
    assert.ok(
        created.system.length >= 2,
        `BUG: second start() did not construct a fresh native instance ` +
        `(created.system.length=${created.system.length}). ` +
        `The wrapper short-circuited because this.monitor was non-null after stop().`,
    );
    const second = created.system[created.system.length - 1];
    assert.notStrictEqual(second, first, 'second native instance must be a distinct object');
    assert.equal(second.torndown, false, 'fresh native instance must not be torn down');
    assert.equal(second.startCalls, 1, 'fresh native instance should be started exactly once');

    // Cleanup so we don't leak intervals/timers across tests.
    await cap.destroy();
    await flushSetImmediate();
});

test('MicrophoneCapture restart after stop must not reuse a torn-down native monitor', async () => {
    created.microphone.length = 0;

    const cap = new MicrophoneCapture('same-mic-id');

    // Note: MicrophoneCapture uses LAZY init — the constructor does NOT create
    // a native instance. The first construction happens inside start().
    assert.equal(created.microphone.length, 0, 'constructor (lazy init) must not create a native instance');

    cap.start();
    assert.equal(created.microphone.length, 1, 'start() must construct the first native instance');
    const first = created.microphone[0];
    assert.equal(first.startCalls, 1, 'first native instance should have been started exactly once');

    await cap.stop();
    await flushSetImmediate();
    assert.equal(first.stopCalls, 1, 'deferred native stop() should have run after setImmediate flush');
    assert.equal(first.torndown, true, 'first native mic instance must be marked torn down');

    // Second meeting on the SAME wrapper.
    cap.start();
    await flushSetImmediate();

    assert.equal(
        first.startCalls,
        1,
        `BUG: MicrophoneCapture wrapper called start() again on the torn-down ` +
        `native instance — silent mic capture on second meeting. ` +
        `first.startCalls=${first.startCalls}, created.microphone.length=${created.microphone.length}`,
    );

    assert.ok(
        created.microphone.length >= 2,
        `BUG: second start() did not construct a fresh native mic instance ` +
        `(created.microphone.length=${created.microphone.length}).`,
    );
    const second = created.microphone[created.microphone.length - 1];
    assert.notStrictEqual(second, first, 'second native mic instance must be a distinct object');
    assert.equal(second.torndown, false, 'fresh native mic instance must not be torn down');
    assert.equal(second.startCalls, 1, 'fresh native mic instance should be started exactly once');

    await cap.destroy();
    await flushSetImmediate();
});
