// L1 (2026-11-09): the first-run cards never came after Welcome.
//
// OrchestratorProvider mounts only once Welcome is gone, in the same commit as
// the Launcher, and the Launcher's effect runs first: its 'launcher:mounted'
// went to an emit that was still null and was dropped, so the orchestrator
// never knew Home was up. Events sent before the provider attaches are now
// kept and handed over in order (orchestratorEventChannel.mjs).
//
// Run: node --experimental-strip-types --test src/lib/onboarding/__tests__/orchestratorEventChannel2026_11_09.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let timerQueue = [];
let mockNow = 0;
function installPolyfills() {
  globalThis.sessionStorage = undefined;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  globalThis.performance = { now: () => mockNow };
  let seq = 0;
  globalThis.setTimeout = (cb) => { const id = ++seq; timerQueue.push({ id, cb }); return id; };
  globalThis.clearTimeout = (id) => { timerQueue = timerQueue.filter((e) => e.id !== id); };
}
function flush(times = 3) {
  for (let i = 0; i < times; i++) {
    const pending = timerQueue;
    timerQueue = [];
    for (const { cb } of pending) cb();
  }
}

let createOrchestratorEventChannel, MAX_PENDING_EVENTS, OnboardingOrchestrator;
before(async () => {
  installPolyfills();
  ({ createOrchestratorEventChannel, MAX_PENDING_EVENTS } = await import(pathToFileURL(join(__dirname, '..', 'orchestratorEventChannel.mjs')).href));
  ({ OnboardingOrchestrator } = await import(pathToFileURL(join(__dirname, '..', 'orchestrator.ts')).href));
});

test('events sent before the orchestrator attaches are handed over, in order', () => {
  const channel = createOrchestratorEventChannel();
  channel.emit({ type: 'launcher:mounted' });
  channel.emit({ type: 'foreground:change', isForeground: false });
  const got = [];
  channel.attach((e) => got.push(e.type));
  assert.deepEqual(got, ['launcher:mounted', 'foreground:change']);
  assert.equal(channel.pendingCount(), 0);
  channel.emit({ type: 'turn:done' });
  assert.deepEqual(got, ['launcher:mounted', 'foreground:change', 'turn:done'], 'then events go straight through');
});

test('after detach, events are kept again for the next attach', () => {
  const channel = createOrchestratorEventChannel();
  const first = [];
  const detach = channel.attach((e) => first.push(e.type));
  detach();
  channel.emit({ type: 'launcher:unmounted' });
  assert.deepEqual(first, []);
  const second = [];
  channel.attach((e) => second.push(e.type));
  assert.deepEqual(second, ['launcher:unmounted']);
});

test('a stale detach does not cut off a newer attach', () => {
  const channel = createOrchestratorEventChannel();
  const detachOld = channel.attach(() => {});
  const got = [];
  channel.attach((e) => got.push(e.type));
  detachOld();
  channel.emit({ type: 'turn:done' });
  assert.deepEqual(got, ['turn:done']);
});

test('a window that never attaches (the overlay) cannot grow the queue without end', () => {
  const channel = createOrchestratorEventChannel();
  for (let i = 0; i < MAX_PENDING_EVENTS + 50; i++) channel.emit({ type: 'usage:tick', deltaMs: i });
  assert.equal(channel.pendingCount(), MAX_PENDING_EVENTS);
  const got = [];
  channel.attach((e) => got.push(e.deltaMs));
  assert.equal(got[0], 50, 'the oldest go first');
});

test('the real orchestrator: a launcher:mounted sent before the provider attached still opens the first-run card', () => {
  const channel = createOrchestratorEventChannel();
  const orch = new OnboardingOrchestrator();
  orch.start([{ id: 'permissions', order: 1, triggers: { requiresHomepageMounted: true, requiresHomepageDuration: 2_000, requiresForeground: true, requiresMeetingInactive: true } }]);
  // The Launcher's effect runs first in the commit after Welcome...
  channel.emit({ type: 'launcher:mounted' });
  // ...then OrchestratorProvider's effect attaches the orchestrator.
  channel.attach(orch.emit.bind(orch));
  mockNow += 2_000;
  flush();
  assert.equal(orch.getSnapshot().activeToasterId, 'permissions');
  orch.stop();
});

test('OrchestratorProvider attaches the orchestrator to the channel (no null emit left)', () => {
  const host = fs.readFileSync(resolve(__dirname, '../../../components/onboarding/OrchestratedToasterHost.tsx'), 'utf8');
  assert.doesNotMatch(host, /emitFn/, 'the dropping null emit is gone');
  assert.match(host, /export function emitOrchestratorEvent\(e: OrchestratorEvent\): void \{\s*channel\.emit\(e\);/);
  assert.match(host, /const detach = channel\.attach\(orch\.emit\.bind\(orch\)\);/);
});
