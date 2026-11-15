// First-run guide, main process: the one owner of the stored guide state
// (SettingsManager 'firstRunGuide'). Windows report what they saw through
// guide:dispatch (ipcHandlers.ts); main reports what only it knows: which
// meeting was saved (main.ts endMeeting) and whether a meeting is running.
// The rules live in src/lib/onboarding/firstRunGuide.mjs; this file reads,
// reduces, saves and tells every window. Same on macOS and Windows.
import { BrowserWindow } from 'electron';
import { SettingsManager } from './SettingsManager';
import {
  GUIDE_EVENT_TYPES,
  normalizeGuideState,
  reconcileGuide,
  reduceGuide,
} from '../../src/lib/onboarding/firstRunGuide.mjs';
import type { GuideEvent, GuideFacts, GuideState, GuideStepId } from '../../src/lib/onboarding/firstRunGuide.mjs';

type GuideStoreDeps = {
  /** Whether a meeting is running right now (AppState.getIsMeetingActive). */
  meetingActive: () => boolean;
  /** Facts from main's own sources: a window's facts are never trusted. */
  factsProvider: () => GuideFacts;
  /** A step was entered (main moves windows for it: step 5 is the notepad alone). */
  onEnterStep?: (step: GuideStepId) => void;
};

let deps: GuideStoreDeps = {
  meetingActive: () => false,
  factsProvider: () => ({ hasOwnAiKey: false, hasNativelyKey: false, isPremium: false, launchCount: 0 }),
};
let launchReconciled = false;

export function configureGuideStore(next: GuideStoreDeps): void {
  deps = next;
}

function save(current: GuideState, next: GuideState): GuideState {
  if (next === current) return current;
  if (!SettingsManager.getInstance().set('firstRunGuide', next)) return current;
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('guide:changed', next);
  });
  return next;
}

function read(now: number): { raw: unknown; state: GuideState } {
  const raw = SettingsManager.getInstance().get('firstRunGuide');
  return { raw, state: normalizeGuideState(raw, now) };
}

/** guide:get. The first read of this process lines a resumed guide up with
 *  the meeting state: a guide left on an in-meeting step by a quit or crash
 *  goes on to the notes step, since no stop event will ever come. */
export function getGuideState(): GuideState {
  const now = Date.now();
  const { raw, state } = read(now);
  const next = reconcileGuide(state, { meetingActive: deps.meetingActive(), atLaunch: !launchReconciled }, now);
  launchReconciled = true;
  if (next !== state) return save(state, next);
  if (raw && state.status !== (raw as { status?: unknown }).status) SettingsManager.getInstance().set('firstRunGuide', state);
  return state;
}

/** An event from a window (validated) or from main itself. */
export function applyGuideEvent(event: GuideEvent | { type: 'meeting_saved'; meetingId: string | null }): GuideState {
  const now = Date.now();
  const { state: current } = read(now);
  let reduced: GuideState;
  if (event.type === 'plan_changed') {
    // Main decides what was bought: a running trial's placeholder key is not
    // a purchase (guideFactsFromSources), whatever a window believes.
    reduced = reduceGuide(current, { type: 'plan_changed', facts: deps.factsProvider() }, now);
  } else if (event.type === 'trial_out' || event.type === 'trial_unavailable') {
    // No trial only matters to someone with no paid plan: main says which.
    reduced = reduceGuide(current, { type: event.type, facts: deps.factsProvider() }, now);
  } else {
    reduced = reduceGuide(current, event as GuideEvent, now);
  }
  // Started (or restarted) while a meeting already runs: step 2, not a Start
  // button that reads "Meeting ongoing".
  const next = event.type === 'restart' || event.type === 'plans_closed'
    ? reconcileGuide(reduced, { meetingActive: deps.meetingActive(), atLaunch: false }, now)
    : reduced;
  // One line per real move, so a support log shows how the guide got where it is.
  if (next !== current) console.log(`[Guide] ${event.type}: ${current.step}/${current.status} -> ${next.step}/${next.status}`);
  const saved = save(current, next);
  if (next.status === 'active' && next.step !== current.step) {
    try { deps.onEnterStep?.(next.step); } catch (e) { console.warn('[Guide] step hand-off failed:', (e as Error)?.message); }
  }
  return saved;
}

/** guide:dispatch: only the events a window may report. */
export function dispatchGuideFromWindow(event: unknown): GuideState {
  const type = (event as { type?: unknown } | null)?.type;
  if (typeof type !== 'string' || !(GUIDE_EVENT_TYPES as readonly string[]).includes(type)) {
    return read(Date.now()).state;
  }
  return applyGuideEvent(event as GuideEvent);
}
