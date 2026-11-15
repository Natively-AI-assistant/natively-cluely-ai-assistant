// First-run guide: fixes from the final whole-branch review (2026-11-10).
// Run: node --test src/lib/onboarding/__tests__/firstRunGuideReview.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyGuideState, normalizeGuideState, reduceGuide,
  guideFactsFromSources, reconcileGuide, planStepTitle, trialEventFromLocal,
} from '../firstRunGuide.mjs';

const T = 1_000;
const facts = { hasOwnAiKey: false, hasNativelyKey: false, isPremium: false, launchCount: 1 };
const walk = (s, ...types) => types.reduce((acc, type) => reduceGuide(acc, { type }, T), s);
const started = () => reduceGuide(emptyGuideState(), { type: 'restart' }, T);
const atStop = () => walk(started(), 'meeting_started', 'overlay_next', 'answer_shown', 'screenshot_taken');
const atNotes = () => walk(atStop(), 'meeting_stopped');
const atStop2 = () => walk(atNotes(), 'notes_next', 'surface_notepad', 'meeting_started', 'note_typed', 'ask_opened', 'recipe_run');
const atNotes2 = () => walk(atStop2(), 'meeting_stopped');
const atPlans = () => walk(atNotes2(), 'notes_next');

// Critical 1: a running trial stores a placeholder Natively key; it is not a purchase.
test('the trial placeholder key is not a Natively key', () => {
  const src = { nativelyKey: '__trial__', trialSentinel: '__trial__', licensed: false, hasOwnAiKey: false };
  assert.equal(guideFactsFromSources(src).hasNativelyKey, false);
  assert.equal(guideFactsFromSources({ ...src, nativelyKey: 'nat_live_123' }).hasNativelyKey, true);
  assert.equal(guideFactsFromSources({ ...src, nativelyKey: null }).hasNativelyKey, false);
  assert.equal(guideFactsFromSources({ ...src, licensed: true }).isPremium, true);
  const s = reduceGuide(atPlans(), { type: 'plan_changed', facts: guideFactsFromSources(src) }, T);
  assert.deepEqual([s.status, s.step], ['active', 'plans'], 'a trial user stays on step 6');
});

// Important 2: step 5 opens the meeting main saved, not the newest in the list.
test('meeting_saved records the ended meeting; with none, step 5 is skipped', () => {
  const s = reduceGuide(atNotes(), { type: 'meeting_saved', meetingId: 'm-42' }, T);
  assert.deepEqual([s.step, s.endedMeetingId], ['notes', 'm-42']);
  // Saved before the launcher's meeting_stopped arrived: same result.
  const early = reduceGuide(atStop(), { type: 'meeting_saved', meetingId: 'm-42' }, T);
  assert.deepEqual([early.step, early.endedMeetingId], ['notes', 'm-42']);
  const none = reduceGuide(atNotes(), { type: 'meeting_saved', meetingId: null }, T);
  assert.equal(none.step, 'surface', 'nothing was saved, so on to the switch');
  // The notepad meeting: its own notes step, else on to Plans.
  const second = reduceGuide(atStop2(), { type: 'meeting_saved', meetingId: 'm-43' }, T);
  assert.deepEqual([second.step, second.endedMeetingId], ['notes2', 'm-43']);
  assert.equal(reduceGuide(atNotes2(), { type: 'meeting_saved', meetingId: null }, T).step, 'plans');
  const plans = atPlans();
  assert.equal(reduceGuide(plans, { type: 'meeting_saved', meetingId: 'm-9' }, T), plans, 'a later meeting does not touch the guide');
  assert.equal(started().endedMeetingId, null);
  assert.equal(emptyGuideState().endedMeetingId, null);
});

test('normalize keeps the ended meeting id and accepts states saved before it existed', () => {
  const saved = reduceGuide(atNotes(), { type: 'meeting_saved', meetingId: 'm-42' }, T);
  assert.equal(normalizeGuideState(saved, T).endedMeetingId, 'm-42');
  const { endedMeetingId, ...old } = atNotes();
  const n = normalizeGuideState(old, T);
  assert.deepEqual([n.status, n.step, n.endedMeetingId], ['active', 'notes', null]);
  assert.equal(normalizeGuideState({ ...atNotes(), endedMeetingId: 7 }, T).status, 'idle', 'garbage resets');
});

// Important 3 + 6: main knows whether a meeting runs.
test('reconcile: a guide on step 1 during a meeting moves to step 2', () => {
  const s = reconcileGuide(started(), { meetingActive: true, atLaunch: false }, T);
  assert.equal(s.step, 'overlay');
});
test('reconcile at launch: an in-meeting step with no meeting goes to the notes step', () => {
  for (const s of [walk(started(), 'meeting_started'), atStop()]) {
    assert.equal(reconcileGuide(s, { meetingActive: false, atLaunch: true }, T).step, 'notes');
  }
  assert.equal(reconcileGuide(atStop2(), { meetingActive: false, atLaunch: true }, T).step, 'notes2');
  // Step 8 during a meeting moves to the notepad, as step 1 moves to the overlay.
  const s2 = walk(atNotes(), 'notes_next', 'surface_notepad');
  assert.equal(reconcileGuide(s2, { meetingActive: true, atLaunch: false }, T).step, 'notepad');
  const mid = walk(started(), 'meeting_started');
  assert.equal(reconcileGuide(mid, { meetingActive: false, atLaunch: false }, T), mid, 'only at launch: a stop is reported by the launcher');
  assert.equal(reconcileGuide(mid, { meetingActive: true, atLaunch: true }, T), mid);
  const plans = atPlans();
  assert.equal(reconcileGuide(plans, { meetingActive: true, atLaunch: true }, T), plans);
});

// Important 4: step 6 never says more than the trial status shows.
test('step 6 title follows the real trial, and is neutral without one', () => {
  const M = 60_000;
  assert.equal(planStepTitle({ variant: 'no_trial', remainingMs: 30 * M, expired: false }), 'Your free trial isn’t available on this device.');
  assert.equal(planStepTitle({ variant: 'trial_out', remainingMs: null, expired: false }), 'Your free trial is used up.');
  assert.equal(planStepTitle({ variant: 'normal', remainingMs: 0, expired: false }), 'Your free trial is used up.');
  assert.equal(planStepTitle({ variant: 'normal', remainingMs: 5 * M, expired: true }), 'Your free trial is used up.');
  assert.equal(planStepTitle({ variant: 'normal', remainingMs: 5 * M, expired: false }), 'Your free trial is almost used up.');
  assert.equal(planStepTitle({ variant: 'normal', remainingMs: 40 * M, expired: false }), 'Keep Natively Pro after your trial.');
  assert.equal(planStepTitle({ variant: 'normal', remainingMs: null, expired: false }), 'Keep Natively Pro.');
});

// Important 5: step 1 asks main about the trial instead of reading a cache once.
test('the local trial decides step 1: expired → used up, claimed with no token → unavailable', () => {
  assert.equal(trialEventFromLocal({ hasToken: true, expired: true }), 'trial_out');
  assert.equal(trialEventFromLocal({ hasToken: false, trialClaimed: true, expired: true }), 'trial_out');
  assert.equal(trialEventFromLocal({ hasToken: false, trialClaimed: true }), 'trial_unavailable');
  assert.equal(trialEventFromLocal({ hasToken: true, trialClaimed: true }), null);
  assert.equal(trialEventFromLocal({ hasToken: false, trialClaimed: false }), null, 'a new device: the trial starts with the meeting');
  assert.equal(trialEventFromLocal(undefined), null);
});

// Live walk 2026-11-15: after Stop the guide went from step 5 (notes) straight
// to Plans before the meeting could open. Once main has recorded the saved
// meeting, a later "nothing saved" report must not throw it away.
test('meeting_saved with no id leaves a notes step that already has its meeting', () => {
  const withMeeting = reduceGuide(walk(atStop(), 'meeting_stopped'), { type: 'meeting_saved', meetingId: 'm1' }, T);
  assert.deepEqual([withMeeting.step, withMeeting.endedMeetingId], ['notes', 'm1']);
  assert.equal(reduceGuide(withMeeting, { type: 'meeting_saved', meetingId: null }, T + 1), withMeeting);
  // Nothing saved at all still moves on (to the switch, after the first meeting).
  assert.equal(reduceGuide(walk(atStop(), 'meeting_stopped'), { type: 'meeting_saved', meetingId: null }, T).step, 'surface');
});
