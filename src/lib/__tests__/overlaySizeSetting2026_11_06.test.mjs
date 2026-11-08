// Settings → General → Advanced → "Keep overlay size" (2026-11-06): the overlay
// size A/B ended with B kept as the default and this switch to turn it off.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.StorageEvent = class extends Event { constructor(type, init = {}) { super(type); this.key = init.key ?? null; } };
const target = new EventTarget();
const sent = [];
let broadcast = null;
globalThis.window = {
  addEventListener: target.addEventListener.bind(target),
  removeEventListener: target.removeEventListener.bind(target),
  dispatchEvent: target.dispatchEvent.bind(target),
  electronAPI: {
    setKeepOverlaySizeEnabled: (enabled) => sent.push(enabled),
    onKeepOverlaySizeChanged: (cb) => { broadcast = cb; return () => { broadcast = null; }; },
  },
};

const {
  KEEP_OVERLAY_SIZE_KEY, isKeepOverlaySizeEnabled, setKeepOverlaySizeEnabled, subscribeKeepOverlaySize,
} = await import('../overlaySizeSetting.ts');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

beforeEach(() => {
  setKeepOverlaySizeEnabled(true);
  store.clear();
  sent.length = 0;
});

test('on by default: the behaviour B shipped with', () => {
  assert.equal(isKeepOverlaySizeEnabled(), true);
});

test('turning it off persists, and on again restores it', () => {
  setKeepOverlaySizeEnabled(false);
  assert.equal(store.get(KEEP_OVERLAY_SIZE_KEY), 'off');
  assert.equal(isKeepOverlaySizeEnabled(), false);
  setKeepOverlaySizeEnabled(true);
  assert.equal(store.get(KEEP_OVERLAY_SIZE_KEY), 'on');
  assert.equal(isKeepOverlaySizeEnabled(), true);
});

test('a change notifies subscribers once, and is sent to main for the other windows', () => {
  let calls = 0;
  const off = subscribeKeepOverlaySize(() => { calls++; });
  setKeepOverlaySizeEnabled(false);
  setKeepOverlaySizeEnabled(false);
  off();
  assert.equal(calls, 1);
  assert.deepEqual(sent, [false, false]);
});

test('the launcher\'s change reaches the overlay over IPC, taken as sent (booleans only)', () => {
  assert.equal(typeof broadcast, 'function', 'listening from load');
  broadcast(false);
  assert.equal(isKeepOverlaySizeEnabled(), false);
  broadcast('on');
  assert.equal(isKeepOverlaySizeEnabled(), false);
  broadcast(true);
  assert.equal(isKeepOverlaySizeEnabled(), true);
});

test('and through the storage event', () => {
  store.set(KEEP_OVERLAY_SIZE_KEY, 'off');
  window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
  assert.equal(isKeepOverlaySizeEnabled(), true, 'other keys are ignored');
  window.dispatchEvent(new StorageEvent('storage', { key: KEEP_OVERLAY_SIZE_KEY }));
  assert.equal(isKeepOverlaySizeEnabled(), false);
});

test('unreadable storage keeps the size (the default)', () => {
  setKeepOverlaySizeEnabled(false);
  const real = globalThis.localStorage.getItem;
  globalThis.localStorage.getItem = () => { throw new Error('denied'); };
  try {
    window.dispatchEvent(new StorageEvent('storage', { key: KEEP_OVERLAY_SIZE_KEY }));
    assert.equal(isKeepOverlaySizeEnabled(), true);
  } finally { globalThis.localStorage.getItem = real; }
});

test('wiring: the overlay follows the switch; the A/B toggle is gone', () => {
  const overlay = read('src/components/NativelyInterface.tsx');
  assert.doesNotMatch(overlay, /AB-TEMP|natively\.overlaySizeAB/);
  assert.match(overlay, /const holdOverlaySizeRef = useRef<boolean>\(isKeepOverlaySizeEnabled\(\)\);/);
  assert.match(overlay, /return subscribeKeepOverlaySize\(follow\);/);
  // The three places the size is held still read it.
  assert.equal((overlay.match(/holdOverlaySizeRef\.current/g) ?? []).length, 4);
});

test('wiring: the switch is in General → Advanced, and main passes it to every window', () => {
  const settings = read('src/components/SettingsOverlay.tsx');
  const advanced = settings.slice(settings.indexOf('<Disclosure open={showAdvancedSettings}'));
  assert.match(advanced, /label=\{t\('Keep overlay size'\)\}\s*onChange=\{\(\) => setKeepOverlaySizeEnabled\(!keepOverlaySize\)\}/);
  const main = read('electron/ipcHandlers.ts');
  assert.match(main, /safeOn\('keep-overlay-size:set', \(_event, enabled: unknown\) => \{\s*if \(typeof enabled !== 'boolean'\) return;[\s\S]{0,200}win\.webContents\.send\('keep-overlay-size:changed', enabled\)/);
  const preload = read('electron/preload.ts');
  assert.match(preload, /ipcRenderer\.send\('keep-overlay-size:set', enabled\)/);
  assert.match(preload, /ipcRenderer\.on\('keep-overlay-size:changed', handler\)/);
});
