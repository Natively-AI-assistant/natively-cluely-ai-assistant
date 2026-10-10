// One onboarding card per launch, and `order` decides which: the Natively API
// offer (for someone with no AI whose trial is used) comes before the browser
// extension. That only holds if neither can become ready before the other.
// The extension used to wait 5 s on Home against 6 s for the offers above it,
// so it showed first and spent the launch's slot; on 2026-10-08 that kept the
// trial card from 92% of new installs. The trial is no longer a card (it starts
// by itself with a meeting, src/lib/trial/autoTrial.mjs), and the same race
// would now starve the API offer, so the equal wait stays pinned here.
//
// Real orchestrator, real catalog, and timers that fire only when due:
// schedulerScenarios2026_09_26 flushes every pending timer at once and cannot
// see a one-second race.
//
// This is shared renderer scheduling with no platform branch; macOS and
// Windows feed it the same inputs (src/App.tsx).
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { OnboardingOrchestrator } from '../orchestrator.ts';
import { STAGES, QUIET_WINDOW_STAGE } from '../stageCatalog.ts';
import { emptyLedger, applyOutcome } from '../../cards/cardPolicy.mjs';

const epoch = 1_800_000_000_000;
const store = new Map();
let now = 0;
let sequence = 0;
let timers = new Map();
const originals = new Map();
const originalDateNow = Date.now;

before(() => {
  for (const key of ['localStorage', 'performance', 'setTimeout', 'clearTimeout']) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  } });
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
  globalThis.setTimeout = (callback, delay = 0) => {
    const id = ++sequence;
    timers.set(id, { callback, due: now + delay });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  Date.now = () => epoch + now;
});

beforeEach(() => {
  store.clear();
  timers.clear();
  now = 0;
});

after(() => {
  Date.now = originalDateNow;
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

// Execute at each requested deadline, not at the end of a coarse time jump.
function advance(ms) {
  const target = now + ms;
  let callbacks = 0;
  while (true) {
    const next = [...timers.entries()]
      .filter(([, timer]) => timer.due <= target)
      .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
    if (!next) break;
    assert.ok(++callbacks < 1_000, 'scheduler must not spin on a zero-delay deadline');
    const [id, timer] = next;
    timers.delete(id);
    now = timer.due;
    timer.callback();
  }
  now = target;
}

function launch(t, user = {}) {
  const orchestrator = new OnboardingOrchestrator();
  t.after(() => orchestrator.stop());
  orchestrator.setUserState({
    permsShown: true,
    extensionSupported: true,
    extensionConnected: false,
    adsAvailable: true,
    cardLedger: emptyLedger(Date.now()),
    ...user,
  });
  orchestrator.start([...STAGES, QUIET_WINDOW_STAGE]);
  orchestrator.emit({ type: 'launcher:mounted' });
  orchestrator.emit({ type: 'foreground:change', isForeground: true });
  return orchestrator;
}

const active = (orchestrator) => orchestrator.getSnapshot().activeToasterId;
// No AI of their own, and the free trial behind them: the API offer's audience.
const TRIAL_USED = { trialClaimed: true };

test('trial used: the API offer wins before the extension can spend the launch slot', (t) => {
  const orchestrator = launch(t, TRIAL_USED);
  advance(5_000);
  assert.equal(active(orchestrator), null, 'the extension must not be ready a second early');
  advance(999);
  assert.equal(active(orchestrator), null);
  advance(1);
  assert.equal(active(orchestrator), 'natively_api_new');
});

test('the old trial card turned down for good counts as trial used', (t) => {
  const orchestrator = launch(t, { cardLedger: applyOutcome(emptyLedger(epoch), 'trial_promo', 'never', epoch) });
  advance(6_000);
  assert.equal(active(orchestrator), 'natively_api_new');
});

test('a put-off API offer does not allow an extension card in the same launch', (t) => {
  const orchestrator = launch(t, TRIAL_USED);
  advance(6_000);
  assert.equal(active(orchestrator), 'natively_api_new');
  orchestrator.setUserState({ cardLedger: applyOutcome(emptyLedger(epoch), 'natively_api_new', 'later', Date.now()) });
  orchestrator.markDismissed('natively_api_new');
  advance(120_000);
  assert.equal(active(orchestrator), null);
});

test('Home remount resets readiness without letting the extension get ahead', (t) => {
  const orchestrator = launch(t, TRIAL_USED);
  advance(4_000);
  orchestrator.emit({ type: 'launcher:unmounted' });
  advance(10_000);
  assert.equal(active(orchestrator), null);
  orchestrator.emit({ type: 'launcher:mounted' });
  advance(5_999);
  assert.equal(active(orchestrator), null);
  advance(1);
  assert.equal(active(orchestrator), 'natively_api_new');
});

test('ledger loaded at five seconds cannot let the extension get ahead', (t) => {
  const orchestrator = launch(t, { ...TRIAL_USED, cardLedger: null });
  advance(5_000);
  assert.equal(active(orchestrator), null);
  orchestrator.setUserState({ cardLedger: emptyLedger(epoch) });
  advance(0);
  assert.equal(active(orchestrator), null);
  advance(1_000);
  assert.equal(active(orchestrator), 'natively_api_new');
});

test('ledger loaded after both deadlines still chooses the API offer', (t) => {
  const orchestrator = launch(t, { ...TRIAL_USED, cardLedger: null });
  advance(10_000);
  assert.equal(active(orchestrator), null);
  orchestrator.setUserState({ cardLedger: emptyLedger(epoch) });
  advance(0);
  assert.equal(active(orchestrator), 'natively_api_new');
});

// Everyone the API offer is not for still gets the extension, at the same six seconds.
for (const [who, user] of [
  ['no keys, the trial still ahead of them', {}],
  ['a trial running', { hasTrialToken: true, trialClaimed: true }],
  ['own AI key', { hasOwnAiKey: true }],
  ['Natively key', { hasNativelyKey: true }],
  ['Premium', { isPremium: true }],
  ['trial used, but no API offer in this build', { ...TRIAL_USED, adsAvailable: false }],
  ['the API offer put off', { ...TRIAL_USED, cardLedger: applyOutcome(emptyLedger(epoch), 'natively_api_new', 'later', epoch) }],
]) {
  test(`${who}: the extension card, at six seconds`, (t) => {
    const orchestrator = launch(t, user);
    advance(5_999);
    assert.equal(active(orchestrator), null);
    advance(1);
    assert.equal(active(orchestrator), 'browser_extension');
  });
}

test('no trial card is ever shown, however long a no-keys user stays on Home', (t) => {
  const orchestrator = launch(t);
  const seen = new Set();
  for (let i = 0; i < 600; i++) { advance(1_000); const a = active(orchestrator); if (a) seen.add(a); }
  assert.deepEqual([...seen], ['browser_extension']);
});

test('a meeting suppresses ready offers until it ends', (t) => {
  const orchestrator = launch(t, TRIAL_USED);
  advance(4_000);
  orchestrator.emit({ type: 'meeting:state', isActive: true });
  advance(60_000);
  assert.equal(active(orchestrator), null);
  orchestrator.emit({ type: 'meeting:state', isActive: false });
  advance(0);
  assert.equal(active(orchestrator), 'natively_api_new');
});

test('background time does not advance Home readiness', (t) => {
  const orchestrator = launch(t, TRIAL_USED);
  advance(4_000);
  orchestrator.emit({ type: 'foreground:change', isForeground: false });
  advance(60_000);
  assert.equal(active(orchestrator), null);
  orchestrator.emit({ type: 'foreground:change', isForeground: true });
  advance(1_999);
  assert.equal(active(orchestrator), null);
  advance(1);
  assert.equal(active(orchestrator), 'natively_api_new');
});

test('permissions completion still requires the full 60-second spacing', (t) => {
  const orchestrator = launch(t, { ...TRIAL_USED, permsShown: false });
  advance(2_000);
  assert.equal(active(orchestrator), 'permissions');
  advance(3_000);
  orchestrator.setUserState({ permsShown: true });
  orchestrator.markDismissed('permissions');
  advance(59_999);
  assert.equal(active(orchestrator), null);
  advance(1);
  assert.equal(active(orchestrator), 'natively_api_new');
});
