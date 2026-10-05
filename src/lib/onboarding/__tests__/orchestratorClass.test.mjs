// src/lib/onboarding/__tests__/orchestratorClass.test.mjs
//
// CLASS-LEVEL tests for the OnboardingOrchestrator (orchestrator.ts).
//
// The sibling orchestrator.test.mjs exercises only the *pure* decision
// predicate (orchestrator.mjs's `shouldShowToaster` free function). It cannot
// cover the class-only machinery that fixed the "X button does nothing" +
// "re-prompts forever" TCC bugs:
//   - the RAF drain loop (evaluateAndDispatch)
//   - markDismissed() → dismissedThisSession session-guard
//   - the interaction of that guard with a still-true reEligibility predicate
//     (permissions while permissionsNeedAttention === true)
//
// To avoid drift, this test loads the REAL TypeScript class rather than a
// hand-copied twin: Node imports orchestrator.ts directly under
// --experimental-strip-types (which `npm run test:lib` already passes), so the
// class under test is the shipped source, not a transpiled copy. Minimal DOM
// globals the class touches (localStorage, requestAnimationFrame, performance)
// are polyfilled so it runs under plain `node --test`, matching the runner the
// other onboarding .mjs tests use.
//
// This used to bundle through esbuild at test time, which made the suite depend
// on esbuild's platform-specific optional binary. That is a Windows-only
// landmine: `npm ci` succeeds, every other step passes, and then all 9 tests die
// in the before() hook with `The package "@esbuild/win32-x64" could not be
// found` — a hookFailed, not an assertion, so the failure text says nothing
// about onboarding. Type stripping needs no native binary and no temp file.
//
// Run: node --test src/lib/onboarding/__tests__/orchestratorClass.test.mjs

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ORCH_TS = join(__dirname, '..', 'orchestrator.ts');
const STAGES_TS = join(__dirname, '..', 'stageCatalog.ts');

// ── DOM polyfills the orchestrator class touches ───────────────────────────
// A manual RAF queue: scheduleTick() recurses (tick → scheduleTick), so a
// synchronous timer would infinitely recurse. Instead we buffer callbacks and
// flush exactly one tick at a time from the test, which is enough to run one
// evaluate/dispatch pass deterministically.
//
// NATIVE-LEAK FIX (2026-07-10): the drain loop is now a self-terminating
// setTimeout, NOT a per-frame requestAnimationFrame (the perpetual rAF was the
// native memory leak — see orchestrator.ts scheduleTick note). A rAF polyfill
// is intentionally NOT installed: if the class ever regresses to
// requestAnimationFrame it throws ("requestAnimationFrame is not defined"),
// which is the regression guard we want.
let timerQueue = [];
let timerSeq = 0;
let mockNow = 0;

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

function installPolyfills() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  globalThis.performance = { now: () => mockNow };
  // Deliberately NO requestAnimationFrame — the orchestrator must never use it
  // again (the perpetual rAF loop was the leak). Manual setTimeout queue so the
  // mock clock drives the drain cadence deterministically.
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
  globalThis.setTimeout = (cb, _ms) => {
    const id = ++timerSeq;
    timerQueue.push({ id, cb });
    return id;
  };
  globalThis.clearTimeout = (id) => {
    timerQueue = timerQueue.filter((e) => e.id !== id);
  };
}

// eslint-disable-next-line no-unused-vars
function restoreTimers() {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
}

/**
 * Run exactly one buffered drain tick. The orchestrator's tick() runs one
 * evaluate/dispatch pass and then calls ensureDraining(), which re-arms exactly
 * one follow-up timer IFF there is still unresolved work. We snapshot the
 * currently-pending callbacks and run only those — a re-armed follow-up stays
 * queued for the NEXT flush. When the queue drains fully, ensureDraining stops
 * scheduling, timerQueue goes empty, and flushOneFrame becomes a no-op: that
 * self-termination is the leak fix (the loop no longer runs forever).
 */
function flushOneFrame() {
  const pending = timerQueue;
  timerQueue = [];
  for (const { cb } of pending) cb();
}

/** True once the drain loop has stopped re-scheduling itself. */
function drainIsIdle() {
  return timerQueue.length === 0;
}

// ── Load the REAL class (no twin, no drift, no bundler) ────────────────────
let OnboardingOrchestrator;
let STAGES;

// orchestrator.ts imports './persistence.ts' with an explicit .ts extension and
// stageCatalog imports orchestrator type-only — both are exactly what Node's
// type stripping resolves natively, so no bundling step is required.
// pathToFileURL, not a bare path: on Windows an absolute path like
// `D:\...\orchestrator.ts` is not a valid ESM specifier and import() rejects it
// with ERR_UNSUPPORTED_ESM_URL_SCHEME.
function loadModule(entryTs) {
  return import(pathToFileURL(entryTs).href);
}

let ALL_STAGES; // [...STAGES, QUIET_WINDOW_STAGE] — matches App.tsx's start() call

before(async () => {
  installPolyfills();
  const orchMod = await loadModule(ORCH_TS);
  const stagesMod = await loadModule(STAGES_TS);
  OnboardingOrchestrator = orchMod.OnboardingOrchestrator;
  STAGES = stagesMod.STAGES;
  // Production starts the orchestrator with the quiet_window stage appended
  // (App.tsx: orch.start([...STAGES, QUIET_WINDOW_STAGE])). quiet_window is
  // inserted into the queue when trial_promo completes, so its config must be
  // registered or that id would sit unresolved in the queue. Include it here so
  // the drain-termination guard reflects real startup.
  ALL_STAGES = stagesMod.QUIET_WINDOW_STAGE
    ? [...STAGES, stagesMod.QUIET_WINDOW_STAGE]
    : STAGES;
  assert.ok(OnboardingOrchestrator, 'OnboardingOrchestrator export loaded');
  assert.ok(Array.isArray(STAGES) && STAGES.length > 0, 'STAGES catalog loaded');
});

// Bring an orchestrator to the exact point where `permissions` is the only
// eligible, actively-shown toaster: homepage mounted long enough, foreground,
// no meeting, permissionsNeedAttention=true, permsShown=false. `extensionConnected: true`
// keeps the downstream browser_extension stage from competing for the slot so
// the dismiss/re-raise assertions can check for a clean empty slot. Returns the
// instance with activeToasterId === 'permissions'.
//
// `preservePersistedState: true` models a NEXT LAUNCH — a brand-new instance
// that hydrates whatever the prior session persisted (e.g. completed
// permissions) rather than a first-ever cold install. The in-memory
// dismissedThisSession guard is still fresh (it is never persisted).
function raisePermissions({ preservePersistedState = false, permsShown = false, permissionsNeedAttention = true } = {}) {
  if (!preservePersistedState) localStorage.clear();
  timerQueue = [];
  mockNow = 0;

  const orch = new OnboardingOrchestrator();
  orch.start(STAGES);

  // Mount the homepage, then advance the mock clock past the 2 s duration
  // trigger so `homepageMountedFor` satisfies the permissions stage.
  orch.emit({ type: 'launcher:mounted' });
  orch.emit({ type: 'foreground:change', isForeground: true });
  orch.emit({
    type: 'user-state:change',
    patch: { permsShown, permissionsNeedAttention, extensionConnected: true },
  });
  mockNow += 3_000; // > requiresHomepageDuration (2 s)

  flushOneFrame();
  return orch;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

test('drain loop raises the permissions toaster when a permission needs attention', () => {
  const orch = raisePermissions();
  assert.equal(
    orch.getSnapshot().activeToasterId,
    'permissions',
    'permissions should be the active toaster once its triggers are met',
  );
});

test('markDismissed keeps the toaster dismissed for the rest of the session even with permissionsNeedAttention=true', () => {
  const orch = raisePermissions();
  assert.equal(orch.getSnapshot().activeToasterId, 'permissions');

  // Explicit X: markDismissed records the session-guard AND clears the slot.
  orch.markDismissed('permissions');
  assert.equal(
    orch.getSnapshot().activeToasterId,
    null,
    'dismiss must clear the active slot',
  );

  // Now the RAF drain loop runs again. permissionsNeedAttention is STILL true (permsShown
  // was never set), so reEligibility(permissions) is true — pre-fix this
  // re-raised the toaster on the very next frame, making the X do nothing.
  // The dismissedThisSession guard must suppress it. (The single slot may be
  // filled by a legitimately-eligible DOWNSTREAM stage — that is not a wedge;
  // the invariant under test is specifically that `permissions` is not
  // re-raised.)
  mockNow += 3_000;
  flushOneFrame();
  flushOneFrame(); // a second frame for good measure — permissions must stay down
  assert.notEqual(
    orch.getSnapshot().activeToasterId,
    'permissions',
    'permissions must NOT be re-raised within the same session after an explicit dismiss',
  );
});

test('a fresh session (new orchestrator) DOES re-raise permissions after a prior-session dismiss', () => {
  // Session 1: dismiss it and confirm the guard holds for the rest of the session.
  const first = raisePermissions();
  first.markDismissed('permissions');
  mockNow += 3_000;
  flushOneFrame();
  assert.notEqual(
    first.getSnapshot().activeToasterId,
    'permissions',
    'permissions stays down for the rest of session 1',
  );

  // Session 2: a brand-new instance that HYDRATES the prior session's persisted
  // state (completed permissions from the session-1 dismiss). Its
  // dismissedThisSession set is empty (never persisted), and permissionsNeedAttention is
  // still true — permissions has onceEver:false + reEligibility(permissionsNeedAttention),
  // so persisted completion does not suppress it. The toaster must come back.
  const second = raisePermissions({ preservePersistedState: true });
  assert.equal(
    second.getSnapshot().activeToasterId,
    'permissions',
    'a fresh session must re-raise the permissions toaster (session guard is not persisted)',
  );
});

// Returning users (2026-09-25 rule): once the card has been seen, it stays
// quiet on every later launch unless a required permission needs attention.
test('a returning user with every permission fine does NOT see the card', () => {
  const orch = raisePermissions({ permsShown: true, permissionsNeedAttention: false });
  assert.notEqual(
    orch.getSnapshot().activeToasterId,
    'permissions',
    'permissions must stay quiet after it has been seen and nothing needs attention',
  );
});

test('a returning user whose permission broke DOES see the card again', () => {
  const orch = raisePermissions({ permsShown: true, permissionsNeedAttention: true });
  assert.equal(
    orch.getSnapshot().activeToasterId,
    'permissions',
    'a broken required permission must bring the card back',
  );
});

// The real returning-user sequence across launches, with persisted state:
// launch 1 shows and dismisses the card; launch 2 has nothing wrong, so the
// stage auto-skips (and that skip is persisted); launch 3 finds a permission
// broken. The card must come back on launch 3.
test('a permission that breaks after a quiet launch brings the card back', () => {
  const first = raisePermissions({ permsShown: false, permissionsNeedAttention: false });
  assert.equal(first.getSnapshot().activeToasterId, 'permissions', 'launch 1 shows the card');
  first.markDismissed('permissions');

  const quiet = raisePermissions({ preservePersistedState: true, permsShown: true, permissionsNeedAttention: false });
  assert.notEqual(quiet.getSnapshot().activeToasterId, 'permissions', 'launch 2 is quiet');

  const broken = raisePermissions({ preservePersistedState: true, permsShown: true, permissionsNeedAttention: true });
  assert.equal(broken.getSnapshot().activeToasterId, 'permissions', 'launch 3 must show the card again');
});

// Same sequence for a long-time user whose OTHER stages are all finished, so
// nothing else keeps the drain loop scheduling. Launch 2 auto-skips the stage
// and persists that skip; launch 3's broken permission must still be picked
// up by the scheduler rather than waiting for an unrelated stage's timer.
test('a broken permission brings the card back even when no other stage is pending', () => {
  const permsOnly = STAGES.filter((s) => s.id === 'permissions');
  const launch = ({ fresh, permsShown, permissionsNeedAttention }) => {
    if (fresh) localStorage.clear();
    timerQueue = [];
    mockNow = 0;
    const orch = new OnboardingOrchestrator();
    orch.start(permsOnly);
    orch.emit({ type: 'launcher:mounted' });
    orch.emit({ type: 'foreground:change', isForeground: true });
    orch.emit({ type: 'user-state:change', patch: { permsShown, permissionsNeedAttention } });
    mockNow += 3_000;
    flushOneFrame();
    return orch;
  };

  const first = launch({ fresh: true, permsShown: false, permissionsNeedAttention: false });
  assert.equal(first.getSnapshot().activeToasterId, 'permissions', 'launch 1 shows the card');
  first.markDismissed('permissions');

  const quiet = launch({ fresh: false, permsShown: true, permissionsNeedAttention: false });
  assert.equal(quiet.getSnapshot().activeToasterId, null, 'launch 2 is quiet');

  const broken = launch({ fresh: false, permsShown: true, permissionsNeedAttention: true });
  assert.equal(broken.getSnapshot().activeToasterId, 'permissions', 'launch 3 must show the card again');
});

// App.tsx starts the orchestrator after an async import and pushes the
// permission result after an async IPC call, so the push can land FIRST.
test('a broken permission pushed before start() still brings the card back', () => {
  const permsOnly = STAGES.filter((s) => s.id === 'permissions');
  const launch = ({ fresh, permsShown, permissionsNeedAttention }) => {
    if (fresh) localStorage.clear();
    timerQueue = [];
    mockNow = 0;
    const orch = new OnboardingOrchestrator();
    orch.setUserState({ permsShown, permissionsNeedAttention }); // before start()
    orch.start(permsOnly);
    orch.emit({ type: 'launcher:mounted' });
    orch.emit({ type: 'foreground:change', isForeground: true });
    mockNow += 3_000;
    flushOneFrame();
    return orch;
  };

  const first = launch({ fresh: true, permsShown: false, permissionsNeedAttention: false });
  assert.equal(first.getSnapshot().activeToasterId, 'permissions', 'launch 1 shows the card');
  first.markDismissed('permissions');
  const quiet = launch({ fresh: false, permsShown: true, permissionsNeedAttention: false });
  assert.equal(quiet.getSnapshot().activeToasterId, null, 'launch 2 is quiet');
  const broken = launch({ fresh: false, permsShown: true, permissionsNeedAttention: true });
  assert.equal(broken.getSnapshot().activeToasterId, 'permissions', 'launch 3 must show the card again');
});

// The un-skip is for the permissions card only. trial_promo also declares a
// reEligibility rule; a skipped trial promo must not be re-armed just because
// a key or trial flag flips mid-session. Under the toaster policy a card's
// skip no longer persists (the card ledger owns its waits), so the guarantee
// is "not again this launch".
test('a skipped trial promo is not re-armed this launch when its reEligibility flips', async () => {
  const { emptyLedger } = await loadModule(join(__dirname, '..', '..', 'cards', 'cardPolicy.mjs'));
  localStorage.clear();
  timerQueue = [];
  mockNow = 0;
  const trial = { ...STAGES.find((s) => s.id === 'trial_promo'), requiresStages: undefined };
  const orch = new OnboardingOrchestrator();
  orch.start([trial]);
  orch.emit({ type: 'launcher:mounted' });
  orch.emit({ type: 'foreground:change', isForeground: true });
  orch.setUserState({ cardLedger: emptyLedger(Date.now()) });
  mockNow += 10_000;
  for (let i = 0; i < 5; i++) flushOneFrame();
  assert.equal(orch.getSnapshot().activeToasterId, 'trial_promo', 'precondition: the promo shows');
  orch.markSkipped('trial_promo');
  orch.setUserState({ hasNativelyKey: true });
  orch.setUserState({ hasNativelyKey: false });
  mockNow += 120_000;
  for (let i = 0; i < 5; i++) flushOneFrame();
  assert.equal(orch.getSnapshot().activeToasterId, null, 'trial_promo must not come back this launch');
});

// A persisted queue from an older build must follow the current catalog:
// stages added since (the ad stages) have to reach existing users, and
// stages removed since must not linger.
test('start() rebuilds a stale persisted queue from the catalog', () => {
  localStorage.clear();
  timerQueue = [];
  mockNow = 0;
  const first = new OnboardingOrchestrator();
  first.start(STAGES);
  const key = 'natively_onboarding_state_v1';
  const saved = JSON.parse(localStorage.getItem(key));
  saved.queue = ['permissions', 'legacy_stage_from_an_old_build'];
  localStorage.setItem(key, JSON.stringify(saved));

  const next = new OnboardingOrchestrator();
  next.start(STAGES);

  const catalogOrder = [...STAGES].sort((a, b) => a.order - b.order).map((s) => s.id);
  assert.deepEqual(next.getSnapshot().queue, catalogOrder);
});

test('dismissing permissions does NOT wedge other toaster stages', () => {
  const orch = raisePermissions();
  orch.markDismissed('permissions');

  // Make the permissions stage genuinely resolved so it never competes again,
  // and unblock the next stage. browser_extension requires permissions to be
  // completed/skipped (it is — markDismissed → completeToaster set it), is
  // supported, not connected, and needs 5 s of homepage time.
  orch.emit({
    type: 'user-state:change',
    patch: {
      permsShown: true,
      permissionsNeedAttention: false,
      extensionSupported: true,
      extensionConnected: false,
      isV2_8_OrNewer: true,
      // browser_extension is a card stage: it needs the card ledger loaded.
      cardLedger: { version: 1, firstLaunchAt: Date.now() - 2 * 86_400_000, launchCount: 1, lastPromoShownAt: null, imported: {}, cards: {} },
    },
  });
  // > browser_extension requiresHomepageDuration (5 s) AND the 60 s spacing
  // after the previous card closed (toaster policy §3.2, CARD_SPACING_MS).
  mockNow += 61_000;
  flushOneFrame();
  flushOneFrame();

  // The next onboarding card for a user with no keys is the free-trial promo
  // (toaster policy §3.3: permissions → trial promo → extension).
  assert.equal(
    orch.getSnapshot().activeToasterId,
    'trial_promo',
    'the next stage must still be reachable — the session guard is per-stage, not global',
  );
});

// ─── NATIVE-LEAK REGRESSION GUARDS (2026-07-10) ─────────────────────────────
// These lock in the fix for the perpetual-requestAnimationFrame native memory
// leak (introduced by cf6a2f9, bisected to the 2026-07-04 window). The drain
// loop MUST self-terminate when there is no pending work, and MUST NOT run on
// requestAnimationFrame — otherwise the renderer's compositor never idles and,
// under software compositing, leaks native raster tiles until OOM.

test('LEAK GUARD: the drain loop uses setTimeout, never requestAnimationFrame', () => {
  // requestAnimationFrame is intentionally undefined in installPolyfills(). If
  // the class regressed to a rAF loop, start()/tick() would throw here.
  assert.equal(
    typeof globalThis.requestAnimationFrame,
    'undefined',
    'test harness must NOT provide requestAnimationFrame (regression guard)',
  );
  const orch = raisePermissions(); // exercises start() + several ticks
  assert.equal(orch.getSnapshot().activeToasterId, 'permissions');
  // Reaching here without a "requestAnimationFrame is not defined" throw proves
  // the drain loop is timer-based.
});

test('LEAK GUARD: the deadline scheduler STOPS scheduling once every stage is resolved', () => {
  localStorage.clear();
  timerQueue = [];
  mockNow = 0;

  const orch = new OnboardingOrchestrator();
  orch.start(ALL_STAGES);
  orch.emit({ type: 'launcher:mounted' });
  orch.emit({ type: 'foreground:change', isForeground: true });

  // Resolve EVERY stage: mark them all completed so nothing can ever fire. This
  // is the fully-drained terminal state — the loop must stop re-arming itself.
  for (const stage of ALL_STAGES) {
    orch.markSkipped(stage.id);
  }

  // Drain any pending ticks. After the queue is fully resolved, ensureDraining()
  // must not re-schedule, so the timer queue settles to empty within a couple of
  // flushes (not spin forever like the old per-frame rAF).
  let guard = 0;
  while (!drainIsIdle() && guard < 10) {
    flushOneFrame();
    guard += 1;
  }
  assert.ok(
    drainIsIdle(),
    `drain loop must self-terminate when fully drained (still pending after ${guard} flushes)`,
  );

  // And it must NOT wake back up on its own — advancing the clock without any
  // new event leaves it idle (the old loop would have re-fired every frame).
  mockNow += 60_000;
  assert.ok(drainIsIdle(), 'drain loop must stay idle with no new events');
});

test('LEAK GUARD: an event re-arms the deadline scheduler after it went idle', () => {
  localStorage.clear();
  timerQueue = [];
  mockNow = 0;

  const orch = new OnboardingOrchestrator();
  orch.start(STAGES);
  // Not foreground yet → there is no time deadline that can be acted on, so
  // the scheduler must stay idle until an eligibility event arrives.
  let guard = 0;
  while (!drainIsIdle() && guard < 5) { flushOneFrame(); guard += 1; }

  // Now deliver foreground + mount + duration so permissions becomes eligible.
  // notify() must schedule one evaluation pass without recreating a poll loop.
  orch.emit({ type: 'launcher:mounted' });
  orch.emit({ type: 'foreground:change', isForeground: true });
  orch.emit({
    type: 'user-state:change',
    patch: { permsShown: false, permissionsNeedAttention: true, extensionConnected: true },
  });
  mockNow += 3_000;

  // The events called ensureDraining via notify(); flushing must now raise it.
  guard = 0;
  let raised = false;
  while (guard < 5) {
    flushOneFrame();
    if (orch.getSnapshot().activeToasterId === 'permissions') { raised = true; break; }
    guard += 1;
  }
  assert.ok(raised, 'a state-change event must re-arm the loop and let a newly-eligible stage fire');
});

test('LEAK GUARD: event-gated stages do not leave a polling timer armed', () => {
  localStorage.clear();
  timerQueue = [];
  mockNow = 0;

  const orch = new OnboardingOrchestrator();
  orch.start([{
    id: 'permissions',
    order: 1,
    triggers: { requiresHomepageMounted: true, requiresForeground: true, requiresTurnCount: 1 },
  }]);
  orch.emit({ type: 'launcher:mounted' });
  orch.emit({ type: 'foreground:change', isForeground: true });

  assert.ok(
    drainIsIdle(),
    'a stage blocked only on a future event must not wake the renderer on a polling timer',
  );

  orch.emit({ type: 'turn:done' });
  assert.equal(timerQueue.length, 1, 'the qualifying event must schedule exactly one evaluation');
  flushOneFrame();
  assert.equal(orch.getSnapshot().activeToasterId, 'permissions');
  assert.ok(drainIsIdle(), 'an active toaster must not keep a scheduler timer alive');
});

test('deadline scheduler re-evaluates completed cooldown stages in an otherwise idle queue', () => {
  localStorage.clear();
  timerQueue = [];
  mockNow = 0;

  const orch = new OnboardingOrchestrator();
  const state = orch._getState();
  state.completed.permissions = Date.now();
  state.lastShownTimes.permissions = Date.now() - 1_000;
  state.queue = ['permissions'];
  orch._setStateForTests(state);
  orch.start([{
    id: 'permissions',
    order: 1,
    triggers: { requiresHomepageMounted: true, requiresForeground: true },
    cooldownMs: () => 1_000,
  }]);
  orch.emit({ type: 'launcher:mounted' });
  orch.emit({ type: 'foreground:change', isForeground: true });

  assert.equal(
    timerQueue.length,
    1,
    'a completed non-onceEver stage with an elapsed cooldown must schedule an evaluation',
  );
  flushOneFrame();
  assert.equal(
    orch.getSnapshot().activeToasterId,
    'permissions',
    'the elapsed-cooldown stage must dispatch without waiting for an unrelated event',
  );
});

// App.tsx learns permsShown from localStorage at once, but the permission check
// is an IPC call that can take seconds on macOS (the Screen Recording probe
// races a 5 s deadline). The card fires 2 s after the launcher mounts, so
// permsShown has to arrive before the check does, and the check's answer on
// its own must still be able to bring the card back (2026-10-01).
function launchWithSlowCheck() {
  localStorage.clear();
  timerQueue = [];
  mockNow = 0;
  const orch = new OnboardingOrchestrator();
  orch.start(STAGES);
  // What App.tsx knows without waiting: the card has been seen before.
  orch.setUserState({ permsShown: true, extensionConnected: true });
  orch.emit({ type: 'launcher:mounted' });
  orch.emit({ type: 'foreground:change', isForeground: true });
  mockNow += 3_000; // past the 2 s trigger, the check still out
  flushOneFrame();
  return orch;
}

test('a slow permission check does not open the card for a returning user', () => {
  const orch = launchWithSlowCheck();
  assert.notEqual(orch.getSnapshot().activeToasterId, 'permissions', 'nothing is known to be wrong yet');

  orch.setUserState({ permissionsNeedAttention: false }); // the check lands: all granted
  flushOneFrame();
  assert.notEqual(orch.getSnapshot().activeToasterId, 'permissions');
});

test('a slow permission check that finds a broken permission still opens the card', () => {
  const orch = launchWithSlowCheck();
  assert.notEqual(orch.getSnapshot().activeToasterId, 'permissions');

  orch.setUserState({ permissionsNeedAttention: true }); // the check lands: something is missing
  flushOneFrame();
  assert.equal(orch.getSnapshot().activeToasterId, 'permissions');
});
