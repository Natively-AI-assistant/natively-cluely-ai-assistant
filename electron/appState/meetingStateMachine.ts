/**
 * Meeting state transition logic extracted from AppState.
 * Pure state machine — no I/O, no side effects.
 */

export type MeetingState = 'idle' | 'starting' | 'active' | 'ending';

/**
 * Returns true if a meeting can be started from the given state.
 */
export function canStartMeeting(state: MeetingState): boolean {
  return state === 'idle';
}

/**
 * Returns true if a meeting can be ended from the given state.
 */
export function canEndMeeting(state: MeetingState): boolean {
  return state === 'active';
}

/**
 * Returns the next meeting state given the current state and action.
 * Throws if the transition is invalid.
 */
export function getNextMeetingState(currentState: MeetingState, action: 'start' | 'end'): MeetingState {
  if (action === 'start') {
    if (!canStartMeeting(currentState)) {
      throw new Error(`Cannot start meeting from state "${currentState}"`);
    }
    return 'active';
  }

  if (action === 'end') {
    if (!canEndMeeting(currentState)) {
      throw new Error(`Cannot end meeting from state "${currentState}"`);
    }
    return 'idle';
  }

  throw new Error(`Unknown action: "${action}"`);
}
