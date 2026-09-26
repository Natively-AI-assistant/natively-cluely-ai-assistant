// The orchestrator obeys the card ledger (toaster policy Phase 2,
// docs/superpowers/specs/2026-09-26-toaster-policy-design.md §3.2, §4).
//
// Runs the REAL OnboardingOrchestrator class with a fake performance clock and
// a buffered timer queue (same harness as orchestratorClass.test.mjs). Stage
// configs are minimal and carry a `card`; ledger times are relative to the
// real Date.now(), which the class uses for ledger decisions.
//
// Run: node --experimental-strip-types --test src/lib/onboarding/__tests__/orchestratorCardGates.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const D = 86_400_000;

let timerQueue = [];
let timerSeq = 0;
let mockNow = 0;

function installPolyfills() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  globalThis.performance = { now: () => mockNow };
  globalThis.setTimeout = (cb) => { const id = ++timerSeq; timerQueue.push({ id, cb }); return id; };
  globalThis.clearTimeout = (id) => { timerQueue = timerQueue.filter((e) => e.id !== id); };
}
function flush(times = 3) {
  for (let i = 0; i < times; i++) {
    const pending = timerQueue;
    timerQueue = [];
    for (const { cb } of pending) cb();
  }
}

let OnboardingOrchestrator;
let policy;
before(async () => {
  installPolyfills();
  ({ OnboardingOrchestrator } = await import(pathToFileURL(join(__dirname, '..', 'orchestrator.ts')).href));
  policy = await import(pathToFileURL(join(__dirname, '..', '..', 'cards', 'cardPolicy.mjs')).href);
});

const T = { requiresHomepageMounted: true, requiresHomepageDuration: 1_000, requiresForeground: true, requiresMeetingInactive: true };
const stage = (id, order, card) => ({ id, order, triggers: T, ...(card ? { card } : {}) });
const EXT = stage('browser_extension', 1, 'browser_extension');
const TRIAL = stage('trial_promo', 2, 'trial_promo');
const PROFILE = stage('profile_ad', 3, 'profile_ad');
const JD = stage('jd_ad', 4, 'jd_ad');
const PLAIN = stage('permissions', 0);

/** A ledger past day one with an open budget. */
const matureLedger = () => policy.emptyLedger(Date.now() - 2 * D);

function launch(stages, userState = {}) {
  localStorage.clear();
  timerQueue = [];
  mockNow = 0;
  const orch = new OnboardingOrchestrator();
  orch.start(stages);
  orch.emit({ type: 'launcher:mounted' });
  orch.emit({ type: 'foreground:change', isForeground: true });
  orch.setUserState(userState);
  mockNow += 2_000;
  flush();
  return orch;
}
const active = (orch) => orch.getSnapshot().activeToasterId;

test('no card stage shows before the ledger has loaded', () => {
  const orch = launch([EXT]);
  assert.equal(active(orch), null);
  orch.setUserState({ cardLedger: matureLedger() });
  flush();
  assert.equal(active(orch), 'browser_extension');
});

test('a stage without a card is not held back by the ledger', () => {
  assert.equal(active(launch([PLAIN])), 'permissions');
});

test('a promo waits out the first 24 hours', () => {
  assert.equal(active(launch([PROFILE], { cardLedger: policy.emptyLedger(Date.now() - 3_600_000) })), null);
  assert.equal(active(launch([PROFILE], { cardLedger: policy.emptyLedger(Date.now() - 25 * 3_600_000) })), 'profile_ad');
});

test('an onboarding card may show on day one', () => {
  assert.equal(active(launch([EXT], { cardLedger: policy.emptyLedger(Date.now() - 60_000) })), 'browser_extension');
});

test('the promo budget holds the next promo for 72 hours', () => {
  const ledger = { ...matureLedger(), lastPromoShownAt: Date.now() - D };
  assert.equal(active(launch([PROFILE], { cardLedger: ledger })), null);
});

test('one promotional card per launch', () => {
  const orch = launch([PROFILE, JD], { cardLedger: matureLedger() });
  assert.equal(active(orch), 'profile_ad');
  orch.markDismissed('profile_ad');
  mockNow += 120_000;
  flush();
  assert.equal(active(orch), null, 'the second promo waits for a later launch');
});

test('one onboarding card per launch', () => {
  const orch = launch([EXT, TRIAL], { cardLedger: matureLedger() });
  assert.equal(active(orch), 'browser_extension');
  orch.markDismissed('browser_extension');
  mockNow += 120_000;
  flush();
  assert.equal(active(orch), null);
});

test('an onboarding card and a promo can share a launch, 60 s apart', () => {
  const orch = launch([EXT, PROFILE], { cardLedger: matureLedger() });
  assert.equal(active(orch), 'browser_extension');
  orch.markDismissed('browser_extension');
  mockNow += 30_000;
  flush();
  assert.equal(active(orch), null, 'too soon after the last card closed');
  mockNow += 31_000;
  flush();
  assert.equal(active(orch), 'profile_ad');
});

test('spacing also follows a card without a ledger entry (permissions)', () => {
  const orch = launch([PLAIN, EXT], { cardLedger: matureLedger() });
  assert.equal(active(orch), 'permissions');
  orch.markDismissed('permissions');
  mockNow += 10_000;
  flush();
  assert.equal(active(orch), null);
  mockNow += 51_000;
  flush();
  assert.equal(active(orch), 'browser_extension');
});

test('nothing opens while the Trial ended card is on screen', () => {
  const orch = launch([EXT], { cardLedger: matureLedger(), trialEndedOpen: true });
  assert.equal(active(orch), null);
  orch.setUserState({ trialEndedOpen: false });
  flush();
  assert.equal(active(orch), 'browser_extension');
});

test('a strike wait keeps the card away', () => {
  const ledger = policy.applyOutcome(matureLedger(), 'browser_extension', 'later', Date.now() - D);
  assert.equal(active(launch([EXT], { cardLedger: ledger })), null);
});

test('a retired card never shows', () => {
  const ledger = policy.applyOutcome(matureLedger(), 'browser_extension', 'never', Date.now());
  assert.equal(active(launch([EXT], { cardLedger: ledger })), null);
});

// ─── Persisted skips never hide a card (final review #1) ────────
// Older builds persisted skips through skipWhen (support, the extension, the
// trial promo), and the extension's "Not now" still reports one. The card
// ledger owns every card's waits now, so a skip must not outlive the launch.
function relaunch(stages, userState = {}) {
  timerQueue = [];
  mockNow = 0;
  const orch = new OnboardingOrchestrator();
  orch.start(stages);
  orch.emit({ type: 'launcher:mounted' });
  orch.emit({ type: 'foreground:change', isForeground: true });
  orch.setUserState(userState);
  mockNow += 2_000;
  flush();
  return orch;
}

test('a card skipped in an earlier launch shows again once the ledger allows', () => {
  const first = launch([EXT], { cardLedger: matureLedger() });
  assert.equal(active(first), 'browser_extension');
  first.markSkipped('browser_extension');
  first.stop();
  assert.equal(active(relaunch([EXT], { cardLedger: matureLedger() })), 'browser_extension');
});

test('a stage without a card keeps its persisted skip', () => {
  const first = launch([PLAIN], { cardLedger: matureLedger() });
  assert.equal(active(first), 'permissions');
  first.markSkipped('permissions');
  first.stop();
  assert.equal(active(relaunch([PLAIN], { cardLedger: matureLedger() })), null);
});
