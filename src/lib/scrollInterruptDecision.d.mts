export function decideScrollInterrupt(input: {
  delta: number;
  distanceFromBottom: number;
  alreadySuppressed: boolean;
  transitionInFlight: boolean;
  viewportResized?: boolean;
  rearmDistanceThresholdPx?: number;
}): 'arm' | 're-arm' | 'none';
