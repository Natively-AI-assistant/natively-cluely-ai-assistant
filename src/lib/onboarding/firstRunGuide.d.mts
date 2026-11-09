export type GuideStepId = 'start' | 'answer' | 'screenshot' | 'notepad' | 'stop' | 'notes' | 'plans' | 'keys';
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
  | { type: 'notes_next' }
  | { type: 'trial_out' }
  | { type: 'trial_unavailable' }
  | { type: 'plan_changed'; facts: GuideFacts }
  | { type: 'own_keys' }
  | { type: 'keys_done' }
  | { type: 'skip' }
  | { type: 'restart' };

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
