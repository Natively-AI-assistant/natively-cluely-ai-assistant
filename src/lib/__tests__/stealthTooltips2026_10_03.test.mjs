// Stealth custom-tooltip switch (lib/stealthTooltips): while undetectable,
// `.t-tt` tooltips must not render in ANY window. Fake-DOM contract tests
// (no jsdom in this repo) mirroring the nativeTooltipGuard suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../stealthTooltips.mjs'),
);
const { wireStealthTooltips } = lib;

function fakeRoot() {
  return { dataset: {} };
}
function fakeApi({ initial = false, listenable = true, readable = true } = {}) {
  let listener = null;
  return {
    calls: [],
    getUndetectable: readable
      ? () => Promise.resolve(initial)
      : undefined,
    onUndetectableChanged: listenable
      ? (fn) => {
          listener = fn;
          return () => {
            listener = null;
          };
        }
      : undefined,
    fire(v) {
      if (listener) listener(v);
    },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('no api at all: no-op, dataset untouched', () => {
  const root = fakeRoot();
  const dispose = wireStealthTooltips(root, null);
  assert.deepEqual(root.dataset, {});
  assert.doesNotThrow(dispose);
});

test('api without either accessor: no-op', () => {
  const root = fakeRoot();
  wireStealthTooltips(root, {});
  assert.deepEqual(root.dataset, {});
});

test('stealth-safe default: off until normal mode is confirmed', async () => {
  const root = fakeRoot();
  const api = fakeApi({ initial: false });
  wireStealthTooltips(root, api);
  assert.equal(root.dataset.tooltips, 'off');
  await tick();
  assert.ok(!('tooltips' in root.dataset));
});

test('persisted-stealth launch: stays off after the read resolves', async () => {
  const root = fakeRoot();
  wireStealthTooltips(root, fakeApi({ initial: true }));
  await tick();
  assert.equal(root.dataset.tooltips, 'off');
});

test('mid-session toggle flips the attribute both ways', async () => {
  const root = fakeRoot();
  const api = fakeApi({ initial: false });
  wireStealthTooltips(root, api);
  await tick();
  assert.ok(!('tooltips' in root.dataset));
  api.fire(true);
  assert.equal(root.dataset.tooltips, 'off');
  api.fire(false);
  assert.ok(!('tooltips' in root.dataset));
});

test('event beats late read (toggle during the initial round-trip)', async () => {
  const root = fakeRoot();
  let resolveRead;
  const api = fakeApi({ initial: false });
  api.getUndetectable = () => new Promise((r) => {
    resolveRead = r;
  });
  wireStealthTooltips(root, api);
  api.fire(true);
  resolveRead(false);
  await tick();
  assert.equal(root.dataset.tooltips, 'off');
});

test('read-only api (no listener): still follows the initial read', async () => {
  const root = fakeRoot();
  wireStealthTooltips(root, fakeApi({ initial: false, listenable: false }));
  await tick();
  assert.ok(!('tooltips' in root.dataset));
});

test('disposer removes the change listener without touching the attribute', async () => {
  const root = fakeRoot();
  const api = fakeApi({ initial: false });
  const dispose = wireStealthTooltips(root, api);
  await tick();
  dispose();
  api.fire(true);
  assert.ok(!('tooltips' in root.dataset));
});
