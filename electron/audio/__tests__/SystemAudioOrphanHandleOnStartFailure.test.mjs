// Regression test for the "SystemAudioCapture leaks the partially-initialised
// native handle when monitor.start() throws" bug.
//
// Symptom: SystemAudioCapture.start() constructs the Rust monitor lazily
// (lazy init pattern), then calls monitor.start() to spin up the
// CoreAudio Tap / SCK / aggregate-device pipeline. If monitor.start()
// throws, the previous code did:
//     this.isRecording = false;
//     this.monitor = null;   // <-- orphans the dying native instance
//     this.emit('error', error);
// The Rust object holding the half-allocated CoreAudio handles is now
// unreachable from JS but still alive on the V8 heap until GC. On
// CoreAudio it keeps the Tap descriptor / aggregate device open the
// whole time. The user's recovery retry constructs a FRESH monitor on
// the same output device, which races the dying one for the HAL
// property-listener lock — and the user observes "0 chunks in 8s" on
// the rebuild.
//
// Fix: capture the dying monitor reference, null this.monitor, then
// schedule a setImmediate that calls dying.stop() so the native side
// releases its resources deterministically. Run on setImmediate (not
// synchronously) because we're already inside a JS error path and the
// partial init may hold non-reentrant Rust locks.
//
// Strategy: load compiled SystemAudioCapture with a fake native module
// whose monitor.start() throws on first call. Assert:
//   1. The dying monitor's stop() WAS called via setImmediate after the
//      failed start.
//   2. this.monitor was nulled so the next start() takes the lazy-init
//      branch and constructs a fresh native instance.
//   3. After flushing setImmediate, the dying instance is marked
//      `torndown === true`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const created = { system: [] };
let nextSystemShouldThrow = false;

function makeFakeSystem() {
    const inst = {
        kind: 'system',
        startCalls: 0,
        stopCalls: 0,
        torndown: false,
        start(_cb) {
            this.startCalls++;
            if (nextSystemShouldThrow) {
                // Simulate partial init: the Rust constructor allocated the
                // aggregate device, monitor.start() began setting up the
                // CoreAudio Tap, then bailed mid-init with an OSStatus error.
                throw new Error('simulated CoreAudio Tap init failure');
            }
        },
        stop() { this.stopCalls++; this.torndown = true; },
        getSampleRate() { return 48000; },
    };
    return inst;
}

const fakeNativeModule = {
    getHardwareId: () => 'fake',
    verifyGumroadKey: async () => 'fake',
    getInputDevices: () => [],
    getOutputDevices: () => [],
    SystemAudioCapture: function () {
        const i = makeFakeSystem();
        created.system.push(i);
        return i;
    },
    MicrophoneCapture: function () { return { start() {}, stop() {}, getSampleRate: () => 48000 }; },
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

const { SystemAudioCapture } = await import(path.join(distRoot, 'SystemAudioCapture.js'));

function flushSetImmediate() {
    return new Promise((r) => setImmediate(r));
}

test('SystemAudioCapture.start() failure must stop the orphaned native monitor', async () => {
    created.system.length = 0;
    nextSystemShouldThrow = true;

    const cap = new SystemAudioCapture('orphan-test-output');

    // Capture the error so the test runner doesn't see it as unhandled.
    const errors = [];
    cap.on('error', (e) => errors.push(e));

    cap.start();

    assert.equal(created.system.length, 1, 'lazy init should construct exactly one native instance');
    const dying = created.system[0];

    assert.equal(
        dying.startCalls,
        1,
        'monitor.start() must have been called (and then thrown)',
    );
    assert.equal(
        errors.length,
        1,
        'error event must have been emitted after the throw',
    );
    assert.match(
        errors[0].message,
        /simulated CoreAudio Tap init failure/,
        'error payload should be the underlying exception',
    );

    // Critical assertion #1: this.monitor was nulled — force recreate path
    // on next start.
    assert.equal(
        cap.monitor,
        null,
        'this.monitor must be null after failed start so lazy init takes the construct branch on retry',
    );

    // Critical assertion #2: at this point the dying.stop() is queued in
    // setImmediate but has NOT yet fired.
    assert.equal(
        dying.stopCalls,
        0,
        'dying.stop() must be DEFERRED to setImmediate, not called synchronously inside start()',
    );

    // Flush the queue.
    await flushSetImmediate();

    // Critical assertion #3: after flushing, dying.stop() has been called
    // EXACTLY ONCE.
    assert.equal(
        dying.stopCalls,
        1,
        `BUG: orphaned native handle was never released. dying.stop() was called ${dying.stopCalls} times (expected 1). The fix must enqueue a setImmediate to stop the partially-initialised native monitor before nulling.`,
    );
    assert.equal(
        dying.torndown,
        true,
        'dying instance must be marked torn down after orphan-cleanup setImmediate has run',
    );
});

test('After failed start + orphan cleanup, a retry start() constructs a fresh native instance', async () => {
    created.system.length = 0;
    const cap = new SystemAudioCapture('retry-after-failed-start');
    const errors = [];
    cap.on('error', (e) => errors.push(e));

    nextSystemShouldThrow = true;
    cap.start();
    await flushSetImmediate();
    assert.equal(errors.length, 1, 'first start fails');
    assert.equal(created.system.length, 1);
    const first = created.system[0];
    assert.equal(first.torndown, true, 'first instance was torn down after orphan cleanup');

    // Now retry; this time the fake will succeed.
    nextSystemShouldThrow = false;
    cap.start();

    assert.equal(
        created.system.length,
        2,
        `retry must construct a NEW native instance (first one is orphan-stopped). Got ${created.system.length} (expected 2).`,
    );
    const second = created.system[created.system.length - 1];
    assert.notStrictEqual(second, first, 'second native instance must be a distinct object');
    assert.equal(second.torndown, false, 'fresh instance is alive');
    assert.equal(second.startCalls, 1, 'fresh instance has been started exactly once');

    await cap.destroy();
});
