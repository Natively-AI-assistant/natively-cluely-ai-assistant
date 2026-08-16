// F-106 regression test (audit/autopilot-2026-08-14).
//
// MicrophoneStream::new opens the cpal input device at CONSTRUCTION (the
// wrapper's lazy-init comment documents that construction alone lights the
// macOS orange mic indicator). When monitor.start() throws after a
// successful construct (WASAPI play() failure, device pulled between
// construct and play, exclusive-mode steal), the catch rethrows — and with
// isRecording false, every later stop()/destroy() early-returns, so the open
// device handle was orphaned until the GC finalizer ran: indicator stuck on,
// device held against the Settings > Audio-test retry. SystemAudioCapture
// has carried the equivalent ORPHAN-HANDLE FIX since 2026-07; this pins the
// mic-side mirror.
//
// Harness: the fake-native-module injection used by CaptureStopAwaitable /
// CaptureRestartRegression, against the dist bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const created = [];
const fakeNativeModule = {
    getHardwareId: () => 'fake',
    verifyGumroadKey: async () => 'fake',
    getInputDevices: () => [],
    getOutputDevices: () => [],
    SystemAudioCapture: function () {
        return { start() {}, stop() {}, getSampleRate: () => 16000 };
    },
    MicrophoneCapture: function () {
        const inst = {
            stopCalls: 0,
            start() { throw new Error('forced native start failure'); },
            stop() { this.stopCalls += 1; },
            getSampleRate: () => 16000,
            getNativeSampleRate: () => 48000,
        };
        created.push(inst);
        return inst;
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

const { MicrophoneCapture } = await import(path.join(distRoot, 'MicrophoneCapture.js'));

test('failed start() releases the constructed native handle deterministically', async () => {
    created.length = 0;
    const cap = new MicrophoneCapture('test-mic');
    cap.on('error', () => {});

    assert.throws(() => cap.start(), /forced native start failure/);
    assert.equal(created.length, 1, 'native monitor must have been constructed');

    // The paths a real caller takes after the throw.
    await cap.stop();
    await cap.destroy();
    // The orphan-stop is deferred via setImmediate — drain it.
    await new Promise((r) => setImmediate(() => setImmediate(r)));

    assert.ok(
        created[0].stopCalls >= 1,
        'the failed-start monitor must be stopped deterministically — otherwise the open cpal device is held until GC (F-106)'
    );
});
