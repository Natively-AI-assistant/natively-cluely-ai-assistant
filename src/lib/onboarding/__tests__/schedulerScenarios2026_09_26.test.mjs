// The spec's seven scheduler scenarios, across launches (toaster policy
// Phase 3, docs/superpowers/specs/2026-09-26-toaster-policy-design.md §11).
//
// Real OnboardingOrchestrator, the real STAGES + QUIET_WINDOW_STAGE catalog, a
// fake performance clock and timer queue, and localStorage that PERSISTS
// between simulated launches. The card ledger is handled the way the host and
// main do it: 'shown' when a card becomes active, the close's outcome, and
// launchCount + 1 per launch. Days pass by ageing every ledger timestamp
// (the class reads the real Date.now() for ledger decisions), which is the
// same as the clock moving forward.
//
// Run: node --experimental-strip-types --test src/lib/onboarding/__tests__/schedulerScenarios2026_09_26.test.mjs
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const H = 3_600_000;
const D = 24 * H;

let timerQueue = [];
let mockNow = 0;
const store = new Map();

function installPolyfills() {
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

let OnboardingOrchestrator, STAGES, QUIET_WINDOW_STAGE, policy;
before(async () => {
  installPolyfills();
  ({ OnboardingOrchestrator } = await import(pathToFileURL(join(__dirname, '..', 'orchestrator.ts')).href));
  ({ STAGES, QUIET_WINDOW_STAGE } = await import(pathToFileURL(join(__dirname, '..', 'stageCatalog.ts')).href));
  policy = await import(pathToFileURL(join(__dirname, '..', '..', 'cards', 'cardPolicy.mjs')).href);
});
beforeEach(() => { store.clear(); timerQueue = []; mockNow = 0; });

/** Move every ledger timestamp back by `ms`: the same as `ms` passing. */
function age(ledger, ms) {
  const back = (t) => (typeof t === 'number' ? t - ms : t);
  const cards = {};
  for (const [id, e] of Object.entries(ledger.cards)) {
    cards[id] = { ...e, nextEligibleAt: back(e.nextEligibleAt), lastShownAt: back(e.lastShownAt), retiredUntil: back(e.retiredUntil) };
  }
  return { ...ledger, firstLaunchAt: back(ledger.firstLaunchAt), lastPromoShownAt: back(ledger.lastPromoShownAt), cards };
}

/**
 * One app launch. `user` is the launcher's user state; the returned session
 * keeps the ledger in step the way the host (shown, outcome) and main
 * (launch count) do.
 */
function launch(ledger, user = {}) {
  timerQueue = [];
  mockNow = 0;
  const s = { ledger: { ...ledger, launchCount: ledger.launchCount + 1 }, seen: [] };
  const orch = new OnboardingOrchestrator();
  s.orch = orch;
  orch.start([...STAGES, QUIET_WINDOW_STAGE]);
  orch.emit({ type: 'launcher:mounted' });
  orch.emit({ type: 'foreground:change', isForeground: true });
  orch.setUserState({ extensionSupported: true, adsAvailable: true, permsShown: true, ...user, cardLedger: s.ledger });
  s.active = () => orch.getSnapshot().activeToasterId;
  /** Advance home-screen time, recording each card that becomes active. */
  s.run = (ms) => {
    for (let t = 0; t < ms; t += 1_000) {
      mockNow += 1_000;
      flush();
      const a = s.active();
      if (a && s.seen.at(-1) !== a) {
        s.seen.push(a);
        if (policy.CARDS[a]) { s.ledger = policy.applyOutcome(s.ledger, a, 'shown', Date.now()); orch.setUserState({ cardLedger: s.ledger }); }
      }
    }
    return s;
  };
  /** Close the active card the way the host does. */
  s.close = (outcome = 'later', meta) => {
    const a = s.active();
    assert.ok(a, 'a card is open to close');
    if (policy.CARDS[a] && outcome) { s.ledger = policy.applyOutcome(s.ledger, a, outcome, Date.now(), meta); orch.setUserState({ cardLedger: s.ledger }); }
    orch.markDismissed(a);
    return s;
  };
  s.end = () => { orch.stop(); return s; };
  return s;
}

const NO_KEYS = { hasNativelyKey: false, hasOwnAiKey: false, isPremium: false, planTier: 'free' };

test('1. new user, no keys: Permissions → trial promo on day 1; the extension on a later launch; no promo before 24 h', () => {
  const first = launch(policy.emptyLedger(Date.now()), { ...NO_KEYS, permsShown: false });
  first.run(5_000);
  assert.equal(first.active(), 'permissions');
  first.close(null);
  first.run(55_000);
  assert.equal(first.active(), null, '60 s between cards');
  first.run(15_000);
  assert.equal(first.active(), 'trial_promo');
  first.close('later').run(10 * 60_000).end();
  assert.deepEqual(first.seen, ['permissions', 'trial_promo'], 'one onboarding card per launch, no promo on day 1');

  const second = launch(age(first.ledger, 2 * H), NO_KEYS).run(60_000);
  assert.deepEqual(second.seen, ['browser_extension'], 'the extension on a later launch');
  second.close('later').run(10 * 60_000);
  assert.deepEqual(second.seen, ['browser_extension'], 'the slot is free, but no promo on day 1');
  second.end();

  const third = launch(age(second.ledger, 23 * H), NO_KEYS).run(2 * 60_000);
  assert.deepEqual(third.seen, ['profile_ad'], 'the first promo once 24 h have passed');
  third.end();
});

test('2. own keys on day 4: "Three services" shows; the next promo waits 72 h', () => {
  const user = { hasOwnAiKey: true, extensionConnected: true };
  const first = launch(age(policy.emptyLedger(Date.now()), 4 * D), user).run(2 * 60_000);
  assert.deepEqual(first.seen, ['natively_api_existing']);
  first.close('later').end();

  const nextDay = launch(age(first.ledger, 1 * D), user).run(5 * 60_000);
  assert.deepEqual(nextDay.seen, [], 'inside the 72 h budget');
  nextDay.end();

  const later = launch(age(nextDay.ledger, 2 * D + H), user).run(2 * 60_000);
  assert.deepEqual(later.seen, ['profile_ad'], 'budget open again; "Three services" waits out its strike');
  later.end();
});

test('3. three "later"s: back after 7 and 21 days, then never', () => {
  const user = { hasNativelyKey: true };
  let s = launch(policy.emptyLedger(Date.now()), user).run(60_000);
  assert.deepEqual(s.seen, ['browser_extension']);
  s.close('later').end();
  // Other cards (promos, from day 2) are not this scenario: follow the extension only.
  const back = (ledger, days) => launch(age(ledger, days * D), user).run(60_000);
  const ext = (sess) => sess.seen.filter((id) => id === 'browser_extension');
  const closeExt = (sess) => { if (sess.active() === 'browser_extension') sess.close('later'); return sess; };

  s = back(s.ledger, 6); assert.deepEqual(ext(s), [], 'not before 7 days'); s.end();
  s = back(s.ledger, 1); assert.deepEqual(ext(s), ['browser_extension'], 'back after 7 days'); closeExt(s).end();
  s = back(s.ledger, 20); assert.deepEqual(ext(s), [], 'not before 21 days'); s.end();
  s = back(s.ledger, 1); assert.deepEqual(ext(s), ['browser_extension'], 'back after 21 days'); closeExt(s).end();
  s = back(s.ledger, 400); assert.deepEqual(ext(s), [], 'the third strike retired it'); s.end();
  assert.equal(policy.entryOf(s.ledger, 'browser_extension').retired, true);
});

test('4. a crash while a card is open costs no strike; the card can return', () => {
  const user = { hasNativelyKey: true };
  const crashed = launch(policy.emptyLedger(Date.now()), user).run(60_000);
  assert.equal(crashed.active(), 'browser_extension');
  // The process dies here: no outcome, and the persisted state still names the open card.
  assert.equal(policy.entryOf(crashed.ledger, 'browser_extension').strikes, 0);
  const next = launch(age(crashed.ledger, H), user).run(60_000);
  assert.deepEqual(next.seen, ['browser_extension'], 'interrupted: it may show again');
  next.end();
});

test('5. a meeting: nothing new opens, and an open card stays', () => {
  const user = { hasNativelyKey: true };
  const s = launch(policy.emptyLedger(Date.now()), user);
  s.orch.emit({ type: 'meeting:state', isActive: true });
  s.run(2 * 60_000);
  assert.deepEqual(s.seen, [], 'nothing opens during a meeting');
  s.orch.emit({ type: 'meeting:state', isActive: false });
  s.run(60_000);
  assert.equal(s.active(), 'browser_extension');
  s.orch.emit({ type: 'meeting:state', isActive: true });
  s.run(10_000);
  assert.equal(s.active(), 'browser_extension', 'a meeting starting does not close an open card');
  s.end();
});

test('6. Trial ended: nothing else opens, and an open card leaves the slot', () => {
  const user = { hasNativelyKey: true };
  const s = launch(policy.emptyLedger(Date.now()), { ...user, trialEndedOpen: true }).run(2 * 60_000);
  assert.deepEqual(s.seen, []);
  s.orch.setUserState({ trialEndedOpen: false });
  s.run(60_000);
  assert.equal(s.active(), 'browser_extension');
  s.orch.setUserState({ trialEndedOpen: true });
  assert.equal(s.active(), null, 'Trial ended takes the slot');
  assert.equal(policy.entryOf(s.ledger, 'browser_extension').strikes, 0, 'interrupted, no strike');
  s.end();
});

test('7. Pro at 80 %: Max/Ultra shows; "I\'m happy with Pro" retires it for good', () => {
  const user = { isPremium: true, planTier: 'pro', hasNativelyKey: true, nativelyQuotaPct: 85, extensionConnected: true, hasProfile: true, hasJD: true };
  const s = launch(age(policy.emptyLedger(Date.now()), 4 * D), user).run(2 * 60_000);
  assert.deepEqual(s.seen, ['max_ultra']);
  s.close('never').end();
  const much = launch(age(s.ledger, 400 * D), { ...user, nativelyQuotaPct: 99 }).run(2 * 60_000);
  assert.ok(!much.seen.includes('max_ultra'), 'never again, whatever the quota');
  much.end();
});
