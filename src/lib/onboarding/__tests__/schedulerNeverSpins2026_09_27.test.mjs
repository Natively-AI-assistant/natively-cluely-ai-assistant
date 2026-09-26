// The scheduler never spins (toaster policy, OOM guard).
//
// The July OOM came from this class: the launcher's scheduler kept waking with
// nothing to do (first a perpetual rAF loop, then a stage that re-completed
// every drain pass — quiet_window), and Chromium's raster churn grew native
// memory by ~70 MB/s until the renderer died. The fix was a rule: arm a timer
// ONLY for a known deadline; wait for an event otherwise.
//
// The toaster policy added new waits (the card ledger, 60 s spacing, per-launch
// caps, Trial ended, forced cards). Each must appear identically in
// nextEvaluationDelayMs (which arms the timer) and shouldShowToaster (which
// decides); any mismatch arms a 0 ms timer that finds nothing to do and
// re-arms at 0 again: a spin. This fuzzes the REAL orchestrator and the REAL
// stage catalog through random launches, user states, ledgers and events, and
// fails on:
//   - a 0 ms timer that re-arms another 0 ms timer with no state change;
//   - more than one scheduler timer pending at once;
//   - the drain guard tripping (a stage re-transitioning every pass);
//   - a timer left armed while no stage can move by waiting alone.
//
// Run: node --experimental-strip-types --test src/lib/onboarding/__tests__/schedulerNeverSpins2026_09_27.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const H = 3_600_000;
const D = 24 * H;

// ── A controllable world: perf clock, wall clock, timers, storage ─────────
let perfNow = 0;
let wallOffset = 0;
const realDateNow = Date.now.bind(Date);
let timers = [];
let timerSeq = 0;
const store = new Map();
function install() {
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  globalThis.performance = { now: () => perfNow };
  Date.now = () => realDateNow() + wallOffset;
  globalThis.setTimeout = (cb, ms = 0) => { const id = ++timerSeq; timers.push({ id, cb, at: perfNow + Math.max(0, ms), ms: Math.max(0, ms) }); return id; };
  globalThis.clearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
}

let OnboardingOrchestrator, STAGES, QUIET, policy;
const errors = [];
before(async () => {
  install();
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };
  ({ OnboardingOrchestrator } = await import(pathToFileURL(join(__dirname, '..', 'orchestrator.ts')).href));
  ({ STAGES, QUIET_WINDOW_STAGE: QUIET } = await import(pathToFileURL(join(__dirname, '..', 'stageCatalog.ts')).href));
  policy = await import(pathToFileURL(join(__dirname, '..', '..', 'cards', 'cardPolicy.mjs')).href);
  console.log = () => {}; console.warn = () => {};
  void origError;
});

// ── Deterministic randomness ───────────────────────────────────────────────
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const bool = (r, p = 0.5) => r() < p;

function randomLedger(r) {
  const now = Date.now();
  let l = policy.emptyLedger(now - pick(r, [0, 2 * H, 23 * H, 25 * H, 3 * D, 40 * D]));
  l = { ...l, launchCount: Math.floor(r() * 30), lastPromoShownAt: bool(r, 0.3) ? now - pick(r, [H, 2 * D, 4 * D]) : null };
  for (const id of Object.keys(policy.CARDS)) {
    const roll = r();
    if (roll < 0.15) l = policy.applyOutcome(l, id, 'later', now - pick(r, [H, 6 * D, 8 * D, 30 * D]));
    else if (roll < 0.22) l = policy.applyOutcome(l, id, 'never', now);
    else if (roll < 0.28) l = policy.applyOutcome(l, id, 'acted', now - pick(r, [H, 8 * D]), { until: now + pick(r, [-H, 3 * D]) });
  }
  return l;
}

function randomUser(r) {
  const planTier = pick(r, ['free', 'pro', 'max', 'ultra', 'other']);
  return {
    permsShown: bool(r, 0.7), permissionsNeedAttention: bool(r, 0.15),
    hasNativelyKey: bool(r, 0.4), hasOwnAiKey: bool(r, 0.4), isPremium: planTier !== 'free' && bool(r, 0.8),
    planTier, nativelyQuotaPct: pick(r, [0, 50, 79, 80, 95]), nativelyQuotaResetsAt: Date.now() + 5 * D,
    hasProfile: bool(r), hasJD: bool(r, 0.3), trialClaimed: bool(r, 0.4), hasTrialToken: bool(r, 0.15),
    extensionSupported: bool(r, 0.9), extensionConnected: bool(r, 0.4), adsAvailable: bool(r, 0.8),
    trialEndedOpen: bool(r, 0.05), cardLedger: bool(r, 0.9) ? randomLedger(r) : null,
  };
}

// ── The spin detector ──────────────────────────────────────────────────────
// Coverage, so the fuzz cannot pass by never reaching the scheduler.
const seen = { cardsShown: 0, scenariosWithACard: 0, deadlineTimers: 0, zeroTimers: 0, trialEndedTakeovers: 0 };
function runScenario(seed) {
  const r = rng(seed);
  timers = []; perfNow = 0; wallOffset = 0;
  if (bool(r, 0.5)) store.clear(); // sometimes a fresh profile, sometimes the last run's persisted state
  const orch = new OnboardingOrchestrator();
  orch.start([...STAGES, QUIET]);
  let user = randomUser(r);
  orch.emit({ type: 'launcher:mounted' });
  orch.emit({ type: 'foreground:change', isForeground: true });
  orch.setUserState(user);
  if (bool(r, 0.05)) orch.forceCard(pick(r, ['profile_ad', 'support', 'browser_extension', 'review_prompt']));

  let zeroChain = 0;
  let shownHere = false;
  const failures = [];
  for (let step = 0; step < 120; step++) {
    const pending = timers.length;
    if (pending > 1) failures.push(`step ${step}: ${pending} timers pending (the scheduler keeps ONE)`);

    // Either an event, or let time run to the next timer.
    const roll = r();
    if (roll < 0.35 || timers.length === 0) {
      const snap = orch.getSnapshot();
      const ev = r();
      if (ev < 0.12) orch.emit({ type: 'meeting:state', isActive: bool(r) });
      else if (ev < 0.22) orch.emit({ type: 'foreground:change', isForeground: bool(r, 0.7) });
      else if (ev < 0.30) orch.emit(bool(r, 0.7) ? { type: 'launcher:mounted' } : { type: 'launcher:unmounted' });
      else if (ev < 0.40) {
        const open = bool(r, 0.3);
        if (open && snap.activeToasterId) seen.trialEndedTakeovers += 1;
        orch.setUserState({ trialEndedOpen: open });
      }
      else if (ev < 0.55 && snap.activeToasterId) {
        const id = snap.activeToasterId;
        if (policy.CARDS[id] && user.cardLedger) {
          user = { ...user, cardLedger: policy.applyOutcome(user.cardLedger, id, pick(r, ['later', 'never', 'acted']), Date.now()) };
          orch.setUserState({ cardLedger: user.cardLedger });
        }
        orch.markDismissed(id);
      } else if (ev < 0.65) {
        user = { ...user, ...randomUser(r), cardLedger: user.cardLedger ?? randomLedger(r) };
        orch.setUserState(user);
      } else if (ev < 0.72) orch.emit({ type: 'usage:tick', deltaMs: 30_000 });
      else if (ev < 0.78) orch.emit({ type: 'turn:done', surface: 'chat' });
      else { perfNow += pick(r, [1_000, 30_000, 70_000]); wallOffset += pick(r, [0, H, 2 * D]); }
      zeroChain = 0;
      continue;
    }

    timers.sort((a, b) => a.at - b.at);
    const t = timers.shift();
    perfNow = Math.max(perfNow, t.at);
    const revBefore = orch.getSnapshot().__rev;
    const activeBefore = orch.getSnapshot().activeToasterId;
    t.cb();
    const revAfter = orch.getSnapshot().__rev;
    if (t.ms > 0) seen.deadlineTimers += 1; else seen.zeroTimers += 1;
    const activeAfter = orch.getSnapshot().activeToasterId;
    if (activeAfter && activeAfter !== activeBefore) { seen.cardsShown += 1; shownHere = true; }
    const rearmed = timers.find((x) => x.ms === 0);
    if (t.ms === 0 && rearmed && revAfter === revBefore) {
      zeroChain += 1;
      if (zeroChain >= 3) {
        failures.push(`step ${step}: 0 ms timer re-armed 0 ms three times with no state change (a spin). active=${orch.getSnapshot().activeToasterId}`);
        break;
      }
    } else zeroChain = 0;
  }
  orch.stop();
  if (shownHere) seen.scenariosWithACard += 1;
  return failures;
}

test('the scheduler never spins, across 2,000 random launches and event sequences', () => {
  const all = [];
  for (let seed = 1; seed <= 2000; seed++) {
    const f = runScenario(seed);
    if (f.length) all.push(`seed ${seed}: ${f[0]}`);
    if (all.length >= 5) break;
  }
  assert.deepEqual(all, [], all.join('\n'));
  // The fuzz reached the scheduler for real: cards dispatched from timers,
  // deadline timers fired, Trial ended took an open card's slot.
  assert.ok(seen.scenariosWithACard >= 300, `only ${seen.scenariosWithACard} scenarios showed a card`);
  assert.ok(seen.deadlineTimers >= 2000, `only ${seen.deadlineTimers} deadline timers fired`);
  assert.ok(seen.trialEndedTakeovers >= 20, `only ${seen.trialEndedTakeovers} Trial ended takeovers`);
  console.info?.(`[fuzz] ${JSON.stringify(seen)}`);
});

test('the drain guard never trips (no stage re-transitions every pass)', () => {
  assert.deepEqual(errors.filter((e) => e.includes('drain exceeded')), []);
});

test('the detector itself catches a spin (a deliberately broken stage)', () => {
  // A stage whose timer computation says "ready now" but whose decision always
  // says no: exactly the mismatch the fuzz hunts for.
  timers = []; perfNow = 0; store.clear();
  const orch = new OnboardingOrchestrator();
  const broken = {
    id: 'support', order: 1, triggers: { requiresHomepageMounted: true },
    customPredicate: () => true, cooldownMs: () => -1,
  };
  orch.start([broken]);
  orch.emit({ type: 'launcher:mounted' });
  orch.emit({ type: 'foreground:change', isForeground: true });
  // Make shouldShowToaster refuse while nextEvaluationDelayMs sees nothing wrong.
  orch.shouldShowToaster = () => false;
  orch.setUserState({});
  let zeroRearms = 0;
  for (let i = 0; i < 10 && timers.length; i++) {
    const t = timers.shift();
    t.cb();
    if (t.ms === 0 && timers.some((x) => x.ms === 0)) zeroRearms += 1;
  }
  orch.stop();
  assert.ok(zeroRearms >= 3, `expected the detector to see a spin, saw ${zeroRearms}`);
});
