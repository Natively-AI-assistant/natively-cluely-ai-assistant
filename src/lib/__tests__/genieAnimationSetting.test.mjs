import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser globals: a localStorage, a window that dispatches events,
// and a preload that records what goes to main and hands back its broadcast.
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
    setGenieAnimationEnabled: (enabled) => sent.push(enabled),
    onGenieAnimationChanged: (cb) => { broadcast = cb; return () => { broadcast = null; }; },
  },
};

const {
  GENIE_ANIMATION_KEY, isGenieAnimationEnabled, setGenieAnimationEnabled, subscribeGenieAnimation,
} = await import('../genieAnimationSetting.ts');

beforeEach(() => {
  setGenieAnimationEnabled(true);
  store.clear();
  sent.length = 0;
});

test('the genie is on by default', () => {
  assert.equal(isGenieAnimationEnabled(), true);
});

test('turning it off persists, and on again restores it', () => {
  setGenieAnimationEnabled(false);
  assert.equal(store.get(GENIE_ANIMATION_KEY), 'off');
  assert.equal(isGenieAnimationEnabled(), false);
  setGenieAnimationEnabled(true);
  assert.equal(store.get(GENIE_ANIMATION_KEY), 'on');
  assert.equal(isGenieAnimationEnabled(), true);
});

test('a change notifies this window’s subscribers once, without a fake storage event', () => {
  let calls = 0;
  let storageEvents = 0;
  const onStorage = () => { storageEvents++; };
  window.addEventListener('storage', onStorage);
  const off = subscribeGenieAnimation(() => { calls++; });
  setGenieAnimationEnabled(false);
  setGenieAnimationEnabled(false);
  off();
  window.removeEventListener('storage', onStorage);
  assert.equal(calls, 1, 'no repeat for the same value');
  assert.equal(storageEvents, 0, 'other storage listeners in this window are left alone');
});

test('a change is sent to main, which passes it to every window', () => {
  setGenieAnimationEnabled(false);
  assert.deepEqual(sent, [false]);
});

test('another window’s change arrives over IPC and is taken as sent', () => {
  assert.equal(typeof broadcast, 'function', 'listening from load');
  let calls = 0;
  const off = subscribeGenieAnimation(() => { calls++; });
  // This renderer's storage can still say "on": the IPC value wins.
  broadcast(false);
  assert.equal(isGenieAnimationEnabled(), false);
  broadcast('off');
  assert.equal(isGenieAnimationEnabled(), false, 'only a boolean is taken');
  broadcast(true);
  off();
  assert.equal(isGenieAnimationEnabled(), true);
  assert.equal(calls, 2);
});

test('another window’s change also arrives through the storage event', () => {
  store.set(GENIE_ANIMATION_KEY, 'off');
  window.dispatchEvent(new StorageEvent('storage', { key: 'some_other_key' }));
  assert.equal(isGenieAnimationEnabled(), true, 'other keys are ignored');
  window.dispatchEvent(new StorageEvent('storage', { key: GENIE_ANIMATION_KEY }));
  assert.equal(isGenieAnimationEnabled(), false);
});

test('unreadable storage leaves the animation on', () => {
  setGenieAnimationEnabled(false);
  const real = globalThis.localStorage.getItem;
  globalThis.localStorage.getItem = () => { throw new Error('denied'); };
  try {
    window.dispatchEvent(new StorageEvent('storage', { key: GENIE_ANIMATION_KEY }));
    assert.equal(isGenieAnimationEnabled(), true);
  } finally { globalThis.localStorage.getItem = real; }
});

test('unwritable storage still switches this window', () => {
  const real = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { throw new Error('quota'); };
  try {
    setGenieAnimationEnabled(false);
    assert.equal(isGenieAnimationEnabled(), false);
    assert.deepEqual(sent, [false], 'and still tells the other windows');
  } finally { globalThis.localStorage.setItem = real; }
});
