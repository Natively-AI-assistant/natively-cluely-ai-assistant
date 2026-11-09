// L4 + L7 + L3 (2026-11-09): one full-window card per launch, kept across a
// launcher reload, shared with the update card.
//
// - L4: "one per launch" used to be counted per class, and the permissions card
//   had no class, so a launch could show three dimmed full-window cards. Now
//   one in total; on the Welcome launch the permissions card may be followed by
//   one more. A meeting that fails for a missing permission still gets the card.
// - L7: the per-launch record and the session dismissals lived in renderer
//   memory, so a launcher renderer that crashed and was reloaded could show
//   another card in the same app run. They live in sessionStorage now.
// - L3: the update card takes the same slot (claimExternalCard): refused while
//   a card is open, and no card opens while it holds the slot.
//
// Run: node --experimental-strip-types --test src/lib/onboarding/__tests__/launchCardLimit2026_11_09.test.mjs
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const D = 86_400_000;

let timerQueue = [];
let mockNow = 0;
const local = new Map();
const session = new Map();
const storage = (m) => ({
  getItem: (k) => (m.has(k) ? m.get(k) : null),
  setItem: (k, v) => m.set(k, String(v)),
  removeItem: (k) => m.delete(k),
  clear: () => m.clear(),
});
function installPolyfills() {
  globalThis.localStorage = storage(local);
  globalThis.sessionStorage = storage(session);
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

let OnboardingOrchestrator, policy, launchSession;
before(async () => {
  installPolyfills();
  ({ OnboardingOrchestrator } = await import(pathToFileURL(join(__dirname, '..', 'orchestrator.ts')).href));
  policy = await import(pathToFileURL(join(__dirname, '..', '..', 'cards', 'cardPolicy.mjs')).href);
  launchSession = await import(pathToFileURL(join(__dirname, '..', 'launchSession.mjs')).href);
});
beforeEach(() => { local.clear(); session.clear(); timerQueue = []; mockNow = 0; });

const T = { requiresHomepageMounted: true, requiresHomepageDuration: 1_000, requiresForeground: true, requiresMeetingInactive: true };
// The catalog's permissions rules (stageCatalog.ts), with this test's clock.
const PERMS = {
  id: 'permissions', order: 1, triggers: T,
  skipWhen: (s) => s.permsShown && !s.permissionsNeedAttention,
  reEligibility: (s) => s.permissionsNeedAttention,
  reopensWhenReEligible: true,
  bypassesLaunchCap: (s) => s.permissionsRecoveryRequested,
};
const EXT = { id: 'browser_extension', order: 2, triggers: T, card: 'browser_extension' };
const PROFILE = { id: 'profile_ad', order: 3, triggers: T, card: 'profile_ad' };
const ledger = () => policy.emptyLedger(Date.now() - 4 * D);

/** One renderer: a new orchestrator over the same storage (a reload keeps sessionStorage). */
function boot(stages, user = {}) {
  timerQueue = [];
  mockNow = 0;
  const orch = new OnboardingOrchestrator();
  orch.start(stages);
  orch.emit({ type: 'launcher:mounted' });
  orch.emit({ type: 'foreground:change', isForeground: true });
  orch.setUserState({ cardLedger: ledger(), ...user });
  mockNow += 2_000;
  flush();
  return orch;
}
const active = (o) => o.getSnapshot().activeToasterId;
const wait = (o, ms) => { mockNow += ms; flush(); return active(o); };

// ── The pure rule ─────────────────────────────────────────────────────────
test('launchCapAllows: one card, or permissions and one more on the Welcome launch', () => {
  const { launchCapAllows } = launchSession;
  assert.equal(launchCapAllows({ shown: [], dismissed: [], welcome: false }, 'plans'), true);
  assert.equal(launchCapAllows({ shown: ['plans'], dismissed: [], welcome: false }, 'profile_ad'), false);
  assert.equal(launchCapAllows({ shown: ['permissions'], dismissed: [], welcome: false }, 'plans'), false);
  assert.equal(launchCapAllows({ shown: ['permissions'], dismissed: [], welcome: true }, 'plans'), true);
  assert.equal(launchCapAllows({ shown: ['permissions'], dismissed: [], welcome: true }, 'permissions'), false);
  assert.equal(launchCapAllows({ shown: ['permissions', 'plans'], dismissed: [], welcome: true }, 'demo_video'), false);
  assert.equal(launchCapAllows({ shown: ['plans'], dismissed: [], welcome: true }, 'demo_video'), false, 'the exception follows permissions only');
});

test('the launch record survives a bad or missing store', () => {
  const { loadLaunchSession, saveLaunchSession, LAUNCH_SESSION_KEY } = launchSession;
  assert.deepEqual(loadLaunchSession(null), { shown: [], dismissed: [], welcome: false });
  assert.deepEqual(loadLaunchSession({ getItem: () => { throw new Error('denied'); } }), { shown: [], dismissed: [], welcome: false });
  assert.deepEqual(loadLaunchSession({ getItem: () => '{not json' }), { shown: [], dismissed: [], welcome: false });
  assert.doesNotThrow(() => saveLaunchSession({ setItem: () => { throw new Error('quota'); } }, { shown: [], dismissed: [], welcome: false }));
  const m = new Map();
  saveLaunchSession(storage(m), { shown: ['plans', 7], dismissed: ['plans'], welcome: true });
  assert.deepEqual(loadLaunchSession(storage(m)), { shown: ['plans'], dismissed: ['plans'], welcome: true });
  assert.ok(m.has(LAUNCH_SESSION_KEY));
});

// ── L4 in the orchestrator ────────────────────────────────────────────────
test('the permissions card spends the launch: no onboarding card or promo after it', () => {
  const orch = boot([PERMS, EXT, PROFILE], { permissionsNeedAttention: true, permsShown: true });
  assert.equal(active(orch), 'permissions');
  orch.markDismissed('permissions');
  assert.equal(wait(orch, 30 * 60_000), null);
  orch.stop();
});

test('on the Welcome launch: permissions, then one more, then nothing', () => {
  const orch = boot([PERMS, EXT, PROFILE], { welcomeThisLaunch: true });
  assert.equal(active(orch), 'permissions');
  orch.markDismissed('permissions');
  assert.equal(wait(orch, 61_000), 'browser_extension');
  orch.markDismissed('browser_extension');
  assert.equal(wait(orch, 30 * 60_000), null);
  orch.stop();
});

test('a meeting that failed for a missing permission still opens the card after the launch\'s card', () => {
  const orch = boot([EXT, PERMS], { permsShown: true });
  assert.equal(active(orch), 'browser_extension');
  orch.markDismissed('browser_extension');
  orch.setUserState({ permissionsNeedAttention: true, permissionsRecoveryRequested: true });
  assert.equal(wait(orch, 61_000), 'permissions');
  orch.stop();
});

// ── L7: a reload keeps the launch ─────────────────────────────────────────
test('a launcher reload in the same app run shows no second card', () => {
  const first = boot([EXT, PROFILE]);
  assert.equal(active(first), 'browser_extension');
  first.stop(); // the renderer crashes with the card open, and is reloaded
  const reloaded = boot([EXT, PROFILE]);
  assert.equal(wait(reloaded, 30 * 60_000), null, 'the launch already had its card');
  reloaded.stop();
});

test('a dismissal survives the reload too, and a new app run starts afresh', () => {
  const first = boot([PERMS], { permissionsNeedAttention: true, permsShown: true });
  assert.equal(active(first), 'permissions');
  first.markDismissed('permissions');
  first.stop();
  const reloaded = boot([PERMS], { permissionsNeedAttention: true, permsShown: true });
  assert.equal(wait(reloaded, 5 * 60_000), null, 'closed this launch: not raised again');
  reloaded.stop();
  session.clear(); // the app quit
  const nextRun = boot([PERMS], { permissionsNeedAttention: true, permsShown: true });
  assert.equal(active(nextRun), 'permissions');
  nextRun.stop();
});

test('the Welcome launch is remembered across the reload', () => {
  const first = boot([PERMS, EXT], { welcomeThisLaunch: true });
  assert.equal(active(first), 'permissions');
  first.markDismissed('permissions');
  first.stop();
  const reloaded = boot([PERMS, EXT], { permsShown: true });
  assert.equal(wait(reloaded, 61_000), 'browser_extension');
  reloaded.stop();
});

test('with no sessionStorage at all the orchestrator still runs from memory', () => {
  const saved = globalThis.sessionStorage;
  globalThis.sessionStorage = undefined;
  try {
    const orch = boot([EXT]);
    assert.equal(active(orch), 'browser_extension');
    orch.stop();
  } finally {
    globalThis.sessionStorage = saved;
  }
});

// ── L3: the update card shares the slot ───────────────────────────────────
test('the update card is refused while a card is open, and holds the slot once granted', () => {
  const orch = boot([EXT]);
  assert.equal(active(orch), 'browser_extension');
  assert.equal(orch.claimExternalCard('update'), false, 'waits for the open card');
  orch.markDismissed('browser_extension');
  assert.equal(orch.claimExternalCard('update'), false, 'not straight after a card closes');
  mockNow += 59_000;
  assert.equal(orch.claimExternalCard('update'), false, 'still inside the 60 s spacing');
  mockNow += 2_000;
  assert.equal(orch.claimExternalCard('update'), true);
  assert.equal(orch.getExternalCard(), 'update');
  orch.stop();
});

// Review fixes (2026-11-09 b): the update card does not count against one
// card per launch, never opens by itself on the Welcome launch, and a toast
// expand takes the slot past the spacing but never over an open card.
test('no card opens while the update card holds the slot; it does not spend the launch\'s card', () => {
  const orch = boot([EXT], { cardLedger: null });
  assert.equal(orch.claimExternalCard('update'), true, 'nothing open yet');
  orch.setUserState({ cardLedger: ledger() });
  assert.equal(wait(orch, 5 * 60_000), null, 'nothing opens over it');
  orch.releaseExternalCard('update');
  assert.equal(wait(orch, 30_000), null, 'the usual spacing after it closes');
  assert.equal(wait(orch, 31_000), 'browser_extension', 'the launch still has its one card');
  orch.stop();
});

test('first run: an update arriving under Welcome does not take the slot from permissions and Plans', () => {
  // App pushes welcomeThisLaunch while Welcome is up; when it closes, the
  // UpdateBanner effect runs before OrchestratorProvider attaches the
  // Launcher's launcher:mounted, so the update claim comes first.
  timerQueue = [];
  mockNow = 0;
  const orch = new OnboardingOrchestrator();
  orch.start([PERMS, EXT]);
  orch.setUserState({ cardLedger: ledger(), welcomeThisLaunch: true });
  assert.equal(orch.claimExternalCard('update'), false, 'no update card by itself on the Welcome launch');
  orch.emit({ type: 'launcher:mounted' });
  orch.emit({ type: 'foreground:change', isForeground: true });
  assert.equal(wait(orch, 2_000), 'permissions');
  orch.markDismissed('permissions');
  assert.equal(wait(orch, 61_000), 'browser_extension', 'and the one card after it');
  orch.markDismissed('browser_extension');
  mockNow += 61_000;
  assert.equal(orch.claimExternalCard('update'), false, 'still not by itself, all launch long');
  orch.stop();
});

test('on the Welcome launch a user expand still opens the update card', () => {
  const orch = boot([EXT], { cardLedger: null, welcomeThisLaunch: true });
  assert.equal(orch.claimExternalCard('update', { force: true }), true);
  assert.equal(orch.getExternalCard(), 'update');
  orch.stop();
});

test('a user expand takes the slot inside the spacing, holds it, and its release sets the spacing', () => {
  const orch = boot([EXT, PROFILE]);
  assert.equal(active(orch), 'browser_extension');
  orch.markDismissed('browser_extension');
  mockNow += 5_000;
  assert.equal(orch.claimExternalCard('update'), false, 'not by itself inside the spacing');
  assert.equal(orch.claimExternalCard('update', { force: true }), true, 'the user asked for it');
  assert.equal(orch.getExternalCard(), 'update', 'the slot is really held');
  orch.releaseExternalCard('update');
  assert.equal(orch.getExternalCard(), null);
  orch.stop();
});

test('a user expand never stacks the update card over an open card', () => {
  const orch = boot([EXT]);
  assert.equal(active(orch), 'browser_extension');
  assert.equal(orch.claimExternalCard('update', { force: true }), false);
  orch.stop();
});

test('a meeting that fails for a missing permission reopens a card closed earlier this launch', () => {
  const orch = boot([PERMS], { permissionsNeedAttention: true, permsShown: true });
  assert.equal(active(orch), 'permissions');
  orch.markDismissed('permissions');
  assert.equal(wait(orch, 61_000), null, 'closed: not raised again by itself');
  orch.setUserState({ permissionsRecoveryRequested: true });
  assert.equal(wait(orch, 61_000), 'permissions', 'the failed meeting brings it back');
  orch.markDismissed('permissions');
  assert.equal(wait(orch, 61_000), null);
  orch.setUserState({ permissionsRecoveryRequested: true });
  assert.equal(wait(orch, 61_000), 'permissions', 'and again for the next failed meeting');
  orch.stop();
});

test('the update card is refused while Trial ended is on screen', () => {
  const orch = boot([EXT], { cardLedger: null, trialEndedOpen: true });
  assert.equal(orch.claimExternalCard('update'), false);
  orch.stop();
});

// ── Wiring (App.tsx needs a DOM and the Electron bridge) ──────────────────
const app = fs.readFileSync(resolve(__dirname, '../../../App.tsx'), 'utf8');

test('App.tsx tells the orchestrator about the Welcome launch and the failed-meeting recovery', () => {
  assert.match(app, /if \(showWelcome && \(isLauncherWindow \|\| isDefault\)\) setOrchestratorUserState\(\{ welcomeThisLaunch: true \}\);/);
  const recoveries = app.match(/setOrchestratorUserState\(\{ permissionsNeedAttention: true, permissionsRecoveryRequested: true \}\)/g) ?? [];
  assert.equal(recoveries.length, 2, 'both mic-permission-denied paths');
});

test('the permissions stage may pass the launch limit only for that recovery', async () => {
  const { STAGES } = await import(pathToFileURL(join(__dirname, '..', 'stageCatalog.ts')).href);
  const perms = STAGES.find((s) => s.id === 'permissions');
  assert.equal(perms.bypassesLaunchCap({ permissionsRecoveryRequested: true }), true);
  assert.equal(perms.bypassesLaunchCap({ permissionsRecoveryRequested: false }), false);
  assert.ok(STAGES.filter((s) => s.id !== 'permissions').every((s) => !s.bypassesLaunchCap), 'no other stage passes it');
});
