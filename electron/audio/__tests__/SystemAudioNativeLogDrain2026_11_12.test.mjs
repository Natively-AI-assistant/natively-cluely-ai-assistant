// Native capture lifecycle lines reach the app log (#729 follow-up).
//
// The Rust capture prints its lifecycle (backend, init time, requested device
// failing over to the default, how a run ended, join times) with println!,
// which never reaches natively_debug.log, least of all in a packaged Windows
// build. It now also buffers those lines; SystemAudioCapture drains them with
// takeNativeCaptureLog() at the points where they explain something:
//   - before logging a native error, so the cause precedes the symptom,
//   - after the retired monitor's stop() (its join time),
//   - on the first chunk (init finished: backend + init time),
//   - after the deferred native stop of a normal stop().
// A .node built before this change has no takeNativeCaptureLog; the wrapper
// must keep working with it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const nativeLog = [];
const created = [];

function makeFakeMonitor() {
    return {
        callback: null,
        stopCalls: 0,
        start(cb) { this.callback = cb; },
        stop() {
            this.stopCalls++;
            nativeLog.push({ atMs: Date.now(), message: `[native] stop: joined in 0 ms (#${this.stopCalls})` });
        },
        getSampleRate() { return 16000; },
    };
}

const fakeNativeModule = {
    getHardwareId: () => 'fake',
    verifyGumroadKey: async () => 'fake',
    getInputDevices: () => [],
    getOutputDevices: () => [],
    SystemAudioCapture: function () {
        const m = makeFakeMonitor();
        created.push(m);
        return m;
    },
    MicrophoneCapture: function () { return { start() {}, stop() {}, getSampleRate: () => 48000 }; },
    takeNativeCaptureLog: () => nativeLog.splice(0),
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

const { SystemAudioCapture } = await import(pathToFileURL(path.join(distRoot, 'SystemAudioCapture.js')).href);

const flushSetImmediate = () => new Promise((r) => setImmediate(r));

/** Runs `fn` with console.log/warn/error captured in call order. */
async function captureConsole(fn) {
    const out = [];
    const saved = { log: console.log, warn: console.warn, error: console.error };
    for (const level of ['log', 'warn', 'error']) {
        console[level] = (...args) => out.push(`${level}: ${args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')}`);
    }
    try {
        await fn();
    } finally {
        Object.assign(console, saved);
    }
    return out;
}

const indexOf = (lines, needle) => lines.findIndex((l) => l.includes(needle));

test('a native error logs the native cause before the JS error, then the retired monitor join', async () => {
    created.length = 0;
    nativeLog.length = 0;
    const cap = new SystemAudioCapture(null);
    cap.on('error', () => {});

    const out = await captureConsole(async () => {
        cap.start();
        nativeLog.push({ atMs: Date.now(), message: '[native] sys#1 run 1: ended, default device init failed too after 12 ms' });
        created[0].callback(new Error('FATAL: All init attempts failed: busy'), null);
        await flushSetImmediate();
    });

    const cause = indexOf(out, 'default device init failed too');
    const symptom = indexOf(out, 'Callback error');
    const join = indexOf(out, 'stop: joined in 0 ms (#1)');
    assert.ok(cause >= 0, `native cause must be logged:\n${out.join('\n')}`);
    assert.ok(symptom > cause, 'the native cause comes before the JS error line');
    assert.ok(join > symptom, 'the retired monitor\'s join time is logged after its stop()');
    assert.equal(nativeLog.length, 0, 'the buffer is drained');
});

test('the first chunk logs how init went; later chunks do not drain', async () => {
    created.length = 0;
    nativeLog.length = 0;
    const cap = new SystemAudioCapture(null);

    const out = await captureConsole(async () => {
        cap.start();
        nativeLog.push({ atMs: Date.now(), message: '[native] sys#2 run 1: capturing on coreaudio after 640 ms' });
        created[0].callback(null, Buffer.alloc(640));
        nativeLog.push({ atMs: Date.now(), message: '[native] later line' });
        created[0].callback(null, Buffer.alloc(640));
    });

    assert.ok(indexOf(out, 'capturing on coreaudio after 640 ms') >= 0);
    assert.equal(indexOf(out, 'later line'), -1, 'only chunk #1 drains');
    nativeLog.length = 0;
    await cap.destroy();
});

test('a silent capture still logs its init at the 1 s sample-rate poll', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    created.length = 0;
    nativeLog.length = 0;
    const cap = new SystemAudioCapture(null);

    const out = await captureConsole(async () => {
        cap.start();
        nativeLog.push({ atMs: Date.now(), message: '[native] sys#3 run 1: capturing on wasapi after 900 ms' });
        t.mock.timers.tick(1000);
    });

    assert.ok(indexOf(out, 'capturing on wasapi after 900 ms') >= 0, `no chunk arrived, the poll must drain:\n${out.join('\n')}`);
    t.mock.timers.reset();
    await cap.destroy();
});

test('stop() logs the native join after the deferred teardown', async () => {
    created.length = 0;
    nativeLog.length = 0;
    const cap = new SystemAudioCapture(null);
    cap.start();

    const out = await captureConsole(async () => {
        await cap.stop();
    });

    assert.equal(created[0].stopCalls, 1);
    assert.ok(indexOf(out, 'stop: joined in 0 ms (#1)') > indexOf(out, 'Stopping capture'));
});

test('old line timestamps are marked so a delayed drain is not misread as live', async () => {
    created.length = 0;
    nativeLog.length = 0;
    const cap = new SystemAudioCapture(null);
    cap.on('error', () => {});

    const out = await captureConsole(async () => {
        cap.start();
        nativeLog.push({ atMs: Date.now() - 5000, message: '[native] old line' });
        created[0].callback(new Error('stream stopped by the system'), null);
        await flushSetImmediate();
    });

    assert.match(out[indexOf(out, 'old line')], /old line \(\d{4} ms ago\)/);
});

test('a native module without takeNativeCaptureLog (built before #729) still works', async () => {
    const saved = fakeNativeModule.takeNativeCaptureLog;
    delete fakeNativeModule.takeNativeCaptureLog;
    try {
        created.length = 0;
        const cap = new SystemAudioCapture(null);
        const errors = [];
        cap.on('error', (e) => errors.push(e));
        await captureConsole(async () => {
            cap.start();
            created[0].callback(null, Buffer.alloc(640));
            created[0].callback(new Error('init failed'), null);
            await flushSetImmediate();
        });
        assert.equal(errors.length, 1);
        assert.equal(created[0].stopCalls, 1);
    } finally {
        fakeNativeModule.takeNativeCaptureLog = saved;
    }
});

test.after(() => {
    Module._load = origLoad;
});
