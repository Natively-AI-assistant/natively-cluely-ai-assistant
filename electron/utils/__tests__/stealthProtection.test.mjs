// Stealth content-protection loop (utils/stealthProtection): periodic
// re-assertion + show/restore guards while undetectable. Pure contract
// tests — no real timers (injectable scheduler), no Electron (window fakes).
// Imports COMPILED output from dist-electron (npm run build:electron first),
// like the other utils suites.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dist = (p) =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist-electron/electron/utils', p);
const { createStealthProtectionLoop } = require(dist('stealthProtection.js'));

function fakeWindow(opts = {}) {
  const listeners = {};
  return {
    destroyed: false,
    protectedWith: [],
    isDestroyed() {
      return this.destroyed;
    },
    setContentProtection(v) {
      this.protectedWith.push(v);
    },
    on(evt, fn) {
      (listeners[evt] = listeners[evt] || []).push(fn);
    },
    emit(evt) {
      for (const fn of listeners[evt] || []) fn();
    },
    listenerCount(evt) {
      return (listeners[evt] || []).length;
    },
    ...opts,
  };
}

const windows = (wins) => () => wins.map((win, i) => ({ label: `w${i}`, win }));

test('inert when not undetectable — no window touched', () => {
  const a = fakeWindow();
  const loop = createStealthProtectionLoop({
    isUndetectable: () => false,
    getWindows: windows([a]),
  });
  assert.deepEqual(loop.applyOnce(), { applied: 0, skipped: 0 });
  assert.deepEqual(a.protectedWith, []);
});

test('undetectable: applies to every live window, skips null/destroyed', () => {
  const live = fakeWindow();
  const dead = fakeWindow();
  dead.destroyed = true;
  const loop = createStealthProtectionLoop({
    isUndetectable: () => true,
    getWindows: windows([live, null, undefined, dead, {}]),
  });
  assert.deepEqual(loop.applyOnce(), { applied: 1, skipped: 4 });
  assert.deepEqual(live.protectedWith, [true]);
});

test('a throwing setContentProtection counts as skipped, never throws', () => {
  const bad = fakeWindow({
    setContentProtection() {
      throw new Error('gone');
    },
  });
  const loop = createStealthProtectionLoop({
    isUndetectable: () => true,
    getWindows: windows([bad]),
  });
  assert.deepEqual(loop.applyOnce(), { applied: 0, skipped: 1 });
});

test('attachWindow is idempotent and re-applies on show/restore only while undetectable', () => {
  let undetectable = false;
  const w = fakeWindow();
  const loop = createStealthProtectionLoop({
    isUndetectable: () => undetectable,
    getWindows: windows([w]),
  });
  loop.attachWindow(w);
  loop.attachWindow(w);
  assert.equal(w.listenerCount('show'), 1);
  assert.equal(w.listenerCount('restore'), 1);
  w.emit('show');
  assert.deepEqual(w.protectedWith, []);
  undetectable = true;
  w.emit('show');
  w.emit('restore');
  assert.deepEqual(w.protectedWith, [true, true]);
});

test('attachWindow ignores null/destroyed/non-windows', () => {
  const dead = fakeWindow();
  dead.destroyed = true;
  const loop = createStealthProtectionLoop({
    isUndetectable: () => true,
    getWindows: windows([]),
  });
  assert.doesNotThrow(() => {
    loop.attachWindow(null);
    loop.attachWindow(undefined);
    loop.attachWindow({});
    loop.attachWindow(dead);
    loop.attachWindow({ isDestroyed: () => false });
  });
});

test('start/stop drive the injectable scheduler; ticks honour event-time state', () => {
  let undetectable = false;
  const w = fakeWindow();
  const scheduled = [];
  const loop = createStealthProtectionLoop({
    isUndetectable: () => undetectable,
    getWindows: windows([w]),
    intervalMs: 500,
    schedule: (fn, ms) => {
      scheduled.push({ fn, ms });
      return { stop() {} };
    },
  });
  assert.equal(loop.running, false);
  loop.start();
  loop.start();
  assert.equal(loop.running, true);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 500);
  scheduled[0].fn();
  assert.deepEqual(w.protectedWith, []);
  undetectable = true;
  scheduled[0].fn();
  assert.deepEqual(w.protectedWith, [true]);
  loop.stop();
  loop.stop();
  assert.equal(loop.running, false);
});

test('a throwing state reader or tick never propagates', () => {
  let tick = null;
  const loop = createStealthProtectionLoop({
    isUndetectable: () => {
      throw new Error('settings gone');
    },
    getWindows: windows([]),
    schedule: (fn) => {
      tick = fn;
      return { stop() {} };
    },
  });
  assert.doesNotThrow(() => {
    loop.start();
    loop.applyOnce();
    tick();
  });
  loop.stop();
});
