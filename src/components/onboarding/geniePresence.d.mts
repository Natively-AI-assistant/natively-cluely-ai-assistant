export interface PresenceState {
  /** The card is in the DOM: shown, or playing its close. */
  mounted: boolean;
  /** The close genie is running. */
  closing: boolean;
}

export type PresenceEvent = 'open' | 'close' | 'closed';

export declare function presenceInitial(open: boolean): PresenceState;
export declare function presenceReducer(state: PresenceState, event: PresenceEvent): PresenceState;
export declare function presenceEventFor(state: PresenceState, open: boolean): 'open' | 'close' | null;
