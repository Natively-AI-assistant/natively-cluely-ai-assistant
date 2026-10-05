export const TURN_GAP_MS: number;

export interface TranscriptTurn {
    speaker: string;
    timestamp?: number;
    text: string;
    /** Index of the turn's first line in the entries passed in. */
    first: number;
    /** Index of the turn's last line in the entries passed in. */
    last: number;
}

export function groupTranscriptTurns(
    entries: ReadonlyArray<{ speaker: string; text: string; timestamp?: number }>,
    gapMs?: number,
): TranscriptTurn[];

export function isHiddenQualityNote(warning: string): boolean;
