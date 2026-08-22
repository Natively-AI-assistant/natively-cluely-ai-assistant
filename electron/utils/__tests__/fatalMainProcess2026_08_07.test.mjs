// Behavioral tests for the one-shot fatal-termination coordinator.
//
// Background: main.ts had six paths that called emergencyCloseDatabase() —
// which nulls the better-sqlite3 singleton irreversibly, with no reopen path —
// and then let the process KEEP RUNNING. Electron stayed fully interactive
// while every subsequent write silently no-op'd (saveMeeting() hits
// `if (!this.db)`, logs, and returns undefined — the caller is never told).
//
// The invariant this coordinator enforces: closing the database and exiting
// are a single atomic decision. If we are confident enough to destroy the
// database handle, we must not leave an interactive app behind; if we are not,
// we must not close it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/utils');

const origLoad = Module._load;
Module._load = function patchedLoad(request) {
    if (request === 'electron') return { app: { exit: () => {} } };
    return origLoad.apply(this, arguments);
};

const { FatalMainProcessCoordinator } = await import(pathToFileURL(path.join(distRoot, 'fatalMainProcess.js')).href);

/** Records every close/exit/log the coordinator performs. */
function spyDeps(overrides = {}) {
    const calls = { closes: [], exits: [], logs: [] };
    const deps = {
        closeDatabase: (reason) => { calls.closes.push(reason); },
        exit: (code) => { calls.exits.push(code); },
        log: (message) => { calls.logs.push(message); },
        ...overrides,
    };
    return { calls, deps };
}

test('a single fatal event closes the database exactly once and exits exactly once', () => {
    const { calls, deps } = spyDeps();
    const coordinator = new FatalMainProcessCoordinator(deps);

    coordinator.terminate('uncaughtException', 1);

    assert.deepEqual(calls.closes, ['uncaughtException']);
    assert.deepEqual(calls.exits, [1]);
    assert.equal(coordinator.isTerminal(), true);
    assert.equal(coordinator.getReason(), 'uncaughtException');
});

test('two nearly-simultaneous fatal events still yield one close and one exit', () => {
    const { calls, deps } = spyDeps();
    const coordinator = new FatalMainProcessCoordinator(deps);

    // e.g. the mic and system STT sockets both raising in the same tick.
    coordinator.terminate('uncaughtException', 1);
    coordinator.terminate('unhandledRejection-loop-giveup', 1);
    coordinator.terminate('render-process-gone-loop-giveup', 1);

    assert.deepEqual(calls.closes, ['uncaughtException'], 'database must close only once');
    assert.deepEqual(calls.exits, [1], 'exit must fire only once');
    assert.equal(coordinator.getInvocationCount(), 3, 'every attempt is still recorded for triage');
    assert.equal(coordinator.getReason(), 'uncaughtException', 'the FIRST reason is the one retained');
});

test('the process still exits when the crash-safe database close throws', () => {
    // A crashing process is exactly when close() is most likely to fail. If a
    // throwing close could skip the exit, we would be back to an interactive
    // app on a half-torn-down database — the very state this class exists to
    // prevent.
    const { calls, deps } = spyDeps({
        closeDatabase: () => { throw new Error('SQLITE_BUSY: database is locked'); },
    });
    const coordinator = new FatalMainProcessCoordinator(deps);

    assert.doesNotThrow(
        () => coordinator.terminate('uncaughtException', 1),
        'terminate() must never throw back into the fatal handler that called it'
    );

    assert.deepEqual(calls.exits, [1], 'exit must run even though closeDatabase threw');
    assert.equal(calls.logs.length, 1, 'the close failure must leave a breadcrumb');
    assert.match(calls.logs[0], /SQLITE_BUSY/);
});

test('a throwing exit is contained so the fatal handler cannot re-enter', () => {
    const { calls, deps } = spyDeps({
        exit: () => { throw new Error('app not ready'); },
    });
    const coordinator = new FatalMainProcessCoordinator(deps);

    assert.doesNotThrow(() => coordinator.terminate('initializeApp-failed', 1));
    assert.deepEqual(calls.closes, ['initializeApp-failed']);
    assert.equal(coordinator.isTerminal(), true, 'a failed exit must not un-latch terminal state');
});

test('exit code is carried through per call site', () => {
    const { calls, deps } = spyDeps();
    new FatalMainProcessCoordinator(deps).terminate('nativeArch', 3);
    assert.deepEqual(calls.exits, [3]);
});

test('a fresh coordinator starts non-terminal with nothing recorded', () => {
    const { calls, deps } = spyDeps();
    const coordinator = new FatalMainProcessCoordinator(deps);

    assert.equal(coordinator.isTerminal(), false);
    assert.equal(coordinator.getInvocationCount(), 0);
    assert.equal(coordinator.getReason(), null);
    assert.deepEqual(calls.closes, []);
    assert.deepEqual(calls.exits, [], 'constructing the coordinator must have no side effects');
});
