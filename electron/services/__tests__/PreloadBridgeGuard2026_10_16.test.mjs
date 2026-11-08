// electron/services/__tests__/PreloadBridgeGuard2026_10_16.test.mjs
//
// A window whose page finished loading without its preload reporting in is
// reloaded, at most PRELOAD_GUARD_MAX_RELOADS times; healthy pages, foreign
// pages and subframe or in-page navigations never trigger it. See
// electron/preloadBridgeGuard.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const cjs = createRequire(path.join(root, 'package.json'));
const ipcListeners = {};
const electronStub = new Module('electron');
electronStub.exports = { ipcMain: { on: (ch, fn) => { ipcListeners[ch] = fn; } } };
electronStub.loaded = true;
cjs.cache[cjs.resolve('electron')] = electronStub;
const guard = cjs(path.join(root, 'dist-electron/electron/preloadBridgeGuard.js'));

let nextId = 1;
function fakeWindow(url = 'http://127.0.0.1:5173/?window=launcher') {
  const handlers = {};
  const wc = { id: nextId++, reloads: 0, destroyed: false, getURL: () => url, isDestroyed: () => wc.destroyed,
    reloadIgnoringCache: () => { wc.reloads++; }, on: (ev, fn) => { handlers[ev] = fn; } };
  return { win: { webContents: wc }, wc, emit: (ev, ...a) => handlers[ev]?.(...a) };
}
const silent = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = (wc) => ipcListeners[guard.PRELOAD_READY_CHANNEL]({ sender: { id: wc.id } });
const navigate = (w) => w.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });

test('a page whose preload reported in is left alone', async () => {
  const w = fakeWindow();
  guard.attachPreloadBridgeGuard(w.win, 'launcher', { waitMs: 5, log: silent });
  navigate(w); await sleep(2); report(w.wc); w.emit('did-finish-load');
  await sleep(20);
  assert.equal(w.wc.reloads, 0);
});

test('a page that loaded without a report is reloaded, and stops once it reports', async () => {
  const w = fakeWindow();
  guard.attachPreloadBridgeGuard(w.win, 'launcher', { waitMs: 5, log: silent });
  navigate(w); w.emit('did-finish-load');
  await sleep(20);
  assert.equal(w.wc.reloads, 1);
  navigate(w); await sleep(2); report(w.wc); w.emit('did-finish-load');
  await sleep(20);
  assert.equal(w.wc.reloads, 1);
});

test('a report from the previous document does not count for the next', async () => {
  const w = fakeWindow();
  guard.attachPreloadBridgeGuard(w.win, 'overlay', { waitMs: 5, log: silent });
  navigate(w); await sleep(2); report(w.wc); w.emit('did-finish-load'); await sleep(20);
  await sleep(2); navigate(w); w.emit('did-finish-load'); await sleep(20);
  assert.equal(w.wc.reloads, 1);
});

test('subframe and in-page navigations, in either event form, do not reset a healthy page', async () => {
  const w = fakeWindow();
  guard.attachPreloadBridgeGuard(w.win, 'launcher', { waitMs: 5, log: silent });
  navigate(w); await sleep(2); report(w.wc);
  await sleep(2);
  w.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });           // an iframe
  w.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });             // pushState / #hash
  w.emit('did-start-navigation', {}, 'http://x/#a', true, true);                           // positional, in-page
  w.emit('did-start-navigation', {}, 'http://x/frame', false, false);                      // positional, subframe
  w.emit('did-finish-load'); await sleep(20);
  assert.equal(w.wc.reloads, 0);
});

test('never loops: gives up after the maximum number of reloads', async () => {
  const w = fakeWindow();
  const logs = [];
  guard.attachPreloadBridgeGuard(w.win, 'overlay', { waitMs: 2, log: (m) => logs.push(m) });
  for (let i = 0; i < guard.PRELOAD_GUARD_MAX_RELOADS + 3; i++) { navigate(w); w.emit('did-finish-load'); await sleep(10); }
  assert.equal(w.wc.reloads, guard.PRELOAD_GUARD_MAX_RELOADS);
  assert.match(logs.at(-1), /giving up/);
});

test('foreign pages and destroyed windows are skipped; packaged file:// pages are guarded', async () => {
  const foreign = fakeWindow('https://accounts.google.com/o/oauth2');
  guard.attachPreloadBridgeGuard(foreign.win, 'launcher', { waitMs: 2, log: silent });
  navigate(foreign); foreign.emit('did-finish-load');
  const gone = fakeWindow();
  guard.attachPreloadBridgeGuard(gone.win, 'launcher', { waitMs: 2, log: silent });
  navigate(gone); gone.emit('did-finish-load'); gone.wc.destroyed = true;
  const packaged = fakeWindow('file:///Applications/Natively.app/Contents/Resources/app.asar/dist/index.html?window=launcher');
  guard.attachPreloadBridgeGuard(packaged.win, 'launcher', { waitMs: 2, log: silent });
  navigate(packaged); packaged.emit('did-finish-load');
  await sleep(20);
  assert.equal(foreign.wc.reloads + gone.wc.reloads, 0);
  assert.equal(packaged.wc.reloads, 1);
});
