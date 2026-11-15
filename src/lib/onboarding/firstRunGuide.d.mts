export type GuideStepId =
  | 'start' | 'overlay' | 'answer' | 'screenshot' | 'stop' | 'notes'
  | 'surface'
  | 'start2' | 'notepad' | 'ask' | 'recipe' | 'stop2' | 'notes2'
  | 'plans' | 'keys';
export type GuideStatus = 'idle' | 'active' | 'skipped' | 'finished' | 'expired';
export type GuideVariant = 'normal' | 'trial_out' | 'no_trial';
export type GuideWindow = 'launcher' | 'overlay' | 'notes' | 'settings';

export interface GuideState {
  status: GuideStatus;
  step: GuideStepId;
  variant: GuideVariant;
  outcome: 'bought' | 'own_keys' | null;
  startedAt: number | null;
  updatedAt: number | null;
  /** The meeting main saved when a guide meeting ended (its notes step opens it). */
  endedMeetingId: string | null;
}

export interface GuideFacts {
  hasOwnAiKey: boolean;
  hasNativelyKey: boolean;
  isPremium: boolean;
  launchCount: number;
}

export type GuideEvent =
  | { type: 'plans_closed'; facts: GuideFacts }
  | { type: 'meeting_started' }
  | { type: 'answer_shown' }
  | { type: 'screenshot_taken' }
  | { type: 'note_typed' }
  | { type: 'meeting_stopped' }
  | { type: 'overlay_next' }
  | { type: 'notes_next' }
  | { type: 'ask_opened' }
  | { type: 'recipe_run' }
  /** Main's own: the meeting surface was set to the notepad (step 7). */
  | { type: 'surface_notepad' }
  | { type: 'trial_out'; facts?: GuideFacts }
  | { type: 'trial_unavailable'; facts?: GuideFacts }
  /** Main replaces the facts with its own (services/firstRunGuideStore.ts). */
  | { type: 'plan_changed'; facts?: GuideFacts }
  | { type: 'own_keys' }
  | { type: 'keys_done' }
  | { type: 'skip' }
  | { type: 'restart' }
  | { type: 'meeting_saved'; meetingId: string | null };

export const GUIDE_EVENT_TYPES: readonly GuideEvent['type'][];
export const GUIDE_RESUME_MS: number;
export const GUIDE_MAX_LAUNCH: number;
export const GUIDE_STEP_COUNT: number;
export const GUIDE_STEP_NUMBER: Readonly<Record<GuideStepId, number>>;
export function emptyGuideState(): GuideState;
export function normalizeGuideState(raw: unknown, now: number): GuideState;
export function isGuideEligible(facts: GuideFacts): boolean;
export function reduceGuide(state: GuideState, event: GuideEvent, now: number): GuideState;
export function windowForStep(step: GuideStepId): GuideWindow;
export function guideFactsFromSources(sources: {
  nativelyKey?: string | null;
  trialSentinel: string;
  licensed?: boolean;
  hasOwnAiKey?: boolean;
  launchCount?: number;
}): GuideFacts;
export function reconcileGuide(state: GuideState, ctx: { meetingActive: boolean; atLaunch: boolean }, now: number): GuideState;
export function planStepTitle(input: { variant: GuideVariant; remainingMs: number | null; expired: boolean }): string;
export function trialEventFromLocal(local: { hasToken?: boolean; trialClaimed?: boolean; expired?: boolean } | null | undefined): 'trial_out' | 'trial_unavailable' | null;
export function startCoverage(input?: { trial?: { hasToken?: boolean; expired?: boolean; trialClaimed?: boolean } | null; hasNativelyKey?: boolean }): 'trial' | 'plan';
