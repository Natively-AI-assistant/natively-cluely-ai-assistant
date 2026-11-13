// electron/utils/__tests__/LifecycleRunEnd2026_11_14.test.mjs
//
// 2026-11-14: crash reporting (app_run_ended). The tracker now:
//   - keeps the previous session's marker and writes this session's at once,
//     so a session that dies without a word no longer leaves the one before
//     it (and its 'clean-exit') on disk;
//   - counts the renderer / GPU / helper processes that really failed
//     (not 'killed', not 'clean-exit', not during a quit);
//   - hears an OS shutdown: on Windows through each window's 'session-end',
//     on macOS through powerMonitor 'shutdown'. Both branches run here, with
//     the platform injected.
//
// Drives the REAL compiled module with an Electron stub.
// Run via: npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/utils/__tests__/LifecycleRunEnd2026_11_14.test.mjs

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let userData = '';
let handlers = {};
let powerHandlers = {};
const electronStub = {
  app: {
    getPath: (key) => (key === 'userData' ? userData : os.tmpdir()),
    getVersion: () => '3.2.0',
    on: (event, fn) => { (handlers[event] ||= []).push(fn); },
    whenReady: () => Promise.resolve(),
  },
  powerMonitor: { on: (event, fn) => { (powerHandlers[event] ||= []).push(fn); } },
  BrowserWindow: class {},
  WebContents: class {},
  utilityProcess: {},
};
const electronPath = require.resolve('electron');
require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: electronStub };

const { LifecycleTracker, CRASH_REASONS, SHUTDOWN_CANCEL_MS } = require(
  path.join(__dirname, '../../../dist-electron/electron/utils/lifecycleTracker.js'),
);
const { summarizeRunEnd } = await import('../../../src/lib/funnel/runEnd.mjs');

const fire = (event, ...args) => { for (const fn of handlers[event] || []) fn(...args); };
const markerFile = () => path.join(userData, 'lifecycle-marker.json');
const onDisk = () => JSON.parse(fs.readFileSync(markerFile(), 'utf8'));
const webContents = { id: 3, getURL: () => 'http://127.0.0.1:5173/?window=overlay' };

/** A new launch in `dir` (a fresh one unless given), as at app start. */
async function launch(platform, dir) {
  userData = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'natively-run-end-'));
  handlers = {};
  powerHandlers = {};
  LifecycleTracker.instance = null;
  const tracker = LifecycleTracker.getInstance();
  tracker.install(() => {}, platform);
  await new Promise((r) => setImmediate(r)); // whenReady().then(...)
  return tracker;
}

/** A marker another process left: the previous session. */
function leavePrevious(marker) {
  fs.writeFileSync(markerFile(), JSON.stringify({ pid: process.pid + 1, ...marker }));
}

/** What the next launch makes of what this one left. */
function nextLaunchReads() {
  const m = onDisk();
  return summarizeRunEnd({ ...m, pid: m.pid + 1 }, '3.2.0').props;
}

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: a session writes its marker at start, so dying silently reads as vanished, not as the session before`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-run-end-'));
    userData = dir;
    leavePrevious({ startedAt: '2026-11-13T09:00:00.000Z', lastEvent: 'clean-exit', lastEventAt: '2026-11-13T10:00:00.000Z', quitReason: null });
    const tracker = await launch(platform, dir);
    // The previous session is still what this launch reads, after its own write.
    const prev = tracker.readPreviousSessionMarker();
    assert.equal(prev.lastEvent, 'clean-exit');
    assert.equal(tracker.didPreviousSessionCrash(), false);
    // This session's marker is already on disk.
    const mine = onDisk();
    assert.equal(mine.pid, process.pid);
    assert.equal(mine.lastEvent, 'app-start');
    assert.equal(mine.version, '3.2.0');
    assert.deepEqual(mine.crashes, { renderer: 0, gpu: 0, helper: 0, oom: 0 });
    // ...and if the process dies here (nothing more is written), the next launch says so.
    assert.equal(nextLaunchReads().how, 'vanished');
  });

  test(`${platform}: a normal quit still reads as a quit`, async () => {
    const tracker = await launch(platform);
    fire('before-quit', {});
    fire('will-quit', {});
    tracker.markCleanExit();
    assert.equal(nextLaunchReads().how, 'quit');
  });

  test(`${platform}: real process failures are counted; kills, clean exits and quits are not`, async () => {
    await launch(platform);
    fire('render-process-gone', {}, webContents, { reason: 'crashed', exitCode: 11 });
    fire('render-process-gone', {}, webContents, { reason: 'oom', exitCode: -536870904 });
    fire('render-process-gone', {}, webContents, { reason: 'killed', exitCode: 15 });
    fire('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 1 });
    fire('child-process-gone', {}, { type: 'Utility', reason: 'abnormal-exit', exitCode: 1, serviceName: 'audio' });
    fire('child-process-gone', {}, { type: 'Utility', reason: 'clean-exit', exitCode: 0, serviceName: 'audio' });
    fire('before-quit', {});
    fire('render-process-gone', {}, webContents, { reason: 'crashed', exitCode: 11 }); // during the quit
    assert.deepEqual(onDisk().crashes, { renderer: 2, gpu: 1, helper: 1, oom: 1 });
    const p = nextLaunchReads();
    assert.deepEqual([p.how, p.renderer_crashes, p.gpu_crashes, p.helper_crashes, p.out_of_memory], ['quit', 2, 1, 1, true]);
  });

  test(`${platform}: a fatal exit reads as a crash, and keeps a fatal reason already set`, async () => {
    const tracker = await launch(platform);
    tracker.markFatal('render-process-gone-loop-giveup');
    assert.equal(onDisk().quitReason, 'fatal-main-error');
    assert.equal(onDisk().quitMeta.source, 'render-process-gone-loop-giveup');
    tracker.setQuitReason('fatal-main-error', { source: 'uncaughtException' });
    tracker.markFatal('uncaughtException');
    assert.equal(onDisk().quitMeta.source, 'uncaughtException');
    assert.equal(nextLaunchReads().how, 'crash');
  });
}

test('win32: a window hearing session-end marks an OS shutdown, which the quit that follows keeps', async () => {
  const tracker = await launch('win32');
  assert.equal(powerHandlers.shutdown, undefined, 'Windows does not use powerMonitor shutdown');
  const winHandlers = {};
  const win = { on: (event, fn) => { (winHandlers[event] ||= []).push(fn); } };
  fire('browser-window-created', {}, win);
  for (const fn of winHandlers['session-end']) fn({ reasons: ['shutdown', 'critical'] });
  assert.equal(onDisk().quitReason, 'os-shutdown');
  assert.deepEqual(onDisk().quitMeta, { reasons: ['shutdown', 'critical'] });
  // A crash while the windows close is not counted.
  fire('render-process-gone', {}, webContents, { reason: 'crashed', exitCode: 1 });
  fire('window-all-closed');
  fire('before-quit', {});
  fire('will-quit', {});
  tracker.markCleanExit();
  assert.equal(onDisk().quitReason, 'os-shutdown');
  assert.equal(onDisk().crashes.renderer, 0);
  assert.equal(nextLaunchReads().how, 'os_shutdown');
  assert.equal(tracker.didPreviousSessionCrash(), false);
});

test('win32: a session that ends before any quit runs (the OS ends it after session-end) still reads as a shutdown', async () => {
  await launch('win32');
  const winHandlers = {};
  fire('browser-window-created', {}, { on: (e, fn) => { (winHandlers[e] ||= []).push(fn); } });
  for (const fn of winHandlers['session-end']) fn({ reasons: ['logoff'] });
  assert.equal(nextLaunchReads().how, 'os_shutdown');
});

test('darwin: powerMonitor shutdown marks an OS shutdown; no window session-end is wired', async () => {
  const tracker = await launch('darwin');
  assert.equal(handlers['browser-window-created'], undefined);
  assert.equal(powerHandlers.shutdown.length, 1);
  powerHandlers.shutdown[0]();
  fire('before-quit', {});
  fire('will-quit', {});
  tracker.markCleanExit();
  assert.equal(onDisk().quitReason, 'os-shutdown');
  assert.equal(nextLaunchReads().how, 'os_shutdown');
});

test('an update in progress is not relabelled a shutdown', async () => {
  const tracker = await launch('darwin');
  tracker.setQuitReason('updater-quit-install', { toVersion: '3.2.1' });
  powerHandlers.shutdown[0]();
  assert.equal(onDisk().quitReason, 'updater-quit-install');
});

test('the closing of windows does not overwrite a more specific reason, but still marks a plain close', async () => {
  await launch('win32');
  fire('window-all-closed');
  assert.equal(onDisk().quitReason, 'window-close');
});

test('a stub without whenReady or powerMonitor (older tests) still installs', () => {
  const saved = { whenReady: electronStub.app.whenReady, pm: electronStub.powerMonitor };
  delete electronStub.app.whenReady;
  try {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-run-end-'));
    LifecycleTracker.instance = null;
    assert.doesNotThrow(() => LifecycleTracker.getInstance().install(() => {}, 'darwin'));
  } finally {
    electronStub.app.whenReady = saved.whenReady;
  }
});

test('only failures count as crashes', () => {
  for (const r of ['crashed', 'oom', 'abnormal-exit', 'launch-failed', 'integrity-failure', 'memory-eviction']) assert.ok(CRASH_REASONS.has(r), r);
  for (const r of ['killed', 'clean-exit']) assert.ok(!CRASH_REASONS.has(r), r);
});

// ── Windows asks before it ends the session (query-session-end) ────────────

function windowOf() {
  const h = {};
  fire('browser-window-created', {}, { on: (e, fn) => { (h[e] ||= []).push(fn); } });
  return (event, arg) => { for (const fn of h[event] || []) fn(arg); };
}

test('win32: query-session-end records the shutdown at once, before session-end', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await launch('win32');
    const win = windowOf();
    win('query-session-end', { reasons: ['shutdown'] });
    assert.equal(onDisk().quitReason, 'os-shutdown');
    assert.equal(onDisk().lastEvent, 'query-session-end');
    // Windows ends the process here: the next launch still reads a shutdown.
    assert.equal(nextLaunchReads().how, 'os_shutdown');
    win('session-end', { reasons: ['shutdown'] });
    mock.timers.tick(SHUTDOWN_CANCEL_MS + 1000);
    assert.equal(onDisk().quitReason, 'os-shutdown', 'a shutdown that went ahead keeps its label');
  } finally { mock.timers.reset(); }
});

test('win32: a shutdown called off after query-session-end is taken back, and crashes count again', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await launch('win32');
    const win = windowOf();
    win('query-session-end', { reasons: ['logoff'] });
    windowOf()('query-session-end', { reasons: ['logoff'] }); // every window is asked
    mock.timers.tick(SHUTDOWN_CANCEL_MS - 1000);
    assert.equal(onDisk().quitReason, 'os-shutdown');
    mock.timers.tick(2000);
    assert.equal(onDisk().quitReason, null);
    assert.equal(onDisk().lastEvent, 'session-end-cancelled');
    fire('render-process-gone', {}, webContents, { reason: 'crashed', exitCode: 1 });
    assert.equal(onDisk().crashes.renderer, 1);
    assert.equal(nextLaunchReads().how, 'vanished');
  } finally { mock.timers.reset(); }
});

test('win32: the user quitting after a shutdown was called off reads as a quit, not a shutdown', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const tracker = await launch('win32');
    windowOf()('query-session-end', { reasons: ['shutdown'] });
    assert.equal(onDisk().quitReason, 'os-shutdown');
    // Another app held the shutdown up and the user cancelled; 30 s later they quit.
    mock.timers.tick(30_000);
    fire('before-quit', {});
    assert.equal(onDisk().quitReason, 'user-quit');
    fire('will-quit', {});
    tracker.markCleanExit();
    mock.timers.tick(SHUTDOWN_CANCEL_MS);
    assert.equal(onDisk().quitReason, 'user-quit', 'the take-back timer is gone');
    assert.equal(nextLaunchReads().how, 'quit');
    assert.equal(tracker.didPreviousSessionCrash(), false);
  } finally { mock.timers.reset(); }
});

test('win32: closing the last window after a called-off shutdown reads as a window close', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const tracker = await launch('win32');
    windowOf()('query-session-end', { reasons: ['logoff'] });
    fire('window-all-closed');
    assert.equal(onDisk().quitReason, 'window-close');
    fire('before-quit', {});
    fire('will-quit', {});
    tracker.markCleanExit();
    assert.equal(nextLaunchReads().how, 'quit');
  } finally { mock.timers.reset(); }
});

test('win32: a quit that started after session-end stays a shutdown', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const tracker = await launch('win32');
    const win = windowOf();
    win('query-session-end', { reasons: ['shutdown'] });
    win('session-end', { reasons: ['shutdown'] });
    fire('window-all-closed');
    fire('before-quit', {});
    mock.timers.tick(SHUTDOWN_CANCEL_MS + 1000);
    fire('will-quit', {});
    tracker.markCleanExit();
    assert.equal(nextLaunchReads().how, 'os_shutdown');
  } finally { mock.timers.reset(); }
});

test('win32: session-end arriving after the quit began still marks the shutdown', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await launch('win32');
    const win = windowOf();
    win('query-session-end', { reasons: ['shutdown'] });
    fire('before-quit', {});
    assert.equal(onDisk().quitReason, 'user-quit');
    win('session-end', { reasons: ['shutdown'] });
    assert.equal(onDisk().quitReason, 'os-shutdown');
    // Windows ends the process here.
    assert.equal(nextLaunchReads().how, 'os_shutdown');
  } finally { mock.timers.reset(); }
});

test('win32: an update or a restart during a pending shutdown is not taken back to nothing', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const tracker = await launch('win32');
    windowOf()('query-session-end', { reasons: ['shutdown'] });
    tracker.markRestart('restart-app');
    mock.timers.tick(SHUTDOWN_CANCEL_MS + 1000);
    assert.equal(onDisk().quitReason, 'app-restart');
  } finally { mock.timers.reset(); }
});

test('darwin: no query-session-end is wired (Windows only)', async () => {
  await launch('darwin');
  assert.equal(handlers['browser-window-created'], undefined);
});

// ── The debug log as evidence ───────────────────────────────────────────────

test('only the first note of the prior log write counts', async () => {
  const tracker = await launch('darwin');
  assert.equal(tracker.getPriorLogWrite(), null);
  tracker.notePriorLogWrite(1234);
  tracker.notePriorLogWrite(9999);
  assert.equal(tracker.getPriorLogWrite(), 1234);
  LifecycleTracker.instance = null;
  const t2 = LifecycleTracker.getInstance();
  t2.notePriorLogWrite(null);
  t2.notePriorLogWrite(5);
  assert.equal(t2.getPriorLogWrite(), null, 'no log yet is an answer too');
});

test('main.ts notes the log time before its first write resets the log', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../main.ts'), 'utf8');
  const fn = src.slice(src.indexOf('function logToFile(msg: string) {'));
  const note = fn.indexOf('notePriorLogWrite(mtimeMs)');
  const reset = fn.indexOf('resetStartupLog();');
  assert.ok(note !== -1 && reset !== -1 && note < reset);
});

// ── Review fixes (2026-11-14) ───────────────────────────────────────────────

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: "Restart now" (relaunch + app.exit, no before-quit) reads as a restart, not a crash`, async () => {
    const tracker = await launch(platform);
    tracker.markRestart('restart-app');
    // app.exit(0): no before-quit, no will-quit, no clean exit.
    assert.equal(nextLaunchReads().how, 'restart');
    const m = onDisk();
    leavePrevious({ ...m });
    const next = await launch(platform, userData);
    assert.equal(next.didPreviousSessionCrash(), false, 'the log is truncated, no "ended unexpectedly" warning');
  });

  test(`${platform}: one unhandled rejection the app survives does not turn the later quit into a crash`, async () => {
    LifecycleTracker.instance = null;
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-run-end-'));
    handlers = {};
    const tracker = LifecycleTracker.getInstance();
    const EVENTS = ['unhandledRejection', 'uncaughtException', 'SIGTERM', 'SIGINT', 'SIGHUP'];
    const before = Object.fromEntries(EVENTS.map((e) => [e, process.listeners(e)]));
    LifecycleTracker.installBeforeReady(() => {});
    tracker.install(() => {}, platform);
    const addedBy = (e) => process.listeners(e).filter((fn) => !before[e].includes(fn));
    const added = addedBy('unhandledRejection');
    try {
      for (const fn of added) fn(new Error('stray'), Promise.resolve());
      assert.equal(onDisk().quitReason, null);
      assert.equal(onDisk().lastIncident.event, 'unhandledRejection');
      fire('before-quit', {});
      fire('will-quit', {});
      tracker.markCleanExit();
      assert.equal(nextLaunchReads().how, 'quit');
    } finally {
      for (const e of EVENTS) for (const fn of addedBy(e)) process.off(e, fn);
    }
  });
}

test('darwin: closing every window is not a quit (the app keeps running), so a later vanish still reads as vanished', async () => {
  await launch('darwin');
  fire('window-all-closed');
  assert.equal(onDisk().quitReason, null);
  assert.equal(onDisk().lastEvent, 'window-all-closed');
  assert.equal(nextLaunchReads().how, 'vanished');
});
