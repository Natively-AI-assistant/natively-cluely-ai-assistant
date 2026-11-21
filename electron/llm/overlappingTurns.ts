// electron/llm/overlappingTurns.ts
//
// Issue #775 (2026-11-21): two channels heard the same moment.
//
// The interviewer channel's final ("connect with the services from the Java
// code? What kind of certainly needed") arrived at 34:45.903 and a microphone
// final ("What kind of certificate may be needed?") 251 ms later. A manual
// What to Answer press prefers a question-shaped user line that came after the
// other party's, so the mic line won and the answer was about certificates.
// Reversing the arrival order kept the interviewer's question.
//
// A user line whose final lands sooner after the other party's final than it
// takes to say it was spoken while the other party was still talking. It is
// not a question the user asked after hearing them: it is crosstalk, or the
// other party's own words picked up by the mic and transcribed differently
// (which MicEchoGuard, matching word pairs, cannot recognise). Arrival times
// are the main process's Date.now() at each final, on macOS and Windows alike.

/** Fast conversational speech is ~4 words a second; 200 ms a word leaves room for faster talkers. */
export const MIN_MS_PER_SPOKEN_WORD = 200;

/** Fewer words than this on the other side is a backchannel ("okay", "mm-hmm, right"), not a line to keep. */
const MIN_OTHER_PARTY_WORDS = 3;

interface TimedLine {
    text: string;
    timestamp: number;
}

function wordCount(text: string): number {
    return String(text || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * True when `userLine` was spoken over `otherPartyLine`: its final arrived
 * after the other party's, but sooner than the user could have said it from
 * the moment the other party's final arrived.
 */
export function wasSpokenOverOtherParty(userLine: TimedLine, otherPartyLine: TimedLine): boolean {
    if (!Number.isFinite(userLine?.timestamp) || !Number.isFinite(otherPartyLine?.timestamp)) return false;
    if (wordCount(otherPartyLine.text) < MIN_OTHER_PARTY_WORDS) return false;
    const userWords = wordCount(userLine.text);
    if (userWords === 0) return false;
    const gapMs = Math.max(0, userLine.timestamp - otherPartyLine.timestamp);
    return gapMs < userWords * MIN_MS_PER_SPOKEN_WORD;
}

// Kept in the prompt, the overlapping line still steered the answer: with the
// interviewer's question chosen, 3/3 live answers to the issue's transcript were
// still about certificates (Natively API, 2026-11-21). These two helpers leave
// that one line out of a single answer's speech window and live evidence; the
// session keeps it.

/** The prompt's speech window ("[ME]: …" lines) without the newest "[ME]: <text>" line. */
export function speechWindowWithoutUserLine(formatted: string, text: string): string {
    const target = `[ME]: ${String(text || '').trim()}`;
    const lines = String(formatted ?? '').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim() === target) {
            lines.splice(i, 1);
            break;
        }
    }
    return lines.join('\n');
}

/** Transcript segments without the user segment that is `line` (same words, final within 1 s). No line: unchanged. */
export function segmentsWithoutUserLine<T extends { speaker: string; text: string; timestamp: number }>(
    segments: T[],
    line: TimedLine | null | undefined,
    roleOf: (speaker: string) => string,
): T[] {
    if (!line) return segments;
    const text = String(line.text || '').trim();
    return segments.filter((s) => !(
        roleOf(s.speaker) === 'user'
        && String(s.text || '').trim() === text
        && Math.abs(s.timestamp - line.timestamp) <= 1000
    ));
}
