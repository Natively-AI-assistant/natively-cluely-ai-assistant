// First-run guide rules (docs/superpowers/specs/2026-11-10-first-run-guide-design.md).
// Run: node --test src/lib/onboarding/__tests__/firstRunGuide.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startCoverage,
  GUIDE_EVENT_TYPES,
  GUIDE_RESUME_MS,
  GUIDE_STEP_COUNT,
  GUIDE_STEP_NUMBER,
  emptyGuideState,
  normalizeGuideState,
  isGuideEligible,
  reduceGuide,
  windowForStep,
} from '../firstRunGuide.mjs';

const facts = { hasOwnAiKey: false, hasNativelyKey: false, isPremium: false, launchCount: 1 };
const T = 1_000;
const started = () => reduceGuide(emptyGuideState(), { type: 'plans_closed', facts }, T);
const walk = (s, ...types) => types.reduce((acc, type) => reduceGuide(acc, { type }, T), s);
// Evin, 2026-11-15: two meetings. The first in the overlay and its notes; then
// Settings › Overlay to pick the notepad; the second in the notepad (type, Ask,
// a recipe) and its notes; then Plans & Billing and keys.
const MEETING_1 = ['meeting_started', 'overlay_next', 'answer_shown', 'screenshot_taken', 'meeting_stopped', 'notes_next'];
const MEETING_2 = ['surface_notepad', 'meeting_started', 'note_typed', 'ask_opened', 'recipe_run', 'meeting_stopped', 'notes_next'];
const atPlans = () => walk(started(), ...MEETING_1, ...MEETING_2);

test('plans_closed starts an eligible new user at start', () => {
  const s = started();
  assert.deepEqual([s.status, s.step, s.startedAt, s.updatedAt, s.variant], ['active', 'start', T, T, 'normal']);
});

test('not eligible: own AI key, or launch 4', () => {
  assert.equal(isGuideEligible(facts), true);
  assert.equal(reduceGuide(emptyGuideState(), { type: 'plans_closed', facts: { ...facts, hasOwnAiKey: true } }, T).status, 'idle');
  assert.equal(reduceGuide(emptyGuideState(), { type: 'plans_closed', facts: { ...facts, launchCount: 4 } }, T).status, 'idle');
  assert.equal(isGuideEligible({ ...facts, launchCount: 3 }), true);
});

test('a Natively key bought from the Plans card still gets the guide', () => {
  assert.equal(reduceGuide(emptyGuideState(), { type: 'plans_closed', facts: { ...facts, hasNativelyKey: true, isPremium: true } }, T).status, 'active');
});

test('happy path: the overlay meeting, its notes, the switch, the notepad meeting, its notes, plans', () => {
  let s = started();
  for (const [type, want] of [['meeting_started', 'overlay'], ['overlay_next', 'answer'], ['answer_shown', 'screenshot'], ['screenshot_taken', 'stop'],
    ['meeting_stopped', 'notes'], ['notes_next', 'surface'], ['surface_notepad', 'start2'], ['meeting_started', 'notepad'],
    ['note_typed', 'ask'], ['ask_opened', 'recipe'], ['recipe_run', 'stop2'], ['meeting_stopped', 'notes2'], ['notes_next', 'plans']]) {
    s = reduceGuide(s, { type }, T + 5);
    assert.equal(s.step, want, type);
    assert.equal(s.updatedAt, T + 5);
  }
});

test('duplicate events are no-ops (same object back)', () => {
  const s = walk(started(), 'meeting_started');
  assert.equal(reduceGuide(s, { type: 'meeting_started' }, T + 1), s);
  assert.equal(reduceGuide(s, { type: 'note_typed' }, T + 1), s);
  assert.equal(reduceGuide(s, { type: 'plans_closed', facts }, T + 1), s);
});

test('meeting_stopped mid-meeting jumps to that meeting\'s notes', () => {
  for (const at of [['meeting_started'], ['meeting_started', 'overlay_next'], ['meeting_started', 'overlay_next', 'answer_shown'], ['meeting_started', 'overlay_next', 'answer_shown', 'screenshot_taken']]) {
    assert.equal(reduceGuide(walk(started(), ...at), { type: 'meeting_stopped' }, T).step, 'notes', at.join(','));
  }
  const second = walk(started(), ...MEETING_1, 'surface_notepad', 'meeting_started');
  for (const at of [[], ['note_typed'], ['note_typed', 'ask_opened'], ['note_typed', 'ask_opened', 'recipe_run']]) {
    assert.equal(reduceGuide(walk(second, ...at), { type: 'meeting_stopped' }, T).step, 'notes2', at.join(','));
  }
  // Between the meetings there is nothing to stop.
  const between = walk(started(), ...MEETING_1);
  assert.equal(reduceGuide(between, { type: 'meeting_stopped' }, T), between);
  // Before any meeting started there is nothing to stop.
  const s = started();
  assert.equal(reduceGuide(s, { type: 'meeting_stopped' }, T), s);
});

test('trial_out jumps to plans with variant', () => {
  const s = reduceGuide(walk(started(), 'meeting_started', 'overlay_next', 'answer_shown'), { type: 'trial_out' }, T);
  assert.deepEqual([s.step, s.variant, s.status], ['plans', 'trial_out', 'active']);
  // At plans or later it changes nothing.
  const p = atPlans();
  assert.equal(reduceGuide(p, { type: 'trial_out' }, T), p);
});

test('trial_unavailable at start → plans, variant no_trial', () => {
  const s = reduceGuide(started(), { type: 'trial_unavailable' }, T);
  assert.deepEqual([s.step, s.variant], ['plans', 'no_trial']);
});

test('plan_changed at plans: Natively key → finished bought; premium without key → keys; else unchanged', () => {
  const p = atPlans();
  const bought = reduceGuide(p, { type: 'plan_changed', facts: { ...facts, hasNativelyKey: true, isPremium: true } }, T);
  assert.deepEqual([bought.status, bought.outcome], ['finished', 'bought']);
  const yearly = reduceGuide(p, { type: 'plan_changed', facts: { ...facts, isPremium: true } }, T);
  assert.deepEqual([yearly.status, yearly.step], ['active', 'keys']);
  assert.equal(reduceGuide(p, { type: 'plan_changed', facts }, T), p);
});

test('plan_changed before plans changes nothing', () => {
  const s = walk(started(), 'meeting_started');
  assert.equal(reduceGuide(s, { type: 'plan_changed', facts: { ...facts, hasNativelyKey: true } }, T), s);
});

test('own_keys → keys; keys_done → finished own_keys', () => {
  const k = reduceGuide(atPlans(), { type: 'own_keys' }, T);
  assert.equal(k.step, 'keys');
  const done = reduceGuide(k, { type: 'keys_done' }, T);
  assert.deepEqual([done.status, done.outcome], ['finished', 'own_keys']);
  // keys_done anywhere else does nothing
  const s = started();
  assert.equal(reduceGuide(s, { type: 'keys_done' }, T), s);
});

test('skip from any active step → skipped; plans_closed after skip stays skipped', () => {
  for (const s of [started(), walk(started(), 'meeting_started'), atPlans()]) {
    const sk = reduceGuide(s, { type: 'skip' }, T);
    assert.equal(sk.status, 'skipped');
    assert.equal(reduceGuide(sk, { type: 'plans_closed', facts }, T).status, 'skipped');
  }
  const idle = emptyGuideState();
  assert.equal(reduceGuide(idle, { type: 'skip' }, T), idle);
});

test('restart from skipped/finished/expired → active start, variant normal, outcome null', () => {
  const skipped = reduceGuide(reduceGuide(started(), { type: 'trial_out' }, T), { type: 'skip' }, T);
  const finished = reduceGuide(reduceGuide(atPlans(), { type: 'own_keys' }, T), { type: 'keys_done' }, T);
  const expired = { ...started(), status: 'expired' };
  for (const s of [skipped, finished, expired, emptyGuideState()]) {
    const r = reduceGuide(s, { type: 'restart' }, T + 9);
    assert.deepEqual([r.status, r.step, r.variant, r.outcome, r.startedAt], ['active', 'start', 'normal', null, T + 9]);
  }
});

test('normalize: >7 days since update → expired; ≤7 days → unchanged; garbage → empty', () => {
  const s = walk(started(), 'meeting_started');
  assert.equal(normalizeGuideState(s, T + GUIDE_RESUME_MS + 1).status, 'expired');
  assert.deepEqual(normalizeGuideState(s, T + GUIDE_RESUME_MS), s);
  assert.deepEqual(normalizeGuideState(undefined, T), emptyGuideState());
  assert.deepEqual(normalizeGuideState({ status: 'nope', step: 7 }, T), emptyGuideState());
  assert.deepEqual(normalizeGuideState({ ...s, step: 'bogus' }, T), emptyGuideState());
  // Finished/skipped never expire.
  const sk = reduceGuide(s, { type: 'skip' }, T);
  assert.equal(normalizeGuideState(sk, T + GUIDE_RESUME_MS * 10).status, 'skipped');
  assert.equal(GUIDE_RESUME_MS, 7 * 24 * 60 * 60 * 1000);
});

// Evin, 2026-11-15: the meeting overlay and the notepad are separate steps.
test('GUIDE_STEP_NUMBER: 14 steps; plans and own keys share the last', () => {
  assert.deepEqual(GUIDE_STEP_NUMBER, {
    start: 1, overlay: 2, answer: 3, screenshot: 4, stop: 5, notes: 6, surface: 7,
    start2: 8, notepad: 9, ask: 10, recipe: 11, stop2: 12, notes2: 13, plans: 14, keys: 14,
  });
  assert.equal(GUIDE_STEP_COUNT, 14);
});

test('windowForStep maps every step', () => {
  assert.deepEqual(
    ['start', 'overlay', 'answer', 'screenshot', 'stop', 'notes', 'surface', 'start2', 'notepad', 'ask', 'recipe', 'stop2', 'notes2', 'plans', 'keys'].map(windowForStep),
    ['launcher', 'overlay', 'overlay', 'overlay', 'overlay', 'launcher', 'settings', 'launcher', 'notes', 'notes', 'notes', 'notes', 'launcher', 'settings', 'settings'],
  );
});

test('the switch moves on only from its own step, and only to the notepad', () => {
  const at = walk(started(), ...MEETING_1);
  assert.equal(at.step, 'surface');
  assert.equal(reduceGuide(at, { type: 'surface_notepad' }, T).step, 'start2');
  const early = started();
  assert.equal(reduceGuide(early, { type: 'surface_notepad' }, T), early);
});

test('unknown events are no-ops', () => {
  const s = started();
  assert.equal(reduceGuide(s, { type: 'bogus' }, T), s);
  assert.equal(reduceGuide(s, null, T), s);
});

test('GUIDE_EVENT_TYPES lists every event the reducer understands (main validates against it)', () => {
  // surface_notepad and meeting_saved are main's own: a window may not claim them.
  assert.deepEqual([...GUIDE_EVENT_TYPES].sort(), ['answer_shown', 'ask_opened', 'keys_done', 'meeting_started', 'meeting_stopped', 'note_typed',
    'notes_next', 'overlay_next', 'own_keys', 'plan_changed', 'plans_closed', 'recipe_run', 'restart', 'screenshot_taken', 'skip', 'trial_out', 'trial_unavailable']);
});

// Evin, 2026-11-15, on a Natively API profile whose free trial was used long
// ago: "all the steps are showing done so i cant really go through the steps".
// Step 1 learned "no trial" and jumped to Plans, where the paid key finished
// the guide. A paid plan covers the meeting, so no trial is not a reason to move.
test('a paid Natively key keeps the walk: no trial is not a reason to jump to plans', () => {
  const paid = { hasOwnAiKey: false, hasNativelyKey: true, isPremium: true, launchCount: 1 };
  const s = started();
  assert.equal(reduceGuide(s, { type: 'trial_unavailable', facts: paid }, T), s);
  assert.equal(reduceGuide(s, { type: 'trial_out', facts: paid }, T), s);
  const unpaid = { hasOwnAiKey: false, hasNativelyKey: false, isPremium: false, launchCount: 1 };
  assert.deepEqual(
    [reduceGuide(s, { type: 'trial_unavailable', facts: unpaid }, T).step, reduceGuide(s, { type: 'trial_out', facts: unpaid }, T).step],
    ['plans', 'plans'],
  );
});

// Step 1 never promises a trial to someone it does not cover: a paid
// Natively key whose trial is over reads "Your plan covers it".
test('step 1 says what covers the meeting: the running trial, else a paid key', () => {
  assert.equal(startCoverage({ trial: { hasToken: true, expired: false }, hasNativelyKey: true }), 'trial');
  assert.equal(startCoverage({ trial: { hasToken: true, expired: true }, hasNativelyKey: true }), 'plan');
  assert.equal(startCoverage({ trial: { hasToken: false, trialClaimed: true }, hasNativelyKey: true }), 'plan');
  assert.equal(startCoverage({ trial: { hasToken: false }, hasNativelyKey: false }), 'trial');
  assert.equal(startCoverage({ trial: null, hasNativelyKey: false }), 'trial');
});
