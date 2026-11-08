// electron/utils/__tests__/LifecycleIncidentNotQuitReason2026_10_31.test.mjs
//
// 2026-10-31: a renderer killed earlier in a session (reason 'killed', exit
// code 15) left quitReason = 'renderer-gone' on the lifecycle marker for the
// rest of the session. A later normal Cmd+Q was then logged as
// "before-quit reason=renderer-gone" and the next launch reported that the
// previous session "ended unexpectedly".
//
// A renderer / child / GPU process dying while the app keeps running is now
// kept in `lastIncident` and leaves the quit reason alone. This test drives
// the REAL compiled module (not a copy), with an Electron stub, through the
// quit sequences each platform produces:
//   macOS:   Cmd+Q -> before-quit -> will-quit (the app stays alive when its
//            windows close, so window-all-closed does not quit it)
//   Windows: closing the last window -> window-all-closed -> app.quit() ->
//            before-quit, with renderers exiting as their windows close
// The tracker has no platform branch of its own; main.ts decides which
// sequence happens. Both sequences are exercised here.
//
// Run via: npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/utils/__tests__/LifecycleIncidentNotQuitReason2026_10_31.test.mjs

import test from 'node:test';
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
const electronStub = {
  app: {
    getPath: (key) => (key === 'userData' ? userData : os.tmpdir()),
    on: (event, fn) => { (handlers[event] ||= []).push(fn); },
  },
  BrowserWindow: class {},
  WebContents: class {},
  utilityProcess: {},
};
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true, exports: electronStub,
};

const { LifecycleTracker, SURVIVABLE_PROCESS_EVENTS } = require(
  path.join(__dirname, '../../../dist-electron/electron/utils/lifecycleTracker.js'),
);

const fire = (event, ...args) => { for (const fn of handlers[event] || []) fn(...args); };
const webContents = { id: 9, getURL: () => 'http://127.0.0.1:5173/?window=launcher' };

/** A fresh tracker in a fresh userData dir, as at app start. */
function freshSession() {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-lifecycle-'));
  handlers = {};
  LifecycleTracker.instance = null; // private static; reset for each session
  const tracker = LifecycleTracker.getInstance();
  const lines = [];
  tracker.install((msg) => lines.push(msg));
  return { tracker, lines };
}

/** What the NEXT launch reads: the same marker, written by another pid. */
function nextLaunchSaysCrashed() {
  const file = path.join(userData, 'lifecycle-marker.json');
  const marker = JSON.parse(fs.readFileSync(file, 'utf8'));
  marker.pid = process.pid + 1;
  fs.writeFileSync(file, JSON.stringify(marker));
  return { crashed: LifecycleTracker.getInstance().didPreviousSessionCrash(), marker };
}

const killedRenderer = () => fire('render-process-gone', {}, webContents, { reason: 'killed', exitCode: 15 });

test('the survivable process events are exactly the three process deaths', () => {
  assert.deepEqual(
    [...SURVIVABLE_PROCESS_EVENTS].sort(),
    ['child-process-gone', 'gpu-process-crashed', 'render-process-gone'],
  );
});

test('a renderer killed mid-session no longer labels a later Cmd+Q (macOS sequence)', () => {
  const { tracker, lines } = freshSession();
  killedRenderer();
  assert.equal(tracker.marker.quitReason, null);
  assert.equal(tracker.marker.lastIncident.event, 'render-process-gone');
  assert.equal(tracker.marker.lastIncident.meta.exitCode, 15);

  fire('before-quit', {});
  fire('will-quit', {});
  tracker.markCleanExit();

  assert.ok(lines.includes('[Lifecycle] before-quit reason=user-quit'), lines.join('\n'));
  assert.ok(!lines.some((l) => l.includes('reason=renderer-gone')), lines.join('\n'));
  const { crashed, marker } = nextLaunchSaysCrashed();
  assert.equal(crashed, false);
  assert.equal(marker.quitReason, 'user-quit');
  assert.equal(marker.lastIncident.event, 'render-process-gone', 'the incident is still on record');
});

test('renderers exiting while the last window closes do not turn a normal quit into a crash (Windows sequence)', () => {
  const { tracker } = freshSession();
  fire('window-all-closed');
  fire('before-quit', {});
  killedRenderer();
  fire('render-process-gone', {}, { id: 11, getURL: () => 'http://127.0.0.1:5173/?window=overlay' }, { reason: 'clean-exit', exitCode: 0 });
  fire('will-quit', {});
  tracker.markCleanExit();

  const { crashed, marker } = nextLaunchSaysCrashed();
  assert.equal(marker.quitReason, 'window-close');
  assert.equal(crashed, false);
});

test('a GPU or utility process respawn does not overwrite an updater quit reason', () => {
  const { tracker } = freshSession();
  tracker.setQuitReason('updater-quit-install', { fromVersion: '2.9.2', toVersion: '2.9.3' });
  fire('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 1 });
  fire('gpu-process-crashed', {}, true);
  fire('before-quit', {});
  tracker.markCleanExit();

  const { crashed, marker } = nextLaunchSaysCrashed();
  assert.equal(marker.quitReason, 'updater-quit-install');
  assert.equal(marker.quitMeta.toVersion, '2.9.3');
  assert.equal(crashed, false);
});

test('a session that really dies after a renderer death still reads as a crash', () => {
  freshSession();
  fire('render-process-gone', {}, webContents, { reason: 'crashed', exitCode: 11 });
  // No before-quit and no clean exit: the process was gone (crash-loop
  // give-up uses app.exit, an OS kill skips everything).
  const { crashed, marker } = nextLaunchSaysCrashed();
  assert.equal(crashed, true);
  assert.equal(marker.lastEvent, 'render-process-gone');
});

test('a marker written by an older build with quitReason renderer-gone still reads as a crash', () => {
  freshSession();
  fs.writeFileSync(path.join(userData, 'lifecycle-marker.json'), JSON.stringify({
    pid: process.pid + 1, startedAt: 'x', lastEvent: 'clean-exit', lastEventAt: 'x', quitReason: 'renderer-gone',
  }));
  assert.equal(LifecycleTracker.getInstance().didPreviousSessionCrash(), true);
});

test('the startup warning names the last incident', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../main.ts'), 'utf8');
  assert.match(src, /lastIncident=\$\{prev\.lastIncident\.event\}@\$\{prev\.lastIncident\.at\}/);
});
