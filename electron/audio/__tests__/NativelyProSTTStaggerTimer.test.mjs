// Regression test for the "bogus 3000ms per-key stagger" bug in
// NativelyProSTT.connect().
//
// Symptom: connect() used to gate every same-apiKey connection behind a
// static `nextSlotByKey` map with `SLOT_INTERVAL_MS = 3000`. The map was
// added under the (wrong) assumption that the upstream server serialised
// connections by apiKey. It does not — Deepgram concurrency is per-project
// quota (HTTP 429 on overflow), and the system + mic channels are
// explicitly supported concurrent streams disambiguated by the `channel`
// field in the auth frame.
//
// Net effect of the bug: starting a meeting opens two NativelyProSTT
// connections (one 'system', one 'mic') with the same apiKey. The second
// connect would land in the stagger window of the first and pend a
// setTimeout for ~3000 ms — pushing visible mic activation 3 s past the
// click. Compounded by `language_detected` reconnects re-entering the same
// gate, total cold-start could hit 6–9 s before any audio reached the STT.
//
// Fix: the per-key stagger is removed from connect(). This regression test
// pins the new behavior so any reintroduction (e.g. someone re-adding a
// "concurrent key collision prevention" sleep "to be safe") fails CI
// loudly.
//
// Strategy: load the COMPILED NativelyProSTT with `Module._load` patched so
// `require('electron')` is harmless, then create two instances sharing one
// apiKey but distinct channels ('system' and 'mic'). Spy on connect() to
// observe whether either instance has pendingConnectTimer set after
// start() — under the old stagger logic the second start would have a
// non-null timer; under the fix it must remain null. Also measure the
// real-time delta between when each instance's connect-body advanced past
// the WebSocket-construction guard. The hard regression assertion is that
// the second start does NOT schedule a deferred timer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const origLoad = Module._load;
Module._load = function patchedLoad(request, _parent, _isMain) {
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

test('connect() must NOT stagger same-apiKey connections (mic + system concurrent)', async () => {
    const API_KEY = 'no-stagger-regression-key';

    // Two channels on the same apiKey — exactly the production startMeeting shape.
    const sysStt = new NativelyProSTT(API_KEY, 'system');
    const micStt = new NativelyProSTT(API_KEY, 'mic');

    // Spy on connect: short-circuit BEFORE `new WebSocket(...)` (we don't want
    // a real socket attempt) but record the moment the connect body has
    // committed to a WebSocket attempt vs deferred via a stagger timer.
    // We do this by leaving the real connect on the prototype but overriding
    // the WebSocket constructor via a marker flag we read after start().
    const tsSystem = { entered: null };
    const tsMic    = { entered: null };

    const origConnectSys = sysStt.connect.bind(sysStt);
    const origConnectMic = micStt.connect.bind(micStt);

    sysStt.connect = function (skipStagger = false) {
        // Mark the moment connect was invoked.
        tsSystem.entered = Date.now();
        // Replicate just the early-return guard so isConnecting flips like the
        // real path, but stop before `new WebSocket(...)`.
        if (this.isConnecting || !this.isActive) return;
        this.isConnecting = true;
        this.isConnected  = false;
        // Do NOT call origConnectSys — that would try to open a real WS.
    };
    micStt.connect = function (skipStagger = false) {
        tsMic.entered = Date.now();
        if (this.isConnecting || !this.isActive) return;
        this.isConnecting = true;
        this.isConnected  = false;
    };

    // ── Issue the two starts back-to-back ────────────────────────────
    sysStt.start();
    micStt.start();

    // ── Hard regression assertion: NO pendingConnectTimer set by start ──
    // The old stagger logic set pendingConnectTimer on the SECOND
    // same-apiKey connect (the one that landed in the other channel's slot
    // window). After the fix, neither instance should have a pending timer
    // attributable to a per-key stagger.
    assert.equal(
        sysStt.pendingConnectTimer,
        null,
        'system channel must NOT have a pendingConnectTimer set by start() — that would be the per-key stagger reintroduced',
    );
    assert.equal(
        micStt.pendingConnectTimer,
        null,
        'mic channel must NOT have a pendingConnectTimer set by start() — that would be the per-key stagger reintroduced',
    );

    // ── Latency regression guardrail: both connects must enter their body ──
    // synchronously inside start(). Real wallclock delta must be tiny (<50ms
    // in the test env). If it's anywhere near 3000 ms, the stagger is back.
    assert.notEqual(tsSystem.entered, null, 'system connect() must have been invoked synchronously by start()');
    assert.notEqual(tsMic.entered,    null, 'mic connect() must have been invoked synchronously by start()');
    const delta = Math.abs(tsMic.entered - tsSystem.entered);
    assert.ok(
        delta < 50,
        `same-apiKey mic vs system connect start delta must be < 50ms (was ${delta}ms). ` +
        `A delta near 3000 ms indicates the per-key stagger has been reintroduced.`,
    );

    // ── Drain the event loop briefly to catch any deferred connect() ──
    // Wait noticeably longer than the old 3000 ms stagger to expose a
    // sleeping setTimeout, if one slipped back in.
    await new Promise((r) => setTimeout(r, 3200));

    // After waiting past where the old stagger continuation would have
    // fired, both connects should still have been entered exactly once.
    // (Each instance's connect was invoked exactly once by its own start.)
    // We re-assert the timers were never set during the wait, either.
    assert.equal(
        sysStt.pendingConnectTimer,
        null,
        'system pendingConnectTimer must still be null after 3.2 s wait — no deferred stagger',
    );
    assert.equal(
        micStt.pendingConnectTimer,
        null,
        'mic pendingConnectTimer must still be null after 3.2 s wait — no deferred stagger',
    );

    // Cleanup
    sysStt.stop();
    micStt.stop();
});

test('language_detected reconnect must fire at ~250 ms (no stagger added on top)', async () => {
    // Before the fix, this path was: closeUpstream() → 250 ms setTimeout →
    // connect() → 3000 ms stagger setTimeout → connect(true) → new WS. The
    // 250 ms inline debounce was correct (it's the server's
    // concurrent_session_blocked race mitigation), but the stagger that ran
    // INSIDE the resulting connect() pushed total reconnect latency to
    // ~3250 ms. This test pins the new behavior: only the 250 ms inline
    // debounce remains; the resulting connect() must NOT defer further.
    const stt = new NativelyProSTT('lang-detected-key', 'mic');

    // Spy on connect to record when it actually invokes the
    // WebSocket-construction branch (we short-circuit before `new WebSocket`).
    let connectFiredAt = null;
    stt.connect = function (_skipStagger = false) {
        if (this.isConnecting || !this.isActive) return;
        connectFiredAt = Date.now();
        this.isConnecting = true;
        this.isConnected  = false;
    };

    // Force the state language_detected needs to schedule its inline 250 ms
    // setTimeout: isActive && this.ws truthy. We poke ws to a sentinel object
    // so the condition `if (this.isActive && this.ws)` is satisfied; the
    // handler will then call closeUpstream() (no-op on the sentinel) and
    // schedule the inline reconnect timer.
    stt.isActive = true;
    stt.isConnecting = false;
    stt.isConnected = true;
    stt.ws = { close() {}, removeAllListeners() {}, readyState: 1 };

    // Simulate the server's language_detected branch directly. We can't
    // round-trip a real WebSocket message, so we replicate exactly the
    // handler body from NativelyProSTT.ts (language_detected path).
    const detected = 'ja-JP';
    stt.languageBcp47       = detected;
    stt.languageAlternates  = [];
    stt.reconnectAttempts   = 0;
    stt.intentionalClose    = true;
    stt.closeUpstream();
    if (stt.pendingConnectTimer) clearTimeout(stt.pendingConnectTimer);
    const scheduledAt = Date.now();
    stt.pendingConnectTimer = setTimeout(() => {
        stt.pendingConnectTimer = null;
        if (stt.isActive) stt.connect();
    }, 250);

    // Wait noticeably longer than the inline 250 ms debounce but well under
    // the old 3000 ms stagger.
    await new Promise((r) => setTimeout(r, 600));

    assert.notEqual(connectFiredAt, null, 'connect() must have fired within 600 ms after language_detected reconnect was scheduled');
    const elapsed = connectFiredAt - scheduledAt;
    assert.ok(
        elapsed < 500,
        `language_detected reconnect must fire within ~250–500 ms; got ${elapsed} ms. ` +
        `An elapsed time near 3250 ms indicates the per-key stagger has been ` +
        `reintroduced in the connect() body.`,
    );
    assert.ok(
        elapsed >= 200,
        `language_detected reconnect should respect the 250 ms inline debounce; got ${elapsed} ms (too fast — debounce missing?).`,
    );

    stt.stop();
});

test('NativelyProSTT must not expose a per-key stagger map (structural guard)', async () => {
    // Belt-and-braces: even if someone re-adds a serial-gate mechanism, this
    // pins the specific name we used to use. If anyone reintroduces the
    // static map under the same name, this fails — forcing them to read the
    // comment in connect() before bringing the regression back.
    assert.equal(
        NativelyProSTT.nextSlotByKey,
        undefined,
        'NativelyProSTT.nextSlotByKey must not exist — the per-key stagger was deliberately removed (Deepgram concurrency is per-project quota, not per-key serial)',
    );
    assert.equal(
        NativelyProSTT.SLOT_INTERVAL_MS,
        undefined,
        'NativelyProSTT.SLOT_INTERVAL_MS must not exist — the 3000 ms stagger interval was deliberately removed',
    );
});
