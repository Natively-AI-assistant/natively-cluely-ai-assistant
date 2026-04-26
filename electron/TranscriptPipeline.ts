import type { TranscriptSegment } from './IntelligenceManager';

type PersistSegment = {
    speaker: string;
    text: string;
    timestamp: number;
};

type TranscriptContextAdmission = { role: 'interviewer' | 'user' | 'assistant' } | null;

type PersistFinalSegmentOptions = {
    isFinal: boolean;
    activeMeetingId: string | null;
    speaker: string;
    text: string;
    timestamp: number;
    // Intentionally unused for persistence gating: this value is for LLM/context flow only.
    transcriptResult: TranscriptContextAdmission;
    appendTranscriptSegment: (meetingId: string, segment: PersistSegment) => void;
    feedLiveTranscript?: (segments: TranscriptSegment[]) => void;
};

/**
 * Persist and index final transcript segments independent of SessionTracker dedup result.
 */
export function persistAndIndexFinalTranscriptSegment(options: PersistFinalSegmentOptions): void {
    if (!options.isFinal || !options.activeMeetingId) {
        return;
    }

    const segment = {
        speaker: options.speaker,
        text: options.text,
        timestamp: options.timestamp,
    };

    options.appendTranscriptSegment(options.activeMeetingId, segment);

    if (options.feedLiveTranscript) {
        options.feedLiveTranscript([{ ...segment, final: true }]);
    }
}
