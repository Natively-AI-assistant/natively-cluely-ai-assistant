import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrphanReleaseGuard } from '../orphanReleaseGuard.mjs';

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
