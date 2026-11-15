/**
 * First-run guide rules (docs/superpowers/specs/2026-11-10-first-run-guide-design.md).
 *
 * Two meetings (Evin, 2026-11-15: "first meeting overlay meeting happens then
 * its meeting note is shown, then again a new meeting by going to settings and
 * changing to meeting notepad mode ... shown how recipes and meeting notepad
 * work"). Meeting 1 in the overlay (start, overlay, answer, screenshot, stop)
 * and its notes; Settings › Overlay to pick the notepad (surface); meeting 2 in
 * the notepad (start2, notepad, ask, recipe, stop2) and its notes (notes2);
 * then Plans & Billing and keys. The main process stores the state and every window reports what it
 * saw; this reducer is the only place that decides what that means, so two
 * windows reporting the same event advance the guide once.
 *
 * Pure: no Electron, no DOM. reduceGuide returns the SAME object when an event
 * changes nothing, so callers can skip the write and the broadcast.
 */

export const GUIDE_RESUME_MS = 7 * 24 * 60 * 60 * 1000;

/** Brand-new users only: the first three launches, with no AI key of their own. */
export const GUIDE_MAX_LAUNCH = 3;

const STEPS = [
  'start', 'overlay', 'answer', 'screenshot', 'stop', 'notes',
  'surface',
  'start2', 'notepad', 'ask', 'recipe', 'stop2', 'notes2',
  'plans', 'keys',
];
const STATUSES = ['idle', 'active', 'skipped', 'finished', 'expired'];
const VARIANTS = ['normal', 'trial_out', 'no_trial'];
const OUTCOMES = ['bought', 'own_keys', null];

/** "N of 14": Plans & Billing and own keys are one step, the last. */
export const GUIDE_STEP_NUMBER = Object.freeze({
  start: 1, overlay: 2, answer: 3, screenshot: 4, stop: 5, notes: 6, surface: 7,
  start2: 8, notepad: 9, ask: 10, recipe: 11, stop2: 12, notes2: 13, plans: 14, keys: 14,
});
export const GUIDE_STEP_COUNT = 14;

/** Steps before Plans & Billing (a missing trial jumps from any of them). */
const BEFORE_PLANS = STEPS.slice(0, STEPS.indexOf('plans'));
/** Steps where meeting 1 (the overlay) runs, and meeting 2 (the notepad). */
const MEETING_1 = ['overlay', 'answer', 'screenshot', 'stop'];
const MEETING_2 = ['notepad', 'ask', 'recipe', 'stop2'];
const IN_MEETING = [...MEETING_1, ...MEETING_2];

/** Linear advances: event type → [from step, to step] pairs. */
const ADVANCE = {
  meeting_started: [['start', 'overlay'], ['start2', 'notepad']],
  overlay_next: [['overlay', 'answer']],
  answer_shown: [['answer', 'screenshot']],
  screenshot_taken: [['screenshot', 'stop']],
  notes_next: [['notes', 'surface'], ['notes2', 'plans']],
  surface_notepad: [['surface', 'start2']],
  note_typed: [['notepad', 'ask']],
  ask_opened: [['ask', 'recipe']],
  recipe_run: [['recipe', 'stop2']],
  own_keys: [['plans', 'keys']],
};

/** Every event a window may report (main rejects anything else). */
export const GUIDE_EVENT_TYPES = Object.freeze([
  'plans_closed', 'meeting_started', 'answer_shown', 'screenshot_taken', 'note_typed', 'meeting_stopped',
  'overlay_next', 'notes_next', 'ask_opened', 'recipe_run',
  'trial_out', 'trial_unavailable', 'plan_changed', 'own_keys', 'keys_done', 'skip', 'restart',
]);
// 'meeting_saved' and 'surface_notepad' are main's own
// (electron/services/firstRunGuideStore.ts): a window may not claim which
// meeting was saved, or that the setting changed, so they are not listed above.

export function emptyGuideState() {
  return { status: 'idle', step: 'start', variant: 'normal', outcome: null, startedAt: null, updatedAt: null, endedMeetingId: null };
}

const isTime = (v) => v === null || (typeof v === 'number' && Number.isFinite(v));

export function normalizeGuideState(raw, now) {
  if (!raw || typeof raw !== 'object') return emptyGuideState();
  const { status, step, variant, outcome, startedAt, updatedAt } = raw;
  // Saved before the field existed: no meeting recorded.
  const endedMeetingId = raw.endedMeetingId === undefined ? null : raw.endedMeetingId;
  if (!STATUSES.includes(status) || !STEPS.includes(step) || !VARIANTS.includes(variant)
    || !OUTCOMES.includes(outcome) || !isTime(startedAt) || !isTime(updatedAt)
    || !(endedMeetingId === null || (typeof endedMeetingId === 'string' && endedMeetingId.length > 0))) {
    return emptyGuideState();
  }
  const state = { status, step, variant, outcome, startedAt, updatedAt, endedMeetingId };
  if (status === 'active' && typeof updatedAt === 'number' && now - updatedAt > GUIDE_RESUME_MS) {
    return { ...state, status: 'expired' };
  }
  return state;
}

export function isGuideEligible(facts) {
  return !!facts && !facts.hasOwnAiKey && Number(facts.launchCount) <= GUIDE_MAX_LAUNCH;
}

export function windowForStep(step) {
  switch (step) {
    case 'start':
    case 'notes':
    case 'start2':
    case 'notes2':
      return 'launcher';
    case 'overlay':
    case 'answer':
    case 'screenshot':
    case 'stop':
      return 'overlay';
    case 'notepad':
    case 'ask':
    case 'recipe':
    case 'stop2':
      return 'notes';
    case 'surface':
    case 'plans':
    case 'keys':
      return 'settings';
    default:
      throw new Error(`Unknown guide step: ${step}`);
  }
}

const move = (state, patch, now) => ({ ...state, ...patch, updatedAt: now });

const fresh = (now) => ({ ...emptyGuideState(), status: 'active', startedAt: now, updatedAt: now });

export function reduceGuide(state, event, now) {
  if (!event || typeof event !== 'object') return state;
  if (event.type === 'restart') return fresh(now);
  if (event.type === 'plans_closed') {
    return state.status === 'idle' && isGuideEligible(event.facts) ? fresh(now) : state;
  }
  if (state.status !== 'active') return state;

  switch (event.type) {
    case 'skip':
      return move(state, { status: 'skipped' }, now);
    case 'meeting_stopped':
      if (MEETING_1.includes(state.step)) return move(state, { step: 'notes' }, now);
      if (MEETING_2.includes(state.step)) return move(state, { step: 'notes2' }, now);
      return state;
    case 'meeting_saved': {
      // Main saved the meeting that just ended (main.ts endMeeting). Its notes
      // step opens exactly that one; with nothing saved there are no notes to
      // show, so the guide goes on (to the switch, or after meeting 2 to Plans).
      const first = MEETING_1.includes(state.step) || state.step === 'notes';
      const second = MEETING_2.includes(state.step) || state.step === 'notes2';
      if (!first && !second) return state;
      const notesStep = first ? 'notes' : 'notes2';
      const id = typeof event.meetingId === 'string' && event.meetingId ? event.meetingId : null;
      // A late "nothing saved" never throws away a meeting the notes step already holds.
      if (!id && state.step === notesStep && state.endedMeetingId) return state;
      if (id) return state.step === notesStep && state.endedMeetingId === id ? state : move(state, { step: notesStep, endedMeetingId: id }, now);
      return move(state, { step: first ? 'surface' : 'plans', endedMeetingId: null }, now);
    }
    case 'trial_out':
    case 'trial_unavailable': {
      // A paid Natively key covers the meeting: no trial is no reason to leave
      // the walk (main attaches its own facts; Evin hit this 2026-11-15).
      if (!BEFORE_PLANS.includes(state.step) || event.facts?.hasNativelyKey) return state;
      return move(state, { step: 'plans', variant: event.type === 'trial_out' ? 'trial_out' : 'no_trial' }, now);
    }
    case 'plan_changed': {
      if (state.step !== 'plans' || !event.facts) return state;
      if (event.facts.hasNativelyKey) return move(state, { status: 'finished', outcome: 'bought' }, now);
      if (event.facts.isPremium) return move(state, { step: 'keys' }, now);
      return state;
    }
    case 'keys_done':
      return state.step === 'keys' ? move(state, { status: 'finished', outcome: 'own_keys' }, now) : state;
    default: {
      const edge = (ADVANCE[event.type] ?? []).find(([from]) => from === state.step);
      if (!edge) return state;
      // A new meeting's notes step must never open the old meeting.
      const patch = edge[1] === 'start2' || edge[1] === 'plans' ? { step: edge[1], endedMeetingId: null } : { step: edge[1] };
      return move(state, patch, now);
    }
  }
}

/**
 * The facts plan_changed is judged on, from main's own sources. A running
 * trial stores a placeholder Natively key (TRIAL_SENTINEL_KEY): that is not a
 * purchase, so it never counts as one.
 */
export function guideFactsFromSources({ nativelyKey, trialSentinel, licensed, hasOwnAiKey, launchCount = 0 } = {}) {
  return {
    hasOwnAiKey: !!hasOwnAiKey,
    hasNativelyKey: typeof nativelyKey === 'string' && nativelyKey.length > 0 && nativelyKey !== trialSentinel,
    isPremium: !!licensed,
    launchCount: Number(launchCount) || 0,
  };
}

/**
 * Line the guide up with whether a meeting is running (main knows; a window
 * may not). A guide on step 1 while a meeting runs (restarted mid-meeting)
 * moves to step 2. At launch, an in-meeting step with no meeting (the app quit
 * or crashed mid-meeting) moves to the notes step, since no stop will come.
 * Returns the same object when nothing changes.
 */
export function reconcileGuide(state, { meetingActive, atLaunch }, now) {
  if (!state || state.status !== 'active') return state;
  if (meetingActive && (state.step === 'start' || state.step === 'start2')) return reduceGuide(state, { type: 'meeting_started' }, now);
  if (atLaunch && !meetingActive && IN_MEETING.includes(state.step)) return reduceGuide(state, { type: 'meeting_stopped' }, now);
  return state;
}

/** Below this much trial time the trial reads as "almost used up". */
const ALMOST_GONE_MS = 15 * 60 * 1000;

/** Step 6's title: never more than the trial status shows (English; callers translate). */
export function planStepTitle({ variant, remainingMs, expired }) {
  if (variant === 'no_trial') return 'Your free trial isn’t available on this device.';
  if (variant === 'trial_out' || expired || remainingMs === 0) return 'Your free trial is used up.';
  if (typeof remainingMs !== 'number') return 'Keep Natively Pro.';
  return remainingMs > ALMOST_GONE_MS ? 'Keep Natively Pro after your trial.' : 'Your free trial is almost used up.';
}

/** What step 1 learns from main's local trial record (get-local-trial). */
export function trialEventFromLocal(local) {
  if (!local || typeof local !== 'object') return null;
  if (local.expired) return 'trial_out';
  if (local.trialClaimed && !local.hasToken) return 'trial_unavailable';
  return null;
}

/**
 * What covers the first meeting, for step 1's line: a running trial, else a
 * paid Natively key. A fresh install has neither yet: its trial starts with
 * the meeting. Never promise a trial a paid user does not have (2026-11-15).
 */
export function startCoverage({ trial, hasNativelyKey } = {}) {
  const trialRunning = !!trial && !!trial.hasToken && !trial.expired;
  if (trialRunning) return 'trial';
  return hasNativelyKey ? 'plan' : 'trial';
}
