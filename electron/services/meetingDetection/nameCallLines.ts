/**
 * At save: the call's own record of who spoke (callRoster, from the Meet page)
 * turned into names on the transcript and the list of who attended.
 *
 * Returns the transcript with a `speakerId` on each other-side line whose
 * speaker is clear (stored with the meeting, so the notes show the name and a
 * rename applies per person), the id → name labels, and the people in the
 * call. Null when the call left no record (no Meet page reported it).
 */
import { attributeSpeakers, type LineLike } from './attributeSpeakers';
import { callRoster as defaultRoster, type CallRoster } from './callRoster';

/** A little past the stop, for the last line's final text. */
const TAIL_MS = 30_000;

export interface NamedCall<T extends LineLike> {
    transcript: T[];
    labels: Record<string, string>;
    participants: string[];
}

export function nameCallLines<T extends LineLike>(
    transcript: T[],
    callKey: string,
    startMs: number,
    durationMs: number,
    roster: CallRoster = defaultRoster,
): NamedCall<T> | null {
    roster.end(callKey);
    const { participants, spans } = roster.snapshot(callKey, startMs, startMs + Math.max(0, durationMs) + TAIL_MS);
    if (participants.length === 0 && spans.length === 0) return null;
    const { ids, labels } = attributeSpeakers(transcript, spans);
    const named = transcript.map((line, i) => (ids.has(i) ? { ...line, speakerId: ids.get(i)! } : line));
    return { transcript: named, labels, participants };
}
