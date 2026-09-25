import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrphanReleaseGuard, installOrphanReleaseClick } from '../orphanReleaseGuard.mjs';

// The overlay settings popover on Windows delivered a release with no press, so no
// click fired and the switch never moved (live-reproduced 2026-09-26).
test('a primary release with no press activates', () => {
  const g = createOrphanReleaseGuard();
  assert.equal(g.release(0), true);
});

test('a normal press + release is left to the click, so one click never toggles twice', () => {
  const g = createOrphanReleaseGuard();
  g.press();
  assert.equal(g.release(0), false);
});

test('each release consumes its press: the next orphan release activates again', () => {
  const g = createOrphanReleaseGuard();
  g.press();
  g.release(0);
  assert.equal(g.release(0), true);
});

test('non-primary buttons never activate', () => {
  const g = createOrphanReleaseGuard();
  assert.equal(g.release(1), false);
  assert.equal(g.release(2), false);
});

test('a cancelled press does not suppress the next orphan release', () => {
  const g = createOrphanReleaseGuard();
  g.press();
  g.cancel();
  assert.equal(g.release(0), true);
});

// Window-level install: the model selector's rows had the same dead clicks as the
// settings switches, so the guard covers every control in the popover windows.
function fakeWindow() {
  const handlers = {};
  return {
    addEventListener(type, fn) { handlers[type] = fn; },
    removeEventListener(type) { delete handlers[type]; },
    fire(type, e) { handlers[type]?.(e); },
    handlers,
  };
}
function fakeControl({ disabled = false, ariaDisabled = null } = {}) {
  const el = { clicks: 0, disabled, click() { this.clicks++; }, getAttribute: (n) => (n === 'aria-disabled' ? ariaDisabled : null) };
  return { el, target: { closest: () => el } };
}

test('install: an orphaned release clicks the control under it', () => {
  const w = fakeWindow(); const { el, target } = fakeControl();
  installOrphanReleaseClick(w);
  w.fire('pointerup', { button: 0, target });
  assert.equal(el.clicks, 1);
});

test('install: a normal press + release leaves the click to the browser', () => {
  const w = fakeWindow(); const { el, target } = fakeControl();
  installOrphanReleaseClick(w);
  w.fire('pointerdown', { button: 0, target });
  w.fire('pointerup', { button: 0, target });
  assert.equal(el.clicks, 0);
});

test('install: disabled controls and non-controls are never clicked', () => {
  const w = fakeWindow();
  installOrphanReleaseClick(w);
  const a = fakeControl({ disabled: true }); w.fire('pointerup', { button: 0, target: a.target });
  const b = fakeControl({ ariaDisabled: 'true' }); w.fire('pointerup', { button: 0, target: b.target });
  w.fire('pointerup', { button: 0, target: { closest: () => null } });
  assert.equal(a.el.clicks + b.el.clicks, 0);
});

test('install: uninstall removes every listener', () => {
  const w = fakeWindow();
  installOrphanReleaseClick(w)();
  assert.deepEqual(Object.keys(w.handlers), []);
});
