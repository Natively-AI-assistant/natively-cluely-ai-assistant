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

// Evin, 2026-11-15: the first meeting plays the demo film and Stop waits 30 s (first 15 s, raised so there is time to try things).
import { GUIDE_STOP_LOCK_MS, guideStopLockLeft, normalizeGuideState } from '../firstRunGuide.mjs';
import { readFileSync } from 'node:fs';

test('the first guide meeting locks Stop for 30 s; the second never does; skipping unlocks', () => {
  const m1 = reduceGuide(at('start'), { type: 'meeting_started', surface: 'overlay' }, NOW);
  assert.equal(m1.stopLockUntil, NOW + GUIDE_STOP_LOCK_MS);
  assert.equal(GUIDE_STOP_LOCK_MS, 30_000);
  assert.equal(guideStopLockLeft(m1, NOW), 30_000);
  assert.equal(guideStopLockLeft(m1, NOW + 29_999), 1);
  assert.equal(guideStopLockLeft(m1, NOW + 30_000), 0, 'unlocked on time');
  const n1 = reduceGuide(at('start'), { type: 'meeting_started', surface: 'notepad' }, NOW);
  assert.equal(guideStopLockLeft(n1, NOW), 30_000, 'a first meeting in the notepad is locked too');
  const m2 = reduceGuide(at('start2', { stopLockUntil: NOW + GUIDE_STOP_LOCK_MS }), { type: 'meeting_started' }, NOW);
  assert.equal(guideStopLockLeft(m2, NOW), 0, 'meeting 2 is never locked');
  assert.equal(guideStopLockLeft(reduceGuide(m1, { type: 'skip' }, NOW), NOW), 0, 'skip unlocks at once');
  assert.equal(guideStopLockLeft({ ...m1, stopLockUntil: NOW + 10 * 60_000 }, NOW), GUIDE_STOP_LOCK_MS, 'never longer than 30 s');
  assert.equal(guideStopLockLeft(null, NOW), 0);
});

test('a stored lock survives a restart, and a bad one is dropped without losing the guide', () => {
  const m1 = reduceGuide(at('start'), { type: 'meeting_started' }, NOW);
  assert.equal(normalizeGuideState(m1, NOW).stopLockUntil, m1.stopLockUntil);
  const bad = normalizeGuideState({ ...m1, stopLockUntil: 'soon' }, NOW);
  assert.equal(bad.stopLockUntil, null); assert.equal(bad.step, 'overlay');
  assert.equal(normalizeGuideState({ ...m1, stopLockUntil: undefined }, NOW).stopLockUntil, null, 'saved before the field');
});

test('main refuses the user\'s Stop while locked, opens the film at the first meeting, and never locks auto-stop', () => {
  const ipc = readFileSync(new URL('../../../../electron/ipcHandlers.ts', import.meta.url), 'utf8');
  const end = ipc.slice(ipc.indexOf("safeHandle('end-meeting'"), ipc.indexOf("safeHandle('end-meeting'") + 600);
  assert.ok(end.indexOf('guideStopLockedMs()') > -1 && end.indexOf('guideStopLockedMs()') < end.indexOf('appState.endMeeting()'), 'end-meeting checks the lock first');
  const pill = ipc.slice(ipc.indexOf("safeHandle('overlay-ui-action'"), ipc.indexOf("safeHandle('overlay-ui-action'") + 1200);
  assert.ok(/action\.type === 'end-meeting' && guideStopLockedMs\(\) > 0/.test(pill), 'the pill\'s Stop too');
  assert.ok(ipc.includes('onFirstMeetingStarted') && ipc.includes('shell.openExternal(DEMO_VIDEO_URL, '), 'the film opens in the browser');
  const main = readFileSync(new URL('../../../../electron/main.ts', import.meta.url), 'utf8');
  assert.ok(!main.includes('guideStopLocked'), 'auto-stop, quit and teardown never ask the lock');
  const store = readFileSync(new URL('../../../../electron/services/firstRunGuideStore.ts', import.meta.url), 'utf8');
  assert.ok(store.includes("event.type === 'meeting_started' && current.step === 'start' && next.status === 'active'"), 'only the first meeting opens it');
});

// The two risks Evin asked fixed (2026-11-15): a blocked autoplay, and the
// film taking the front.
import { DEMO_FILM_QUIET_MS, demoFilmOpenOptions } from '../../demoVideoUrl.ts';

test('the film opens behind on macOS; Windows opens it plainly (no such option there)', () => {
  assert.deepEqual(demoFilmOpenOptions('darwin'), { activate: false });
  assert.deepEqual(demoFilmOpenOptions('win32'), {});
  assert.deepEqual(demoFilmOpenOptions('linux'), {});
  const ipc = readFileSync(new URL('../../../../electron/ipcHandlers.ts', import.meta.url), 'utf8');
  assert.ok(ipc.includes('shell.openExternal(DEMO_VIDEO_URL, demoFilmOpenOptions(process.platform))'));
});

test('8 s of silence in the first meeting asks the user to press play, with a way to the film', () => {
  assert.equal(DEMO_FILM_QUIET_MS, 8_000);
  const g = readFileSync(new URL('../../../components/guide/OverlayGuide.tsx', import.meta.url), 'utf8');
  assert.ok(g.includes("const listening = step === 'overlay' || step === 'answer';"), 'listens from step 2');
  assert.ok(g.includes('state.stopLockUntil - GUIDE_STOP_LOCK_MS'), 'timed from the first meeting\'s start, so only a meeting that opened the film');
  assert.equal(g.split("tr('No sound yet? Press play").length - 1, 2, 'steps 2 and 3 both say it');
  assert.ok(g.includes('openExternal?.(DEMO_VIDEO_URL)'), 'Open the demo brings it forward');
});

// Evin, 2026-11-15: "only show this for first users and users clicking through
// the setup and help guide again".
import { isGuideEligible, guideFactsFromSources } from '../firstRunGuide.mjs';

test('the guide starts by itself only for a brand-new user; Setup & Help restarts it for anyone', () => {
  const fresh = { hasOwnAiKey: false, hasNativelyKey: false, isPremium: false, launchCount: 1, hasMeetings: false };
  assert.equal(isGuideEligible(fresh), true);
  assert.equal(isGuideEligible({ ...fresh, hasMeetings: true }), false, 'a meeting of their own: not new, whatever the launch count says');
  assert.equal(isGuideEligible({ ...fresh, launchCount: 4 }), false);
  assert.equal(isGuideEligible({ ...fresh, hasOwnAiKey: true }), false);
  const idle = { status: 'idle', step: 'start', variant: 'normal', outcome: null, startedAt: null, updatedAt: null, endedMeetingId: null, stopLockUntil: null };
  assert.equal(reduceGuide(idle, { type: 'plans_closed', facts: { ...fresh, hasMeetings: true } }, NOW), idle, 'an existing user never gets it from the Plans card');
  for (const status of ['idle', 'skipped', 'finished', 'expired']) {
    const s = reduceGuide({ ...idle, status }, { type: 'restart' }, NOW);
    assert.equal(s.status, 'active'); assert.equal(s.step, 'start', `restart from ${status}`);
  }
  assert.equal(guideFactsFromSources({ trialSentinel: 'x', hasMeetings: true }).hasMeetings, true);
  const ipc = readFileSync(new URL('../../../../electron/ipcHandlers.ts', import.meta.url), 'utf8');
  assert.ok(ipc.includes('hasMeetings: DatabaseManager.getInstance().hasOwnMeeting()'), 'main says, not a window');
  const db = readFileSync(new URL('../../../../electron/db/DatabaseManager.ts', import.meta.url), 'utf8');
  assert.ok(db.includes("SELECT 1 FROM meetings WHERE id != 'demo-meeting' LIMIT 1"), 'the seeded demo does not count');
  const help = readFileSync(new URL('../../../components/SettingsOverlay.tsx', import.meta.url), 'utf8');
  assert.ok(/onShowGuide=\{\(\) => \{ dispatchGui[^}]*restart/.test(help), 'Setup & Help: Start restarts it');
});

test('layout is followed on change, not every frame for the whole guide', () => {
  const g = readFileSync(new URL('../../../components/guide/useGuide.ts', import.meta.url), 'utf8');
  assert.equal((g.match(/requestAnimationFrame\(/g) || []).length, 2, 'one frame loop, inside followLayout');
  assert.ok(g.includes('function followLayout(') && g.includes('new MutationObserver(burst)'));
  assert.ok(!/attributeFilter:[^\]]*data-guide-lit/.test(g), 'lighting a control never wakes it');
});
