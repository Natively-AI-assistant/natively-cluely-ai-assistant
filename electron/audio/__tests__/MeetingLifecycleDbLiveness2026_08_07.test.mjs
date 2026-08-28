// Couples the two halves of this bug class: STT lifecycle churn and database
// liveness.
//
// WHY THIS EXISTS: the Windows report was "meetings stop saving". Getting there
// took three separate defects lining up — a cancelled STT handshake raising an
// uncaughtException, the fatal handler closing SQLite irreversibly, and the app
// staying alive afterwards. Each half had tests; NOTHING asserted the
// end-to-end property the user actually cares about:
//
//     after any amount of start/stop churn, can we still save a meeting?
//
// So this test cycles the real NativelyProSTT over real sockets through a fixed
// sequence of handshake outcomes, wires main.ts's REAL fatal policy
// (uncaughtException -> emergencyCloseDatabase), and after EVERY cycle performs
// a genuine SELECT 1 + insert + read-back + delete against a real SQLite file.
//
// Measured against HEAD (all three fixes reverted) this fails on cycle 0 and
// every cycle after it:
//     !! cycle 0 after-stop: DB NOT LIVE -> The database connection is not open
//     !! cycle 1 after-start: DB NOT LIVE -> The database connection is not open
//     ... (permanent for the rest of the session — exactly the user's symptom)
//
// Hermetic: local servers only, no network. The live-API variant of this run
// (real Gemini embeddings + real DeepSeek) was executed separately during
// development; keeping the committed test offline keeps it fast and reliable.
//
// ISOLATION: owns its own better-sqlite3 connection and its own process
// handlers, and removes both. It never touches the DatabaseManager singleton —
// closing shared state from a test poisons every file that runs after it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = Module.createRequire(path.join(repoRoot, 'package.json'));

// better-sqlite3 is built for Electron's ABI (148) and cannot load under plain
// `node --test` (141). The binding loads LAZILY, so require() alone does not
// surface it — the probe has to open a connection.
let Database = null;
let skipReason = null;
try {
    Database = require('better-sqlite3');
    new Database(':memory:').close();
} catch (err) {
    skipReason = /NODE_MODULE_VERSION/.test(String(err?.message))
        ? 'better-sqlite3 is built for the Electron ABI — run under ELECTRON_RUN_AS_NODE'
        : `better-sqlite3 unavailable: ${err?.message}`;
}
// node:test treats the PRESENCE of a `skip` key as a skip even when it is null.
const opts = skipReason ? { skip: skipReason } : {};

const origLoad = Module._load;
Module._load = function patchedLoad(request) {
    if (request === 'electron') {
        return { app: { getAppPath: () => os.tmpdir(), isPackaged: false, isReady: () => false } };
    }
    return origLoad.apply(this, arguments);
};

// WINDOWS (2026-08-29): `await import()` needs a file:// URL, not a bare
// absolute path. On POSIX `import('/Users/…')` happens to resolve; on Windows
// `import('C:\\…')` throws ERR_UNSUPPORTED_ESM_URL_SCHEME, and because these
// imports run at MODULE LOAD the whole file fails before a single test runs —
// which is why this file showed up as one opaque file-level ✖ in the Windows
// leg rather than as a failing assertion. `pathToFileURL` is the fix.
const { NativelyProSTT } = await import(pathToFileURL(path.join(repoRoot, 'dist-electron/electron/audio/NativelyProSTT.js')).href);
const { MeetingLifecycleQueue } = await import(pathToFileURL(path.join(repoRoot, 'dist-electron/electron/audio/meetingLifecycleQueue.js')).href);

const settle = (ms) => new Promise(r => setTimeout(r, ms));

test('25 start/stop cycles leave the database live and writable', opts, async () => {
    // ── A real SQLite file this test owns outright ─────────────────────────
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-liveness-'));
    const db = new Database(path.join(dir, 'natively.db'));
    db.exec(`CREATE TABLE meetings (
        id TEXT PRIMARY KEY, title TEXT, start_time INTEGER,
        duration_ms INTEGER, created_at TEXT
    );`);

    // ── main.ts's REAL fatal policy, scoped to this test ───────────────────
    // uncaughtException -> emergencyCloseDatabase(). We record instead of
    // exiting so the run can keep measuring, but the CLOSE is real — that is
    // the link that turns an STT crash into permanent persistence death.
    const uncaught = [];
    const onUncaught = (e) => {
        uncaught.push(e);
        try { db.close(); } catch { /* already closed */ }
    };
    process.on('uncaughtException', onUncaught);

    // ── Servers covering the handshake outcomes that matter ────────────────
    const sockets = [];
    const stalled = net.createServer((s) => sockets.push(s));           // never upgrades
    await new Promise(r => stalled.listen(0, '127.0.0.1', r));
    const httpSrv = http.createServer();                                 // upgrades normally
    const { WebSocketServer } = require('ws');
    const wss = new WebSocketServer({ server: httpSrv });
    wss.on('connection', (s) => sockets.push(s));
    await new Promise(r => httpSrv.listen(0, '127.0.0.1', r));
    const resetter = net.createServer((s) => {                           // RSTs mid-handshake
        sockets.push(s);
        setTimeout(() => { try { s.destroy(); } catch { /* gone */ } }, 15);
    });
    await new Promise(r => resetter.listen(0, '127.0.0.1', r));
    const probe = net.createServer();                                    // connection refused
    await new Promise(r => probe.listen(0, '127.0.0.1', r));
    const refusedPort = probe.address().port;
    await new Promise(r => probe.close(r));

    const URLS = {
        stalled: `ws://127.0.0.1:${stalled.address().port}/stt`,
        live: `ws://127.0.0.1:${httpSrv.address().port}/stt`,
        reset: `ws://127.0.0.1:${resetter.address().port}/stt`,
        refused: `ws://127.0.0.1:${refusedPort}/stt`,
    };
    const BEHAVIOURS = ['stalled', 'live', 'reset', 'refused', 'stalled', 'live'];
    const FIXTURES = ['dual', 'mic-only', 'system-only'];
    // Injected, never mutating the global — the lifecycle contract is shared,
    // so both platforms must exercise the same code.
    const PLATFORMS = ['darwin', 'win32'];

    function makeStt(url, channel) {
        const stt = new NativelyProSTT('liveness-key', channel);
        // SEAM: BACKEND_URL survives start(); `target` is nulled by start(), so
        // pinning it would silently fall back to the production endpoint.
        stt.BACKEND_URL = url;
        stt.on('error', () => {});   // production subscribes at main.ts:3259
        return stt;
    }

    const problems = [];
    function assertDbLive(cycle, phase) {
        try {
            assert.equal(db.prepare('SELECT 1 AS ok').get()?.ok, 1);
            const id = `live-${cycle}-${phase}`;
            db.prepare('INSERT OR REPLACE INTO meetings (id,title,start_time,duration_ms,created_at) VALUES (?,?,?,?,?)')
                .run(id, phase, Date.now(), 1234, String(Date.now()));
            const back = db.prepare('SELECT duration_ms FROM meetings WHERE id = ?').get(id);
            assert.equal(back?.duration_ms, 1234, 'read-back mismatch');
            assert.equal(db.prepare('DELETE FROM meetings WHERE id = ?').run(id).changes, 1);
        } catch (e) {
            problems.push(`cycle ${cycle} (${phase}): DB NOT LIVE -> ${e.message}`);
        }
    }

    const discarded = [];
    // Everything below runs inside try/finally: if an assertion fails, the
    // servers and the process handler MUST still be released. Without this a
    // failing run leaves listening sockets holding the event loop open and the
    // test runner hangs instead of reporting the failure.
    try {
    for (let cycle = 0; cycle < 25; cycle++) {
        const url = URLS[BEHAVIOURS[cycle % BEHAVIOURS.length]];
        const fixture = FIXTURES[cycle % FIXTURES.length];
        const platform = PLATFORMS[cycle % PLATFORMS.length];
        const states = [];
        const queue = new MeetingLifecycleQueue((s) => states.push(s));

        let mic = null, sys = null;
        await queue.start(async () => {
            if (fixture !== 'system-only') { mic = makeStt(url, 'mic'); mic.start(); }
            if (fixture !== 'mic-only') { sys = makeStt(url, 'system'); sys.start(); }
            await settle([0, 12, 45][cycle % 3]);   // cancel at varied handshake depths
        });
        assertDbLive(cycle, 'after-start');

        if (mic?.ws) discarded.push(mic.ws);
        if (sys?.ws) discarded.push(sys.ws);

        await queue.stop(async () => { mic?.stop(); sys?.stop(); await settle(15); });
        await settle(25);
        assertDbLive(cycle, 'after-stop');

        assert.equal(queue.getState(), 'idle',
            `cycle ${cycle} (${platform}/${fixture}) must settle idle`);
        assert.deepEqual([states[0], states[states.length - 1]], ['starting', 'idle'],
            `cycle ${cycle}: unexpected state sequence ${JSON.stringify(states)}`);

        for (const [name, s] of [['mic', mic], ['system', sys]]) {
            if (!s) continue;
            assert.equal(s.isActive, false, `cycle ${cycle}: ${name} still active`);
            assert.equal(s.ws, null, `cycle ${cycle}: ${name} still holds a socket`);
            for (const t of ['reconnectTimer', 'stabilityTimer', 'pendingConnectTimer']) {
                assert.equal(s[t], null, `cycle ${cycle}: ${name} leaked ${t}`);
            }
        }
    }

    await settle(400);

    // ── The properties that matter ─────────────────────────────────────────
    assert.deepEqual(problems, [],
        'The database must remain live and writable across every cycle. A failure here is ' +
        'the user-visible symptom: meetings silently stop saving for the rest of the session.');

    assert.equal(uncaught.length, 0,
        `${uncaught.length} uncaught exception(s) escaped: ` +
        [...new Set(uncaught.map(e => e.message))].join(' | '));

    const retained = discarded.filter(s => s.listenerCount('error') + s.listenerCount('close') > 0);
    assert.equal(retained.length, 0,
        `${retained.length}/${discarded.length} discarded sockets retained listeners — ` +
        'these are cycled every meeting, so a retained listener accumulates for the process lifetime.');

    // Final proof, after everything.
    assert.equal(db.open, true, 'the database handle must still be open at the end');
    assertDbLive(999, 'final');
    assert.deepEqual(problems, [], 'final liveness check must pass');

    } finally {
        // ── Teardown, guaranteed ───────────────────────────────────────────
        process.off('uncaughtException', onUncaught);
        for (const s of sockets) { try { s.destroy?.() ?? s.terminate?.(); } catch { /* gone */ } }
        for (const srv of [wss, httpSrv, stalled, resetter]) { try { srv.close(); } catch { /* gone */ } }
        try { db.close(); } catch { /* already closed */ }
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
});
