// Regression test for: processes an extension spawned outlived the extension.
//
// THE BUG. The sandbox's child_process shim returned the spawned process raw:
//
//     return REAL_CHILD_PROCESS.spawn(command, args, options);
//
// Nothing recorded the pid. Electron reaps its own utilityProcess children when
// the extension host goes away, but NOT their descendants — so a reranker
// extension running `llama-server` with a multi-gigabyte model left that server
// alive after the extension crashed, after the user disabled it, and after the
// app quit. The next enable spawned another one alongside it.
//
// The graceful `dispose` request is also the path least likely to run:
// ExtensionHost.stop() gives the child 2s to answer and then hard-kills it, the
// crash paths never send dispose at all, and main.ts's will-quit handler fires
// `void disposeExtensions()` without awaiting (deliberately — will-quit is
// synchronous and blocking it risks an app that never quits).
//
// THE FIX, guarded here: every authorised spawn is tracked, and
// disposeSpawnedProcesses() kills the tracked processes AND their descendants.
// bootstrap calls it on `dispose` and again from exit/SIGTERM/SIGINT/SIGHUP,
// so any teardown that can be observed in the child cleans up.
//
// Platform note: the kill is deliberately platform-split. win32 has no POSIX
// process groups and no signals, so `taskkill /T /F` is the only way to take a
// tree down; elsewhere it is SIGTERM then SIGKILL. Only the POSIX branch is
// exercised here — the win32 branch is `Requires physical Windows verification`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);
const sandbox = require(path.join(repoRoot, 'dist-electron/electron/services/extensions/host/sandbox.js'));
const { createChildProcessShim, disposeSpawnedProcesses } = sandbox;

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A long-lived child, spawned the way an extension's adapter would. */
function spawnLongLived() {
    const shim = createChildProcessShim(new Set(['process.spawn']), [process.execPath]);
    return shim.spawn(
        process.execPath,
        ['-e', 'setTimeout(() => {}, 120000)'],
        { stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
    );
}

test('disposeSpawnedProcesses kills a process the extension spawned', async (t) => {
    const child = spawnLongLived();
    assert.ok(child?.pid, 'the shim must return a real ChildProcess');
    const { pid } = child;
    t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } });

    await wait(300);
    assert.ok(alive(pid), 'precondition: the spawned process should be running');

    disposeSpawnedProcesses();

    // SIGTERM first; the process should go well before the SIGKILL backstop.
    for (let i = 0; i < 40 && alive(pid); i++) await wait(50);
    assert.equal(
        alive(pid),
        false,
        `pid ${pid} survived disposeSpawnedProcesses(). A process the extension spawned outlives ` +
        'the extension, holding whatever model or port it owns, unreachable by the app.',
    );
});

test('a process that already exited is not double-killed and does not throw', async () => {
    const shim = createChildProcessShim(new Set(['process.spawn']), [process.execPath]);
    const child = shim.spawn(process.execPath, ['-e', ''], {
        stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    await new Promise((r) => child.once('exit', r));
    disposeSpawnedProcesses();   // must be a no-op, not a throw
    disposeSpawnedProcesses();
});

test('disposeSpawnedProcesses is safe with nothing spawned', () => {
    disposeSpawnedProcesses();
});

test('an unauthorised binary is still refused, and is never tracked', () => {
    const shim = createChildProcessShim(new Set(['process.spawn']), ['/usr/bin/only-this']);
    assert.throws(
        () => shim.spawn('/bin/sh', ['-c', 'echo nope']),
        /allowedBinaries/,
        'the allowlist must still gate spawning — tracking must not widen what may run',
    );
});

test('spawning without the permission is still refused', () => {
    const shim = createChildProcessShim(new Set(), [process.execPath]);
    assert.throws(
        () => shim.spawn(process.execPath, ['-e', '']),
        /process\.spawn/,
        'the permission gate must still apply',
    );
});

test('the signal handlers terminate the process instead of swallowing the signal', () => {
    // THE HAZARD, measured 2026-09-03: on POSIX, SIGTERM/SIGINT/SIGHUP have
    // default handlers that terminate the process, and installing a listener
    // REMOVES that default — Node stops exiting. A cleanup handler that simply
    // returns therefore makes this utilityProcess survive ExtensionHost.stop(),
    // which reaches child.kill() = SIGTERM on POSIX. A probe confirmed both
    // halves: a listener that returns SURVIVES SIGTERM; one that calls
    // process.exit() exits.
    //
    // That would be strictly worse than the orphaned grandchildren this file
    // exists to fix — it is the hang-on-quit main.ts warns about at will-quit.
    //
    // Windows terminates unconditionally regardless of listeners, so this is a
    // POSIX-only hazard and a source-level guard is the right shape.
    const source = require('node:fs').readFileSync(
        path.join(repoRoot, 'electron/services/extensions/host/bootstrap.ts'), 'utf8',
    );
    const handlerBlock = source.slice(source.indexOf('SIGNAL_EXIT_CODES'));
    assert.match(
        handlerBlock,
        /process\.exit\(/,
        'the SIGTERM/SIGINT/SIGHUP handlers must call process.exit() — installing a listener ' +
        'removes the default terminate behaviour, so a handler that returns makes the extension ' +
        'process unkillable by the signal ExtensionHost.stop() sends.',
    );
    assert.doesNotMatch(
        source,
        /process\.on\(\s*'SIGTERM'\s*,\s*\(\)\s*=>\s*\{[^}]*\}\s*\)\s*;/,
        'a bare SIGTERM handler that does not exit reintroduces the unkillable-process bug',
    );
});
