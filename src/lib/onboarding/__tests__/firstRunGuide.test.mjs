// First-run guide rules (docs/superpowers/specs/2026-11-10-first-run-guide-design.md).
// Run: node --test src/lib/onboarding/__tests__/firstRunGuide.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GUIDE_EVENT_TYPES,
  GUIDE_RESUME_MS,
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
const atPlans = () => walk(started(), 'meeting_started', 'answer_shown', 'screenshot_taken', 'note_typed', 'meeting_stopped', 'notes_next');

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

test('happy path start→answer→screenshot→notepad→stop→notes→plans', () => {
  let s = started();
  for (const [type, want] of [['meeting_started', 'answer'], ['answer_shown', 'screenshot'], ['screenshot_taken', 'notepad'],
    ['note_typed', 'stop'], ['meeting_stopped', 'notes'], ['notes_next', 'plans']]) {
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

test('meeting_stopped mid-meeting jumps to notes', () => {
  for (const at of [['meeting_started'], ['meeting_started', 'answer_shown'], ['meeting_started', 'answer_shown', 'screenshot_taken']]) {
    assert.equal(reduceGuide(walk(started(), ...at), { type: 'meeting_stopped' }, T).step, 'notes', at.join(','));
  }
  // Before any meeting started there is nothing to stop.
  const s = started();
  assert.equal(reduceGuide(s, { type: 'meeting_stopped' }, T), s);
});

test('trial_out jumps to plans with variant', () => {
  const s = reduceGuide(walk(started(), 'meeting_started', 'answer_shown'), { type: 'trial_out' }, T);
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

test('GUIDE_STEP_NUMBER: notepad and stop are both 4, keys is 7', () => {
  assert.deepEqual(GUIDE_STEP_NUMBER, { start: 1, answer: 2, screenshot: 3, notepad: 4, stop: 4, notes: 5, plans: 6, keys: 7 });
});

test('windowForStep maps every step', () => {
  assert.deepEqual(
    ['start', 'answer', 'screenshot', 'notepad', 'stop', 'notes', 'plans', 'keys'].map(windowForStep),
    ['launcher', 'overlay', 'overlay', 'notes', 'overlay', 'launcher', 'settings', 'settings'],
  );
});

test('unknown events are no-ops', () => {
  const s = started();
  assert.equal(reduceGuide(s, { type: 'bogus' }, T), s);
  assert.equal(reduceGuide(s, null, T), s);
});

test('GUIDE_EVENT_TYPES lists every event the reducer understands (main validates against it)', () => {
  assert.deepEqual([...GUIDE_EVENT_TYPES].sort(), ['answer_shown', 'keys_done', 'meeting_started', 'meeting_stopped', 'note_typed',
    'notes_next', 'own_keys', 'plan_changed', 'plans_closed', 'restart', 'screenshot_taken', 'skip', 'trial_out', 'trial_unavailable']);
});
