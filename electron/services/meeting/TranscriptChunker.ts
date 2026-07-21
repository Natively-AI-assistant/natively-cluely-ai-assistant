import type { NormalizedTranscript, NormalizedTranscriptSegment, TranscriptChunk } from './types';
import { formatNormalizedSegment } from './TranscriptNormalizer';

export interface TranscriptChunkerOptions {
  chunkTargetTokens?: number;
  overlapTargetTokens?: number;
  shortTranscriptThresholdTokens?: number;
}

const DEFAULT_CHUNK_TARGET_TOKENS = 3000;
const DEFAULT_OVERLAP_TARGET_TOKENS = 300;
const DEFAULT_SHORT_THRESHOLD_TOKENS = 1500;
const CHARS_PER_TOKEN = 4;

function tokenEstimate(text: string): number {
  return Math.ceil((text || '').length / CHARS_PER_TOKEN);
}

export class TranscriptChunker {
  private readonly chunkTargetTokens: number;
  private readonly overlapTargetTokens: number;
  private readonly shortTranscriptThresholdTokens: number;

  constructor(options: TranscriptChunkerOptions = {}) {
    this.chunkTargetTokens = Math.max(250, options.chunkTargetTokens ?? DEFAULT_CHUNK_TARGET_TOKENS);
    this.overlapTargetTokens = Math.max(0, options.overlapTargetTokens ?? DEFAULT_OVERLAP_TARGET_TOKENS);
    this.shortTranscriptThresholdTokens = Math.max(250, options.shortTranscriptThresholdTokens ?? DEFAULT_SHORT_THRESHOLD_TOKENS);

    if (this.overlapTargetTokens >= this.chunkTargetTokens) {
      throw new Error('TranscriptChunker overlapTargetTokens must be less than chunkTargetTokens');
    }
    if (this.chunkTargetTokens - this.overlapTargetTokens <= 0) {
      throw new Error('TranscriptChunker step size must be positive');
    }
  }

  chunk(transcript: NormalizedTranscript): TranscriptChunk[] {
    const segments = transcript.segments || [];
    if (segments.length === 0) return [];
    if (transcript.totalTokensEstimate <= this.shortTranscriptThresholdTokens) {
      return [this.buildChunk(0, segments, false)];
    }

    const chunks: TranscriptChunk[] = [];
    let current: NormalizedTranscriptSegment[] = [];
    let currentTokens = 0;

    for (const segment of segments) {
      const segmentText = formatNormalizedSegment(segment);
      const segmentTokens = tokenEstimate(segmentText);
      const wouldOverflow = current.length > 0 && currentTokens + segmentTokens > this.chunkTargetTokens;

      if (wouldOverflow) {
        chunks.push(this.buildChunk(chunks.length, current, chunks.length > 0));
        current = this.calculateOverlap(current);
        currentTokens = this.segmentTokens(current);
      }

      current.push(segment);
      currentTokens += segmentTokens;
    }

    if (current.length > 0) chunks.push(this.buildChunk(chunks.length, current, chunks.length > 0));
    return chunks;
  }

  private calculateOverlap(segments: NormalizedTranscriptSegment[]): NormalizedTranscriptSegment[] {
    if (this.overlapTargetTokens <= 0) return [];
    const overlap: NormalizedTranscriptSegment[] = [];
    let tokens = 0;

    for (let i = segments.length - 1; i >= 0; i--) {
      const segment = segments[i];
      const segmentTokens = tokenEstimate(formatNormalizedSegment(segment));
      if (overlap.length > 0 && tokens + segmentTokens > this.overlapTargetTokens) break;
      overlap.unshift(segment);
      tokens += segmentTokens;
      if (overlap.length >= 6) break;
    }

    return overlap;
  }

  private segmentTokens(segments: NormalizedTranscriptSegment[]): number {
    return segments.reduce((sum, segment) => sum + tokenEstimate(formatNormalizedSegment(segment)), 0);
  }

  private buildChunk(chunkIndex: number, segments: NormalizedTranscriptSegment[], overlapFromPrevious: boolean): TranscriptChunk {
    const text = segments.map(formatNormalizedSegment).join('\n');
    const timestamps = segments.map(s => s.timestamp).filter(t => typeof t === 'number' && t > 0);
    return {
      chunkIndex,
      segments,
      text,
      charCount: text.length,
      tokenEstimate: tokenEstimate(text),
      overlapFromPrevious,
      timeRange: {
        ...(timestamps.length ? { startMs: Math.min(...timestamps), endMs: Math.max(...timestamps) } : {}),
      },
      segmentIds: segments.map(s => s.segmentId),
    };
  }
}
