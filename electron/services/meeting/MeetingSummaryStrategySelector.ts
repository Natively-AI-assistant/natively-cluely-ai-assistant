// MeetingSummaryStrategySelector.ts (Phase 6)
// Chooses how a transcript is summarized:
//   - direct       : short transcript → a single chunk → one structured extraction pass
//   - map_reduce   : medium/long → chunk + overlap → per-chunk atoms → reduce  (default)
//   - long_context : medium band only, when a long-context model is active AND token count
//                    is safely under a conservative cap. Even then we PREFER map_reduce for
//                    very long meetings to avoid "lost in the middle"; long_context just
//                    saves latency in the medium band. Falls back to map_reduce on failure.
//
// This selector is pure (no I/O) and deterministic given its inputs.

import type { NormalizedTranscript } from './types';
import type { SummaryStrategy } from './MeetingSummaryV3';

export interface StrategySelectorOptions {
  // Token thresholds (estimates, ~4 chars/token).
  shortThresholdTokens?: number;     // <= this → direct
  longContextSafeTokens?: number;    // <= this AND long-context allowed → long_context candidate
  // Whether the active model/provider supports a large context window safely.
  longContextAllowed?: boolean;
  // Master toggle for the long_context single-pass optimization.
  enableLongContext?: boolean;
}

const DEFAULT_SHORT_THRESHOLD_TOKENS = 1500;
const DEFAULT_LONG_CONTEXT_SAFE_TOKENS = 48000;

export interface StrategyDecision {
  strategy: SummaryStrategy;
  reason: string;
  totalTokensEstimate: number;
}

export class MeetingSummaryStrategySelector {
  select(transcript: NormalizedTranscript, options: StrategySelectorOptions = {}): StrategyDecision {
    const shortThreshold = Math.max(250, options.shortThresholdTokens ?? DEFAULT_SHORT_THRESHOLD_TOKENS);
    const longContextSafe = Math.max(shortThreshold, options.longContextSafeTokens ?? DEFAULT_LONG_CONTEXT_SAFE_TOKENS);
    const tokens = transcript.totalTokensEstimate;

    if (transcript.segments.length === 0) {
      return { strategy: 'fallback', reason: 'empty transcript', totalTokensEstimate: tokens };
    }

    if (tokens <= shortThreshold) {
      return { strategy: 'direct', reason: `short transcript (${tokens} tok <= ${shortThreshold})`, totalTokensEstimate: tokens };
    }

    // Long-context single pass is a medium-band optimization only and must be explicitly
    // enabled. Very long meetings always use map_reduce.
    if (options.enableLongContext && options.longContextAllowed && tokens <= longContextSafe) {
      return { strategy: 'long_context', reason: `medium transcript with long-context model (${tokens} tok <= ${longContextSafe})`, totalTokensEstimate: tokens };
    }

    return { strategy: 'map_reduce', reason: `medium/long transcript (${tokens} tok)`, totalTokensEstimate: tokens };
  }
}
