// Regression test for the "second meeting start freezes the UI" deadlock.
//
// Symptom (reproduced live, MEASURE_LATENCY=true npm start):
//   Stop a meeting, then Start another within the same app launch on the
//   SAME input/output devices → the UI hangs and the app must be force-quit.
//   The log freezes inside the Rust MicrophoneStream::new (it prints
//   "[Microphone] Device: ..." but never "[MicrophoneCapture] Initialized.").
//
// Root cause:
//   endMeeting() used to fire `this.microphoneCapture?.stop()` /
//   `this.systemAudioCapture?.stop()` FIRE-AND-FORGET and never nulled the
//   wrapper fields. The dying wrapper survived into the next meeting, so:
//     1. reconfigureAudio() early-returned "Audio reconfigure skipped —
//        device IDs unchanged" (its destroy+recreate block was bypassed), and
//     2. setupSystemAudioPipeline()'s `if (!this.microphoneCapture)` guard was
//        false (wrapper still present), so it did NOT reconstruct, and
//     3. MicrophoneCapture.start() hit its defensive `if (!this.monitor)`
//        branch and SYNCHRONOUSLY ran `new RustMicCapture(deviceId)` on the
//        Electron main thread — WHILE meeting 1's deferred `monitor.stop()`
//        (queued on setImmediate) was still releasing the SAME CoreAudio
//        device. Two operations contend for the CoreAudio HAL
//        property-listener lock on the main thread → deadlock → UI freeze.
//   `_pendingTeardown` (awaited by the next startMeeting) only covered STT
//   drain + RAG — NOT the capture teardown — so the next start raced it.
//
// Fix (in endMeeting()):
//   - Snapshot the live wrappers, NULL the fields synchronously, and tear
//     them down via destroy() (destroy+recreate, not stop+reuse). Nulling
//     forces the next meeting down the serialized reconstruction path instead
//     of the lazy in-start() `new RustMicCapture`.
//   - Thread the combined destroy() promise (`captureTeardownPromise`) into
//     `_pendingTeardown`, AWAITED UP FRONT, so the next startMeeting()'s
//     existing `await this._pendingTeardown` guarantees the dying native
//     handle is fully released BEFORE any new capture opens the same device.
//
// Strategy: a behavioural test (fake native module with a DELAYED stop)
// proving destroy() resolves only after the native release, plus structural
// assertions pinning the load-bearing endMeeting/startMeeting wiring so a
// future refactor that re-introduces the fire-and-forget / no-null pattern
// fails CI loudly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

// ─── Fake native module with controllable stop() timing ──────────────────
// monitor.stop() does not flip `released` until a deferred resolve fires, so
// we can assert that no NEW construction on the same device begins while a
// prior stop() is still in flight.
const deviceState = new Map(); // deviceId -> { liveStops: number, constructedWhileStopping: boolean }

function deviceFor(id) {
    const key = id || 'default';
    if (!deviceState.has(key)) deviceState.set(key, { liveStops: 0, constructedWhileStopping: false });
    return deviceState.get(key);
}

let pendingStopResolvers = [];

function makeFakeMic(deviceId) {
    const dev = deviceFor(deviceId);
    // If a teardown for this device is still in flight when we are
    // constructed, that is exactly the deadlock condition — record it.
    if (dev.liveStops > 0) dev.constructedWhileStopping = true;
    return {
        deviceId,
        startCalls: 0,
        stopCalls: 0,
        start(_cb) { this.startCalls++; },
        stop() {
            // Model the real native stop: it takes wall-clock time (DSP join +
            // HAL release). We mark the device "stopping" synchronously and
            // only clear it when the test drains the deferred resolver.
            this.stopCalls++;
            dev.liveStops++;
            pendingStopResolvers.push(() => { dev.liveStops--; });
        },
        getSampleRate() { return 48000; },
    };
}

const fakeNativeModule = {
    getHardwareId: () => 'fake',
    verifyGumroadKey: async () => 'fake',
    getInputDevices: () => [],
    getOutputDevices: () => [],
    SystemAudioCapture: function (d) { return makeFakeMic('sys:' + (d || 'default')); },
    MicrophoneCapture: function (d) { return makeFakeMic('mic:' + (d || 'default')); },
};

const origLoad = Module._load;
Module._load = function patched(request, _parent, _isMain) {
    if (request === 'electron') {
        return { app: { getAppPath: () => '/tmp/fake', isPackaged: false, isReady: () => false } };
    }
    if (request.endsWith('.node') || request.includes('native-module')) {
        return fakeNativeModule;
    }
    return origLoad.apply(this, arguments);
};

const { MicrophoneCapture } = await import(path.join(distRoot, 'MicrophoneCapture.js'));

// Resolve any in-flight native stop()s, then flush microtasks/setImmediate.
async function releaseNativeStops() {
    const resolvers = pendingStopResolvers;
    pendingStopResolvers = [];
    resolvers.forEach((r) => r());
    await new Promise((r) => setImmediate(r));
    await Promise.resolve();
}

// ─── Behavioural: destroy() resolves only after native release; a new mic on
//     the same device must NOT be constructed before that resolves ──────────
test('meeting-2 mic must not be constructed until meeting-1 destroy() resolves (no HAL overlap)', async () => {
    deviceState.clear();
    pendingStopResolvers = [];

    // Meeting 1: construct + start the mic on the shared device.
    const cap1 = new MicrophoneCapture('shared-device');
    cap1.start();

    // endMeeting()'s teardown: destroy() (disablePreWarm + deferred stop +
    // removeAllListeners). It returns a promise that resolves only after the
    // native monitor.stop() has run.
    const teardown = cap1.destroy();

    // The native stop() is queued on setImmediate; let it fire so the device
    // enters the "stopping" (liveStops>0) window, but do NOT release it yet.
    await new Promise((r) => setImmediate(r));
    const dev = deviceFor('mic:shared-device');
    assert.ok(dev.liveStops > 0, 'native monitor.stop() must be in flight after the setImmediate fires');

    // If the next meeting constructed a fresh mic on the same device RIGHT NOW
    // (the old fire-and-forget bug), it would deadlock. The fix is that
    // startMeeting awaits _pendingTeardown (which includes this destroy())
    // before constructing. Model "correct" by waiting for teardown to resolve.
    let teardownResolved = false;
    void teardown.then(() => { teardownResolved = true; });

    // Drain the native stop so the destroy() promise can resolve.
    await releaseNativeStops();
    await teardown;
    assert.equal(teardownResolved, true, 'destroy() promise must resolve after the native stop is released');
    assert.equal(dev.liveStops, 0, 'native teardown must be fully drained before we construct meeting-2');

    // NOW it is safe to construct meeting 2 on the same device.
    const cap2 = new MicrophoneCapture('shared-device');
    cap2.start();
    assert.equal(
        dev.constructedWhileStopping,
        false,
        'BUG: a fresh native mic was constructed on the same device while a prior monitor.stop() was still in flight — this is the CoreAudio HAL deadlock. endMeeting must thread capture destroy() into _pendingTeardown so startMeeting awaits it before constructing.',
    );

    await cap2.destroy();
    await releaseNativeStops();
});

// ─── Source-contract: pin the load-bearing endMeeting/startMeeting wiring ──
function extractMethodBody(methodName) {
    const re = new RegExp(`(?:public|private|protected)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`);
    const m = re.exec(mainSource);
    assert.ok(m, `could not locate ${methodName} in main.ts`);
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < mainSource.length && depth > 0) {
        const ch = mainSource[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    assert.equal(depth, 0, `unbalanced braces in ${methodName}`);
    return mainSource.slice(start, i - 1);
}

const endMeetingBody = extractMethodBody('endMeeting');
const startMeetingBody = extractMethodBody('startMeeting');

test('endMeeting NULLS both capture fields synchronously (forces serialized recreate path)', () => {
    assert.ok(
        /this\.systemAudioCapture\s*=\s*null/.test(endMeetingBody),
        'BUG: endMeeting must null this.systemAudioCapture so the next meeting reconstructs it via the serialized path instead of reusing a half-torn-down wrapper.',
    );
    assert.ok(
        /this\.microphoneCapture\s*=\s*null/.test(endMeetingBody),
        'BUG: endMeeting must null this.microphoneCapture — otherwise reconfigureAudio early-returns "device IDs unchanged" and MicrophoneCapture.start() synchronously constructs a fresh native mic on the main thread, racing the dying monitor.stop() (the HAL deadlock).',
    );
});

test('endMeeting tears down captures via destroy() (not fire-and-forget stop())', () => {
    assert.ok(
        /dyingSystemCapture\?\.\s*destroy\s*\(\s*\)/.test(endMeetingBody),
        'BUG: endMeeting must call destroy() on the snapshotted system capture (destroy = disablePreWarm + stop + removeAllListeners), not a bare stop().',
    );
    assert.ok(
        /dyingMicrophoneCapture\?\.\s*destroy\s*\(\s*\)/.test(endMeetingBody),
        'BUG: endMeeting must call destroy() on the snapshotted microphone capture.',
    );
});

test('endMeeting threads capture teardown into _pendingTeardown, awaited UP FRONT', () => {
    assert.ok(
        /captureTeardownPromise/.test(endMeetingBody),
        'BUG: endMeeting must capture the combined destroy() promise as captureTeardownPromise.',
    );

    // The _pendingTeardown IIFE must `await captureTeardownPromise` and it must
    // do so BEFORE the STT.stop() drain (ordering = native release fully
    // settles before anything else, and before the next meeting which awaits
    // this whole promise constructs a capture).
    const pendingIdx = endMeetingBody.search(/this\._pendingTeardown\s*=\s*\(\s*async/);
    assert.ok(pendingIdx >= 0, 'sanity: endMeeting assigns this._pendingTeardown to an async IIFE');
    const pendingBody = endMeetingBody.slice(pendingIdx);

    const awaitCapIdx = pendingBody.search(/await\s+captureTeardownPromise/);
    const sttStopIdx = pendingBody.search(/this\.googleSTT\?\.\s*stop\s*\(\s*\)/);
    assert.ok(
        awaitCapIdx >= 0,
        'BUG: the _pendingTeardown IIFE must `await captureTeardownPromise` so the next startMeeting (which awaits _pendingTeardown) cannot open the device before the prior native handle is released.',
    );
    assert.ok(sttStopIdx >= 0, 'sanity: the _pendingTeardown IIFE stops STT later');
    assert.ok(
        awaitCapIdx < sttStopIdx,
        'BUG: captureTeardownPromise must be awaited UP FRONT in the _pendingTeardown IIFE (before the STT drain) so a slow native release blocks the next start rather than racing it.',
    );
});

test('startMeeting awaits _pendingTeardown BEFORE the async audio init', () => {
    const awaitIdx = startMeetingBody.search(/await\s+this\._pendingTeardown/);
    const audioInitIdx = startMeetingBody.search(/this\._audioInitPromise\s*=\s*\(\s*async/);
    assert.ok(awaitIdx >= 0, 'BUG: startMeeting must await this._pendingTeardown so the prior meeting\'s capture teardown completes before a new capture is constructed.');
    assert.ok(audioInitIdx >= 0, 'sanity: startMeeting assigns this._audioInitPromise');
    assert.ok(
        awaitIdx < audioInitIdx,
        'BUG: startMeeting must await _pendingTeardown BEFORE scheduling the audio init IIFE — otherwise reconfigureAudio/setupSystemAudioPipeline can construct a native capture while the previous monitor.stop() is still releasing the device.',
    );
});
