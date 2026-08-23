// Regression test for the Windows "stop a meeting while STT is still
// connecting" crash.
//
// Symptom: a user stops a meeting a second or two after starting it, while
// both the mic and system Natively Pro STT sockets are still in CONNECTING.
// stop() -> closeUpstream() used to call removeAllListeners() and THEN
// close(). With ws@8, close() on a CONNECTING socket routes through
// abortHandshake(), which does:
//
//     process.nextTick(emitErrorAndClose, websocket, err)
//
// i.e. it unconditionally emits 'error' ONE TICK LATER with the message
// "WebSocket was closed before the connection was established". There is no
// option to suppress it — see websockets/ws#1835 and #2249; abortHandshake is
// deliberately private and this is the library's documented contract.
//
// Because removeAllListeners() had just stripped the 'error' listener, Node's
// EventEmitter promoted that orphaned 'error' into a process-level
// uncaughtException. main.ts's handler then closed the SQLite singleton
// (irreversibly — closeWithoutCheckpoint nulls the handle with no reopen
// path) but did NOT exit, so Electron kept serving IPC against a dead
// database and every later meeting silently failed to persist.
//
// Empirically ranked alternatives (all measured against ws@8.21.0):
//   - terminate() instead of close():        STILL CRASHES (same abortHandshake path)
//   - deferring close() into setTimeout(0):  STILL CRASHES
//   - re-attaching a bare no-op 'error':     safe, but leaks one listener per
//                                            discarded socket, and these sockets
//                                            are cycled on every meeting
// Only state-aware selective removal with self-releasing listeners is both
// crash-safe and leak-free, which is what this test pins down.
//
// Strategy: no fakes. A real TCP server accepts the connection but never
// completes the WebSocket upgrade, so the sockets genuinely sit in CONNECTING.
// Real ws, real compiled NativelyProSTT, real stop().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const origLoad = Module._load;
Module._load = function patchedLoad(request) {
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

const { NativelyProSTT } = await import(pathToFileURL(path.join(distRoot, 'NativelyProSTT.js')).href);

/** A TCP server that accepts but never upgrades — clients stay in CONNECTING. */
async function stalledServer() {
    const sockets = [];
    const server = net.createServer((s) => { sockets.push(s); });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    return {
        url: `ws://127.0.0.1:${server.address().port}/stt`,
        close: () => {
            for (const s of sockets) { try { s.destroy(); } catch { /* already gone */ } }
            server.close();
        },
    };
}

/**
 * Builds an STT instance pinned at `url`.
 *
 * SEAM: override BACKEND_URL, NOT `target`. start() deliberately nulls
 * `this.target` so each session re-resolves its relay target, which means a
 * target assigned before start() is wiped and connect() silently falls back to
 * BACKEND_URL — i.e. the real production endpoint. Overriding BACKEND_URL is
 * the only pin that survives start(); with the relay flag off (the default in
 * tests) connectUrl() returns it verbatim.
 *
 * This keeps the test hermetic. It must never open a socket to
 * api.natively.software: that would make the suite network-dependent and point
 * dozens of cancelled handshakes per run at production.
 */
function makeStt(url, channel) {
    const stt = new NativelyProSTT('cancellation-key', channel);
    stt.BACKEND_URL = url;
    return stt;
}

/** Runs `body` while capturing anything that escapes to the process level. */
async function captureProcessFailures(body) {
    const uncaught = [];
    const unhandled = [];
    const onUncaught = (e) => uncaught.push(e);
    const onUnhandled = (e) => unhandled.push(e);

    // node:test installs its own handlers; ours must run alongside them.
    process.on('uncaughtException', onUncaught);
    process.on('unhandledRejection', onUnhandled);
    try {
        await body();
    } finally {
        process.off('uncaughtException', onUncaught);
        process.off('unhandledRejection', onUnhandled);
    }
    return { uncaught, unhandled };
}

const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));

test('HERMETICITY GUARD: the socket dials the local server, never production', async () => {
    // start() nulls this.target, so pinning `target` before start() is silently
    // discarded and connect() falls back to BACKEND_URL. If this test ever
    // regresses to that shape it would quietly point every cancelled handshake
    // below at wss://api.natively.software. Pin it down explicitly.
    const server = await stalledServer();
    const stt = makeStt(server.url, 'mic');

    stt.start();
    await settle(120);
    const dialed = stt.ws?.url;
    stt.stop();
    await settle();
    server.close();

    assert.ok(dialed, 'a socket must have been created');
    assert.ok(
        dialed.startsWith('ws://127.0.0.1:'),
        `the test must dial the local stalled server, got ${dialed}. ` +
        'A non-local URL means the seam broke and this suite is now hitting the ' +
        'real Natively STT endpoint over the network.'
    );
    assert.ok(!dialed.includes('natively.software'), 'must never reach production');
});

test('stopping mic + system STT mid-handshake must not escape as an uncaughtException', async () => {
    const server = await stalledServer();
    const mic = makeStt(server.url, 'mic');
    const system = makeStt(server.url, 'system');

    const { uncaught, unhandled } = await captureProcessFailures(async () => {
        mic.start();
        system.start();

        // Let both TCP connects land while the upgrade is still pending.
        await settle(150);
        assert.equal(mic.ws?.readyState, 0, 'mic socket must genuinely be CONNECTING');
        assert.equal(system.ws?.readyState, 0, 'system socket must genuinely be CONNECTING');

        // The user action: stop the meeting while both are still connecting.
        mic.stop();
        system.stop();

        // abortHandshake's error lands on the NEXT TICK — wait past it.
        await settle();
    });

    server.close();

    assert.deepEqual(
        uncaught.map(e => e.message),
        [],
        'Cancelling a CONNECTING Natively Pro STT socket must not raise a process-level ' +
        'uncaughtException. ws@8 always emits the abortHandshake error one tick after ' +
        'close(); closeUpstream() must keep an error listener attached across that tick.'
    );
    assert.deepEqual(unhandled.map(String), [], 'no unhandled rejections either');
});

test('a cancelled STT socket is fully detached and leaves no residual listeners', async () => {
    const server = await stalledServer();
    const stt = makeStt(server.url, 'mic');

    const { uncaught } = await captureProcessFailures(async () => {
        stt.start();
        await settle(150);
        const dying = stt.ws;
        assert.ok(dying, 'socket must exist before teardown');

        stt.stop();
        await settle();

        // The instance must have released its reference...
        assert.equal(stt.ws, null, 'closeUpstream must null this.ws');
        assert.equal(stt.isConnected, false, 'isConnected must be cleared');
        assert.equal(stt.isConnecting, false, 'isConnecting must be cleared');

        // ...and the discarded socket must not retain listeners. These sockets
        // are cycled on every meeting, so a listener retained per discarded
        // socket accumulates for the life of the process.
        assert.equal(
            dying.listenerCount('error'), 0,
            'the cancellation error listener must release itself once the socket closes'
        );
        assert.equal(
            dying.listenerCount('close'), 0,
            'the cancellation close listener must release itself once the socket closes'
        );
    });

    server.close();
    assert.deepEqual(uncaught.map(e => e.message), [], 'no uncaught exception during detach');
});

test('no reconnect timer survives a mid-handshake cancellation', async () => {
    const server = await stalledServer();
    const stt = makeStt(server.url, 'mic');

    const { uncaught } = await captureProcessFailures(async () => {
        stt.start();
        await settle(150);
        stt.stop();
        await settle();

        assert.equal(stt.reconnectTimer, null, 'reconnectTimer must be cleared');
        assert.equal(stt.stabilityTimer, null, 'stabilityTimer must be cleared');
        assert.equal(stt.pendingConnectTimer, null, 'pendingConnectTimer must be cleared');
        assert.equal(stt.isActive, false, 'instance must be inactive after stop()');
    });

    server.close();
    assert.deepEqual(uncaught.map(e => e.message), [], 'no uncaught exception from an orphan timer');
});

test('an instance cancelled mid-handshake can start a fresh connection afterwards', async () => {
    const server = await stalledServer();
    const stt = makeStt(server.url, 'mic');

    const { uncaught } = await captureProcessFailures(async () => {
        stt.start();
        await settle(150);
        stt.stop();
        await settle(250);

        // Second meeting on the same instance. BACKEND_URL survives start(),
        // so no re-pinning is needed.
        stt.start();
        await settle(150);

        assert.equal(stt.isActive, true, 'restarted instance must be active');
        assert.ok(stt.ws, 'restarted instance must own a fresh socket');
        assert.equal(stt.ws.readyState, 0, 'fresh socket is connecting against the stalled server');

        stt.stop();
        await settle();
    });

    server.close();
    assert.deepEqual(uncaught.map(e => e.message), [], 'restart after cancellation must stay clean');
});

test('repeated rapid start/stop cycles never escape to the process level', async () => {
    const server = await stalledServer();

    const { uncaught, unhandled } = await captureProcessFailures(async () => {
        for (let cycle = 0; cycle < 12; cycle++) {
            const mic = makeStt(server.url, 'mic');
            const system = makeStt(server.url, 'system');
            mic.start();
            system.start();
            // Vary the dwell so cancellation lands at different handshake points.
            await settle(cycle % 3 === 0 ? 0 : 40);
            mic.stop();
            system.stop();
            await settle(60);
        }
        await settle(300);
    });

    server.close();

    assert.equal(
        uncaught.length, 0,
        `24 mid-handshake cancellations produced ${uncaught.length} uncaught exception(s): ` +
        uncaught.map(e => e.message).join(' | ')
    );
    assert.equal(unhandled.length, 0, 'no unhandled rejections across the cycles');
});
