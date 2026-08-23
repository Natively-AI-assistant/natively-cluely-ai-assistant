export function decideScrollInterrupt(input: {
  delta: number;
  distanceFromBottom: number;
  alreadySuppressed: boolean;
  transitionInFlight: boolean;
  rearmDistanceThresholdPx?: number;
}): 'arm' | 're-arm' | 'none';
