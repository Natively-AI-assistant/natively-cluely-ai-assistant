export declare const TRANSCRIPT_FINAL_LIMIT: 100;
export declare const TRANSCRIPT_DEDUPE_WINDOW_MS: 1000;

export type TranscriptSpeaker = 'interviewer' | 'user';
export type TranscriptStatus = 'partial' | 'final';

export interface TranscriptEvent {
  speaker: TranscriptSpeaker;
  text: string;
  final: boolean;
  timestamp: number;
  confidence?: number;
}

export interface TranscriptSegment {
  id: string;
  speaker: TranscriptSpeaker;
  text: string;
  status: TranscriptStatus;
  timestamp: number;
  arrivalSequence: number;
}

export interface TranscriptDedupeEntry {
  normalizedText: string;
  committedAt: number;
  partialSeenAfter: boolean;
}

export interface TranscriptState {
  finals: TranscriptSegment[];
  partials: Record<TranscriptSpeaker, TranscriptSegment | null>;
  nextSequence: number;
  contentRevision: number;
  commitRevision: number;
  lastCommittedId: string | null;
  dedupe: Record<TranscriptSpeaker, TranscriptDedupeEntry | null>;
}

export type TranscriptAction =
  | { type: 'transcript-event'; event: TranscriptEvent }
  | { type: 'reset' };

export declare function createInitialTranscriptState(): TranscriptState;

export declare function transcriptSegmentsReducer(
  state: TranscriptState,
  action: TranscriptAction,
): TranscriptState;
