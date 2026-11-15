// The whole guide as a graph (Evin, 2026-11-15: "check the workflow is correct
// and leads to all the steps"). Every event a window or main can send, from a
// fresh guide: each of the 15 steps must be reachable, and from every reachable
// state the guide must still be able to finish without skipping. So no step is
// orphaned and none is a dead end in the rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE_EVENT_TYPES, GUIDE_STEP_NUMBER, reconcileGuide, reduceGuide } from '../firstRunGuide.mjs';

const NOW = 1_800_000_000_000;
const FACTS = { hasOwnAiKey: false, hasNativelyKey: false, isPremium: false, launchCount: 1 };
const EVENTS = [
  ...GUIDE_EVENT_TYPES.filter((t) => !['skip', 'restart', 'plans_closed', 'trial_out', 'trial_unavailable', 'plan_changed'].includes(t)).map((type) => ({ type })),
  { type: 'trial_out', facts: FACTS },
  { type: 'trial_unavailable', facts: FACTS },
  { type: 'plan_changed', facts: { ...FACTS, hasNativelyKey: true } },
  { type: 'plan_changed', facts: { ...FACTS, isPremium: true } },
  { type: 'meeting_started', surface: 'overlay' },
  { type: 'meeting_started', surface: 'notepad' },
  { type: 'trial_out', facts: { ...FACTS, hasOwnAiKey: true } },
  // main's own
  { type: 'meeting_saved', meetingId: 'm-1', meetingActive: true },
  { type: 'meeting_saved', meetingId: 'm-1' },
  { type: 'meeting_saved', meetingId: null },
  { type: 'surface_notepad' },
];
const key = (s) => `${s.status}/${s.step}/${s.variant}/${s.endedMeetingId ? 'id' : '-'}`;
const next = (s) => {
  const out = EVENTS.map((e) => reduceGuide(s, e, NOW));
  // main's reconcile, at launch and on restart, with and without a meeting
  for (const meetingActive of [true, false]) for (const atLaunch of [true, false]) for (const surface of [undefined, 'overlay', 'notepad']) out.push(reconcileGuide(s, { meetingActive, atLaunch, surface }, NOW));
  return out;
};

function explore() {
  const start = reduceGuide({ status: 'idle', step: 'start', variant: 'normal', outcome: null, startedAt: null, updatedAt: null, endedMeetingId: null }, { type: 'restart' }, NOW);
  const seen = new Map([[key(start), start]]);
  const edges = new Map();
  const queue = [start];
  while (queue.length) {
    const s = queue.shift();
    const to = new Set();
    for (const n of next(s)) {
      to.add(key(n));
      if (!seen.has(key(n))) { seen.set(key(n), n); queue.push(n); }
    }
    edges.set(key(s), to);
  }
  return { seen, edges };
}

test('every step of the guide is reachable from a fresh start', () => {
  const { seen } = explore();
  const reached = new Set([...seen.values()].filter((s) => s.status === 'active').map((s) => s.step));
  for (const step of Object.keys(GUIDE_STEP_NUMBER)) assert.ok(reached.has(step), `${step} is reachable`);
});

test('from every reachable state the guide can still finish, without skipping', () => {
  const { seen, edges } = explore();
  // Reverse search from the finished states.
  const canFinish = new Set([...seen.keys()].filter((k) => k.startsWith('finished/')));
  let grew = true;
  while (grew) {
    grew = false;
    for (const [from, to] of edges) {
      if (!canFinish.has(from) && [...to].some((k) => canFinish.has(k))) { canFinish.add(from); grew = true; }
    }
  }
  const stuck = [...seen.keys()].filter((k) => k.startsWith('active/') && !canFinish.has(k));
  assert.deepEqual(stuck, [], 'no active state is a dead end');
});

test('the happy path visits all 14 numbered steps in order', () => {
  let s = reduceGuide({ status: 'idle', step: 'start', variant: 'normal', outcome: null, startedAt: null, updatedAt: null, endedMeetingId: null }, { type: 'restart' }, NOW);
  const order = [s.step];
  const go = (e) => { s = reduceGuide(s, e, NOW); if (order.at(-1) !== s.step) order.push(s.step); };
  for (const e of [
    { type: 'meeting_started' }, { type: 'overlay_next' }, { type: 'answer_shown' }, { type: 'screenshot_taken' },
    { type: 'meeting_stopped' }, { type: 'meeting_saved', meetingId: 'm-1' }, { type: 'notes_next' },
    { type: 'surface_notepad' }, { type: 'meeting_started' }, { type: 'note_typed' }, { type: 'ask_opened' },
    { type: 'recipe_run' }, { type: 'meeting_stopped' }, { type: 'meeting_saved', meetingId: 'm-2' }, { type: 'notes_next' },
    { type: 'plan_changed', facts: { ...FACTS, hasNativelyKey: true } },
  ]) go(e);
  assert.deepEqual(order, ['start', 'overlay', 'answer', 'screenshot', 'stop', 'notes', 'surface', 'start2', 'notepad', 'ask', 'recipe', 'stop2', 'notes2', 'plans']);
  assert.equal(s.status, 'finished');
  assert.deepEqual(order.map((x) => GUIDE_STEP_NUMBER[x]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
});

// Code review, 2026-11-15.
const at = (step, extra = {}) => ({ status: 'active', step, variant: 'normal', outcome: null, startedAt: NOW, updatedAt: NOW, endedMeetingId: null, ...extra });

test('no trial does not send someone on their own AI keys to Plans', () => {
  assert.equal(reduceGuide(at('start'), { type: 'trial_out', facts: { ...FACTS, hasOwnAiKey: true } }, NOW).step, 'start');
  assert.equal(reduceGuide(at('start'), { type: 'trial_out', facts: FACTS }, NOW).step, 'plans');
});

test('steps follow where the meeting really opened', () => {
  assert.equal(reduceGuide(at('start'), { type: 'meeting_started', surface: 'notepad' }, NOW).step, 'notepad', 'a notepad meeting at step 1 is taught in the notepad');
  assert.equal(reduceGuide(at('start2'), { type: 'meeting_started', surface: 'overlay' }, NOW).step, 'overlay', 'switched back to the overlay at step 8');
  assert.equal(reduceGuide(at('start'), { type: 'meeting_started' }, NOW).step, 'overlay', 'no surface: the old default');
  assert.equal(reduceGuide(at('start2'), { type: 'meeting_started' }, NOW).step, 'notepad');
  assert.equal(reconcileGuide(at('start'), { meetingActive: true, atLaunch: false, surface: 'notepad' }, NOW).step, 'notepad', 'restarted mid notepad meeting');
});

test('a late save never ends the meeting that is running, and a late meeting-1 save brings its notes back', () => {
  const s = at('notepad');
  assert.equal(reduceGuide(s, { type: 'meeting_saved', meetingId: 'm-1', meetingActive: true }, NOW), s, 'meeting 1 saved while meeting 2 runs');
  const back = reduceGuide(at('surface'), { type: 'meeting_saved', meetingId: 'm-1' }, NOW);
  assert.equal(back.step, 'notes'); assert.equal(back.endedMeetingId, 'm-1');
  const s7 = at('start2');
  assert.equal(reduceGuide(s7, { type: 'meeting_saved', meetingId: 'm-1' }, NOW), s7, 'not once the notepad is picked');
});
