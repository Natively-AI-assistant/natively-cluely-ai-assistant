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
  /** Where the running meeting opened (AppState.getMeetingSurface). */
  meetingSurface?: () => 'overlay' | 'notepad';
  /** Facts from main's own sources: a window's facts are never trusted. */
  factsProvider: () => GuideFacts;
  /** A step was entered. */
  onEnterStep?: (step: GuideStepId) => void;
  /** The guide started (or restarted): meeting 1 is the overlay's. */
  onGuideStart?: () => void;
  /** The guide ended (finished or skipped): the overlay goes back (Evin, 2026-11-15). */
  onGuideEnd?: () => void;
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
  const next = reconcileGuide(state, { meetingActive: deps.meetingActive(), atLaunch: !launchReconciled, surface: deps.meetingSurface?.() }, now);
  launchReconciled = true;
  if (next !== state) return save(state, next);
  if (raw && state.status !== (raw as { status?: unknown }).status) {
    SettingsManager.getInstance().set('firstRunGuide', state);
    // Left a week and expired: it ended, so its setting changes go back too.
    if ((raw as { status?: unknown }).status === 'active') {
      try { deps.onGuideEnd?.(); } catch (e) { console.warn('[Guide] end hand-off failed:', (e as Error)?.message); }
    }
  }
  return state;
}

/** An event from a window (validated) or from main itself. */
export function applyGuideEvent(event: GuideEvent | { type: 'surface_notepad' }): GuideState {
  const now = Date.now();
  const { state: current } = read(now);
  let reduced: GuideState;
  if (event.type === 'meeting_started') {
    // Where the meeting really opened is main's to say.
    reduced = reduceGuide(current, { type: 'meeting_started', surface: deps.meetingSurface?.() }, now);
  } else if (event.type === 'meeting_saved') {
    // A save landing while a meeting runs is the previous meeting's.
    reduced = reduceGuide(current, { type: 'meeting_saved', meetingId: event.meetingId, meetingActive: deps.meetingActive() }, now);
  } else if (event.type === 'plans_closed') {
    // Whether the guide starts: keys and plan from main's own sources, never
    // a window's (its caches may not have loaded). The window's launch count stays.
    const own = deps.factsProvider();
    reduced = reduceGuide(current, { type: 'plans_closed', facts: { ...own, launchCount: Number(event.facts?.launchCount) || own.launchCount } }, now);
  } else if (event.type === 'plan_changed') {
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
    ? reconcileGuide(reduced, { meetingActive: deps.meetingActive(), atLaunch: false, surface: deps.meetingSurface?.() }, now)
    : reduced;
  // One line per real move, so a support log shows how the guide got where it is.
  if (next !== current) console.log(`[Guide] ${event.type}: ${current.step}/${current.status} -> ${next.step}/${next.status}`);
  const saved = save(current, next);
  if (saved !== next) return saved;
  const began = next.status === 'active' && (current.status !== 'active' || event.type === 'restart');
  const ended = current.status === 'active' && next.status !== 'active';
  try {
    if (began) deps.onGuideStart?.();
    if (ended) deps.onGuideEnd?.();
    if (next.status === 'active' && next.step !== current.step) deps.onEnterStep?.(next.step);
  } catch (e) {
    console.warn('[Guide] step hand-off failed:', (e as Error)?.message);
  }
  return saved;
}

/**
 * A screenshot the user took (⌘H, ⌘⇧H, capture-and-answer): step 4 moves on.
 * Those go overlay -> invoke -> main and return the image directly, so no
 * screenshot event ever reaches a window; main tells the guide (Evin,
 * 2026-11-15: "when i do any of the screenshot it should detect"). Never
 * throws: a screenshot must not fail because of the guide.
 */
export function guideScreenshotTaken(): void {
  try {
    const g = read(Date.now()).state;
    if (g.status === 'active' && g.step === 'screenshot') applyGuideEvent({ type: 'screenshot_taken' });
  } catch (e) {
    console.warn('[Guide] screenshot not reported:', (e as Error)?.message);
  }
}

/**
 * The meeting surface was set (Settings › Overlay's switch, meeting-surface:set).
 * Step 7 asks for the notepad, so picking it moves the guide to step 8. Main's
 * own event: a window may not claim the setting changed. Never throws.
 */
export function guideSurfaceSet(surface: 'overlay' | 'notepad'): void {
  try {
    const g = read(Date.now()).state;
    if (surface === 'notepad' && g.status === 'active' && g.step === 'surface') applyGuideEvent({ type: 'surface_notepad' });
  } catch (e) {
    console.warn('[Guide] surface not reported:', (e as Error)?.message);
  }
}

/** guide:dispatch: only the events a window may report. */
export function dispatchGuideFromWindow(event: unknown): GuideState {
  const type = (event as { type?: unknown } | null)?.type;
  if (typeof type !== 'string' || !(GUIDE_EVENT_TYPES as readonly string[]).includes(type)) {
    return read(Date.now()).state;
  }
  return applyGuideEvent(event as GuideEvent);
}
