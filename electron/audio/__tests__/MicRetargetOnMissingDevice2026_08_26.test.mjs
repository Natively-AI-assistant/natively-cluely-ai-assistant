// Regression test for the mic-recovery dead fallback (2026-08-26).
//
// setupMicRecoveryHandler carried
//     try { new MicrophoneCapture(savedId) } catch { new MicrophoneCapture() }
// which can never fire: MicrophoneCapture is LAZY (its constructor must not
// touch the HAL, or the macOS orange mic indicator lights outside a meeting),
// so a missing/unopenable device is only detected inside start(), where the
// NATIVE monitor is constructed. Every recovery attempt therefore retried the
// identical dead device id — the production symptom was
//     [MicRecovery] Recovery attempt #1 failed: Failed: Input device
//     'NativelySystemAudioTap' not found.
// repeating with no fallback and no terminal banner.
//
// The fix is retargetDevice(): after a failed start the wrapper holds no native
// handle, so the caller re-points THIS instance at the system default and
// starts again — keeping its wireMicCapture() wiring and avoiding a deferred
// teardown racing a fresh device open.
//
// Harness: the fake-native-module injection used by
// MicFailedStartReleasesHandle2026_08_14, against the dist bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const constructedWith = [];

const fakeNativeModule = {
    getHardwareId: () => 'fake',
    verifyGumroadKey: async () => 'fake',
    getInputDevices: () => [],
    getOutputDevices: () => [],
    SystemAudioCapture: function () {
        return { start() {}, stop() {}, getSampleRate: () => 16000 };
    },
    // Mirrors Rust resolve_input_device(): an unknown id throws at CONSTRUCTION
    // of the native monitor, `null`/default always succeeds.
    MicrophoneCapture: function (deviceId) {
        constructedWith.push(deviceId ?? null);
        if (deviceId === 'NativelySystemAudioTap') {
            throw new Error(
                "Failed: Input device 'NativelySystemAudioTap' not found. " +
                'Available devices: iPhone Microphone, MacBook Air Microphone',
            );
        }
        return {
            start() {},
            stop() {},
            getSampleRate: () => 16000,
            getNativeSampleRate: () => 48000,
        };
    },
};

const origLoad = Module._load;
Module._load = function patched(request) {
    if (request === 'electron') {
        return { app: { getAppPath: () => '/tmp/fake', isPackaged: false, isReady: () => false } };
    }
    if (request.endsWith('.node') || request.includes('native-module')) {
        return fakeNativeModule;
    }
    return origLoad.apply(this, arguments);
};

const { MicrophoneCapture } = await import(
    pathToFileURL(path.join(distRoot, 'MicrophoneCapture.js')).href
);

test('constructing with a missing device does NOT throw — only start() does', () => {
    constructedWith.length = 0;
    const cap = new MicrophoneCapture('NativelySystemAudioTap');
    cap.on('error', () => {});

    assert.equal(
        constructedWith.length,
        0,
        'BUG: the wrapper constructed a native monitor eagerly. Lazy init is what keeps ' +
        'the macOS orange mic indicator off outside a meeting — and it is why any ' +
        'fallback wrapped around `new MicrophoneCapture(id)` is dead code.',
    );

    assert.throws(() => cap.start(), /not found/);
    assert.deepEqual(constructedWith, ['NativelySystemAudioTap']);
});

test('retargetDevice(null) + start() recovers onto the system default', () => {
    constructedWith.length = 0;
    const cap = new MicrophoneCapture('NativelySystemAudioTap');
    cap.on('error', () => {});

    assert.throws(() => cap.start(), /not found/);

    // The recovery path: no destroy, no re-wire.
    cap.retargetDevice(null);
    cap.start();

    assert.deepEqual(
        constructedWith,
        ['NativelySystemAudioTap', null],
        'BUG: after a failed start the wrapper must retry on the default device. ' +
        'Retrying the same id is the loop that left the mic dead for the whole meeting.',
    );
});

test('listeners survive the retarget (no destroy/recreate)', () => {
    const cap = new MicrophoneCapture('NativelySystemAudioTap');
    let errors = 0;
    let started = 0;
    cap.on('error', () => { errors += 1; });
    cap.on('start', () => { started += 1; });

    assert.throws(() => cap.start(), /not found/);
    assert.equal(errors, 1, 'the failed start must still emit error for the recovery handler');

    cap.retargetDevice(null);
    cap.start();
    assert.equal(started, 1, "BUG: 'start' listener was lost — retarget must not tear the wrapper down");
});

test('retargetDevice refuses to run on a live wrapper', () => {
    const cap = new MicrophoneCapture(null);
    cap.on('error', () => {});
    cap.start();

    assert.throws(
        () => cap.retargetDevice('MacBook Air Microphone'),
        /inactive wrapper/,
        'BUG: swapping deviceId under a live cpal stream desyncs the wrapper from the ' +
        'device actually being captured.',
    );
});
