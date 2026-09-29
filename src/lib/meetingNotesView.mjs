// Display rules for the meeting-notes page (MeetingDetails.tsx) that are pure
// enough to test on their own.

/**
 * A pause longer than this between one speaker's saved lines starts a new turn.
 * Speech-to-text saves a line every couple of seconds (measured on a real
 * 3-minute interview: median 2.0 s, p90 5.7 s, max 9.4 s between a speaker's
 * consecutive lines), so 15 s only splits where the speaker actually stopped.
 */
export const TURN_GAP_MS = 15_000;

/**
 * Group transcript lines into turns: a speaker's consecutive lines read as one
 * paragraph under one name and time, instead of a row per fragment ("Um, we're
 * going" / "to probably just jump right into this interview."). Lines are never
 * merged across another speaker, so a sentence the other side interrupts stays
 * split. A fragment that starts with an apostrophe continues the word before it
 * ("what we" + "'ll share" → "what we'll share") and joins without a space.
 *
 * Returns the turns in order; `first`/`last` are indexes into `entries`, so a
 * caller can find the turn holding a given line.
 *
 * @param {Array<{ speaker: string; text: string; timestamp?: number }>} entries
 * @param {number} [gapMs]
 */
export function groupTranscriptTurns(entries, gapMs = TURN_GAP_MS) {
    const turns = [];
    entries.forEach((entry, i) => {
        const text = String(entry.text ?? '').trim();
        const prev = turns[turns.length - 1];
        const prevTs = prev ? entries[prev.last].timestamp || 0 : 0;
        if (prev && prev.speaker === entry.speaker && (entry.timestamp || 0) - prevTs <= gapMs) {
            if (text) prev.text = !prev.text ? text : /^['’]/.test(text) ? prev.text + text : `${prev.text} ${text}`;
            prev.last = i;
            return;
        }
        turns.push({ speaker: entry.speaker, timestamp: entry.timestamp, text, first: i, last: i });
    });
    return turns;
}

/**
 * Source-quality warnings the notes page does not show. They describe how the
 * notes were made, not something the reader can act on:
 * - housekeeping (TranscriptNormalizer): "Removed N empty, duplicate, or interim
 *   transcript segments." and "Excluded N AI-assistant turns from meeting-notes
 *   evidence.";
 * - speaker-label quality ("Speaker labels are incomplete or mixed; …", "Speaker
 *   labels are low quality; …") and transcript gaps ("Detected N long transcript
 *   gap(s); …"), removed at the user's request (2026-09-27).
 * Anything else still shows.
 *
 * @param {string} warning
 */
export function isHiddenQualityNote(warning) {
    return /removed|cleaned|interim|duplicate|empty/i.test(warning)
        || /\bexcluded\b.*\bAI-assistant turns?\b/i.test(warning)
        || /\bspeaker labels are\b/i.test(warning)
        || /\blong transcript gaps?\b/i.test(warning);
}
