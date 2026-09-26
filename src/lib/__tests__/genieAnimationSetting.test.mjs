import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser globals: a localStorage and a window that dispatches events.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.StorageEvent = class extends Event { constructor(type, init = {}) { super(type); this.key = init.key ?? null; } };
const target = new EventTarget();
globalThis.window = {
  addEventListener: target.addEventListener.bind(target),
  removeEventListener: target.removeEventListener.bind(target),
  dispatchEvent: target.dispatchEvent.bind(target),
};

const { GENIE_ANIMATION_KEY, isGenieAnimationEnabled, setGenieAnimationEnabled } = await import('../genieAnimationSetting.ts');

beforeEach(() => store.clear());

test('the genie is on by default', () => {
  assert.equal(isGenieAnimationEnabled(), true);
});

test('turning it off persists, and on again restores it', () => {
  setGenieAnimationEnabled(false);
  assert.equal(store.get(GENIE_ANIMATION_KEY), 'off');
  assert.equal(isGenieAnimationEnabled(), false);
  setGenieAnimationEnabled(true);
  assert.equal(isGenieAnimationEnabled(), true);
});

test('a change notifies listeners in this window (other windows get the native storage event)', () => {
  let seen = null;
  const fn = (e) => { seen = e.key; };
  window.addEventListener('storage', fn);
  setGenieAnimationEnabled(false);
  window.removeEventListener('storage', fn);
  assert.equal(seen, GENIE_ANIMATION_KEY);
});

test('unreadable storage leaves the animation on', () => {
  const real = globalThis.localStorage.getItem;
  globalThis.localStorage.getItem = () => { throw new Error('denied'); };
  try { assert.equal(isGenieAnimationEnabled(), true); } finally { globalThis.localStorage.getItem = real; }
});
