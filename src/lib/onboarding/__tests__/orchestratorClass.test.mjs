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
//     (permissions while macTCCBlocked === true)
//
// To avoid drift, this test loads the REAL TypeScript class rather than a
// hand-copied twin: esbuild transpiles orchestrator.ts (with its type-only
// deps) into a temp ESM module at test time. Minimal DOM globals the class
// touches (localStorage, requestAnimationFrame, performance) are polyfilled so
// it runs under plain `node --test`, matching the runner the other onboarding
// .mjs tests use.
//
// Run: node --test src/lib/onboarding/__tests__/orchestratorClass.test.mjs

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

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

// ── Load the REAL class via esbuild (no twin, no drift) ────────────────────
let OnboardingOrchestrator;
let STAGES;

async function loadModule(entryTs) {
  const result = await build({
    entryPoints: [entryTs],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    // orchestrator.ts imports './persistence.ts' and stageCatalog imports
    // orchestrator type-only — all in-tree, so a full bundle is self-contained.
  });
  const code = result.outputFiles[0].text;
  const dir = mkdtempSync(join(tmpdir(), 'orch-class-'));
  const outFile = join(dir, 'bundle.mjs');
  writeFileSync(outFile, code);
  return import(pathToFileURL(outFile).href);
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
// no meeting, macTCCBlocked=true, permsShown=false. `extensionConnected: true`
// keeps the downstream browser_extension stage from competing for the slot so
// the dismiss/re-raise assertions can check for a clean empty slot. Returns the
// instance with activeToasterId === 'permissions'.
//
// `preservePersistedState: true` models a NEXT LAUNCH — a brand-new instance
// that hydrates whatever the prior session persisted (e.g. completed
// permissions) rather than a first-ever cold install. The in-memory
// dismissedThisSession guard is still fresh (it is never persisted).
function raisePermissions({ preservePersistedState = false } = {}) {
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
    patch: { permsShown: false, macTCCBlocked: true, extensionConnected: true },
  });
  mockNow += 3_000; // > requiresHomepageDuration (2 s)

  flushOneFrame();
  return orch;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

test('drain loop raises the permissions toaster when macTCCBlocked', () => {
  const orch = raisePermissions();
  assert.equal(
    orch.getSnapshot().activeToasterId,
    'permissions',
    'permissions should be the active toaster once its triggers are met',
  );
});

test('markDismissed keeps the toaster dismissed for the rest of the session even with macTCCBlocked=true', () => {
  const orch = raisePermissions();
  assert.equal(orch.getSnapshot().activeToasterId, 'permissions');

  // Explicit X: markDismissed records the session-guard AND clears the slot.
  orch.markDismissed('permissions');
  assert.equal(
    orch.getSnapshot().activeToasterId,
    null,
    'dismiss must clear the active slot',
  );

  // Now the RAF drain loop runs again. macTCCBlocked is STILL true (permsShown
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
  // dismissedThisSession set is empty (never persisted), and macTCCBlocked is
  // still true — permissions has onceEver:false + reEligibility(macTCCBlocked),
  // so persisted completion does not suppress it. The toaster must come back.
  const second = raisePermissions({ preservePersistedState: true });
  assert.equal(
    second.getSnapshot().activeToasterId,
    'permissions',
    'a fresh session must re-raise the permissions toaster (session guard is not persisted)',
  );
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
      macTCCBlocked: false,
      extensionSupported: true,
      extensionConnected: false,
      isV2_8_OrNewer: true,
    },
  });
  mockNow += 6_000; // > browser_extension requiresHomepageDuration (5 s)
  flushOneFrame();

  assert.equal(
    orch.getSnapshot().activeToasterId,
    'browser_extension',
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
    patch: { permsShown: false, macTCCBlocked: true, extensionConnected: true },
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
