/**
 * First-run guide rules (docs/superpowers/specs/2026-11-10-first-run-guide-design.md).
 *
 * Seven steps across four windows: the launcher (start, notes), the overlay
 * (answer, screenshot, stop), the notes window (notepad) and Settings (plans,
 * keys). The main process stores the state and every window reports what it
 * saw; this reducer is the only place that decides what that means, so two
 * windows reporting the same event advance the guide once.
 *
 * Pure: no Electron, no DOM. reduceGuide returns the SAME object when an event
 * changes nothing, so callers can skip the write and the broadcast.
 */

export const GUIDE_RESUME_MS = 7 * 24 * 60 * 60 * 1000;

/** Brand-new users only: the first three launches, with no AI key of their own. */
export const GUIDE_MAX_LAUNCH = 3;

const STEPS = ['start', 'answer', 'screenshot', 'notepad', 'stop', 'notes', 'plans', 'keys'];
const STATUSES = ['idle', 'active', 'skipped', 'finished', 'expired'];
const VARIANTS = ['normal', 'trial_out', 'no_trial'];
const OUTCOMES = ['bought', 'own_keys', null];

/** "N of 7": the stop prompt is the tail of the notepad step, not a step of its own. */
export const GUIDE_STEP_NUMBER = Object.freeze({
  start: 1, answer: 2, screenshot: 3, notepad: 4, stop: 4, notes: 5, plans: 6, keys: 7,
});
export const GUIDE_STEP_COUNT = 7;

/** Steps that happen during the first meeting, before Plans & Billing. */
const BEFORE_PLANS = ['start', 'answer', 'screenshot', 'notepad', 'stop', 'notes'];
/** Steps where a meeting is running. */
const IN_MEETING = ['answer', 'screenshot', 'notepad', 'stop'];

/** Linear advances: event type → [from step, to step]. */
const ADVANCE = {
  meeting_started: ['start', 'answer'],
  answer_shown: ['answer', 'screenshot'],
  screenshot_taken: ['screenshot', 'notepad'],
  note_typed: ['notepad', 'stop'],
  notes_next: ['notes', 'plans'],
  own_keys: ['plans', 'keys'],
};

/** Every event a window may report (main rejects anything else). */
export const GUIDE_EVENT_TYPES = Object.freeze([
  'plans_closed', 'meeting_started', 'answer_shown', 'screenshot_taken', 'note_typed', 'meeting_stopped',
  'notes_next', 'trial_out', 'trial_unavailable', 'plan_changed', 'own_keys', 'keys_done', 'skip', 'restart',
]);
// 'meeting_saved' is main's own (electron/services/firstRunGuideStore.ts): a
// window may not claim which meeting was saved, so it is not listed above.

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
      return 'launcher';
    case 'answer':
    case 'screenshot':
    case 'stop':
      return 'overlay';
    case 'notepad':
      return 'notes';
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
      return IN_MEETING.includes(state.step) ? move(state, { step: 'notes' }, now) : state;
    case 'meeting_saved': {
      // Main saved the meeting that just ended (main.ts endMeeting). Step 5
      // opens exactly that one; with nothing saved there are no notes to show.
      if (!IN_MEETING.includes(state.step) && state.step !== 'notes') return state;
      const id = typeof event.meetingId === 'string' && event.meetingId ? event.meetingId : null;
      return id
        ? (state.step === 'notes' && state.endedMeetingId === id ? state : move(state, { step: 'notes', endedMeetingId: id }, now))
        : move(state, { step: 'plans' }, now);
    }
    case 'trial_out':
      return BEFORE_PLANS.includes(state.step) ? move(state, { step: 'plans', variant: 'trial_out' }, now) : state;
    case 'trial_unavailable':
      return BEFORE_PLANS.includes(state.step) ? move(state, { step: 'plans', variant: 'no_trial' }, now) : state;
    case 'plan_changed': {
      if (state.step !== 'plans' || !event.facts) return state;
      if (event.facts.hasNativelyKey) return move(state, { status: 'finished', outcome: 'bought' }, now);
      if (event.facts.isPremium) return move(state, { step: 'keys' }, now);
      return state;
    }
    case 'keys_done':
      return state.step === 'keys' ? move(state, { status: 'finished', outcome: 'own_keys' }, now) : state;
    default: {
      const edge = ADVANCE[event.type];
      return edge && state.step === edge[0] ? move(state, { step: edge[1] }, now) : state;
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
  if (meetingActive && state.step === 'start') return reduceGuide(state, { type: 'meeting_started' }, now);
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
