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
// synchronous RAF would infinitely recurse. Instead we buffer callbacks and
// flush exactly one frame at a time from the test, which is enough to run one
// evaluate/dispatch pass deterministically.
let rafQueue = [];
let rafId = 0;
let mockNow = 0;

function installPolyfills() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  globalThis.requestAnimationFrame = (cb) => {
    const id = ++rafId;
    rafQueue.push({ id, cb });
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    rafQueue = rafQueue.filter((e) => e.id !== id);
  };
  globalThis.performance = { now: () => mockNow };
}

/**
 * Run exactly one buffered RAF frame. The orchestrator's scheduleTick() does
 * `tick(); scheduleTick();`, so each callback runs one evaluate/dispatch pass
 * and re-queues exactly one follow-up frame. We snapshot the currently-pending
 * callbacks and run only those — the re-scheduled follow-up stays queued for
 * the NEXT flush, preserving the self-perpetuating RAF loop (clearing it would
 * silently stop the drain loop and mask re-raise bugs).
 */
function flushOneFrame() {
  const pending = rafQueue;
  rafQueue = [];
  for (const { cb } of pending) cb();
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

before(async () => {
  installPolyfills();
  const orchMod = await loadModule(ORCH_TS);
  const stagesMod = await loadModule(STAGES_TS);
  OnboardingOrchestrator = orchMod.OnboardingOrchestrator;
  STAGES = stagesMod.STAGES;
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
  rafQueue = [];
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
