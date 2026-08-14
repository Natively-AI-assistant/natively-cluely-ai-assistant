// types.ts
// Transcript/chunk pipeline types + re-export of the canonical MeetingSummaryV3 schema.
//
// The spec-aligned note schema (MeetingSummaryV3 and its item types) lives in
// MeetingSummaryV3.ts and is re-exported here so existing `import ... from './types'`
// call sites keep working. This file additionally owns the normalization/chunking
// types that are specific to the summarization pipeline.

export * from './MeetingSummaryV3';

import type { EvidenceRef, DecisionItem, ActionItem, QuestionItem, RiskItem, PersonMention } from './MeetingSummaryV3';

// Back-compat alias: older code referenced `BulletItem`; the canonical name is NoteBullet.
export type { NoteBullet as BulletItem } from './MeetingSummaryV3';
// Back-compat alias: older code referenced `MeetingSummarySectionV3`.
export type { MeetingNoteSection as MeetingSummarySectionV3 } from './MeetingSummaryV3';
// Back-compat alias: older code referenced `SourceQualityMeta`.
export type { SourceQuality as SourceQualityMeta } from './MeetingSummaryV3';

export interface NormalizedTranscriptSegment {
  segmentId: string;
  speaker: string;
  speakerId?: string;
  text: string;
  timestamp: number;
  uncertainSpeaker?: boolean;
  originalIndex: number;
}

export interface NormalizedTranscript {
  segments: NormalizedTranscriptSegment[];
  text: string;
  totalChars: number;
  totalTokensEstimate: number;
  qualityWarnings: string[];
  speakerQuality: 'good' | 'mixed' | 'poor';
}

export interface TranscriptChunk {
  chunkIndex: number;
  segments: NormalizedTranscriptSegment[];
  text: string;
  charCount: number;
  tokenEstimate: number;
  overlapFromPrevious: boolean;
  timeRange: { startMs?: number; endMs?: number };
  segmentIds: string[];
}

// A finding routed into one of the mode's note sections. Carries evidence so section
// bullets are as inspectable as decisions/actions. Accepts a bare string on the wire
// (coerced to { text } by the validator) for back-compat.
export interface ModeSectionFinding {
  text: string;
  evidence?: EvidenceRef[];
  source?: 'explicit' | 'inferred';
  confidence?: 'high' | 'medium' | 'low';
}

export interface ChunkMeetingAtoms {
  chunkIndex: number;
  timeRange: { startMs?: number; endMs?: number };
  brief: string;
  topics: string[];
  decisions: DecisionItem[];
  actionItems: ActionItem[];
  openQuestions: QuestionItem[];
  risks: RiskItem[];
  deadlines?: ActionItem[];
  people: PersonMention[];
  importantQuotes: EvidenceRef[];
  modeSpecificFindings: Record<string, ModeSectionFinding[]>;
  sourceQualityWarnings?: string[];
}

export interface MeetingModeSectionInput {
  title: string;
  description?: string;
  /** AI-compiled extraction instruction (preferred over description when present). */
  compiledPrompt?: string;
}

export interface MeetingSummaryTelemetryMeta {
  chunkCount: number;
  v3Used: boolean;
  transcriptCoveragePercent: number;
  strategy: 'direct' | 'map_reduce' | 'long_context' | 'fallback';
}
