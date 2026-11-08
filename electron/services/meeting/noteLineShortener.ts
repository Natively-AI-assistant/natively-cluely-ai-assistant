/**
 * "Shorten": one line of the user's own meeting notes, tightened by the model
 * without adding anything. The notes window offers it on the line under the
 * caret; the result replaces the line only when it is clearly the same note,
 * shorter, and introduces no new facts (checked here, not trusted).
 *
 * Natively's own wording. The model is the user's configured one, through the
 * same call meeting extraction uses (generateMeetingSummary with a short
 * timeout), so a local model works too. Pure apart from the injected call.
 */

export const SHORTEN_TIMEOUT_MS = 12_000;
const MAX_INPUT_CHARS = 600;

export const SHORTEN_SYSTEM_PROMPT = `You tighten one line of someone's meeting notes while they are in the meeting.

Rules:
- Keep every fact, name, number, date and decision. Add nothing. Never guess what they meant.
- Cut filler, repetition and hedging; prefer a short noun phrase or a terse sentence.
- Keep their language and their abbreviations. Keep a leading "- " or "# " exactly as it is.
- If the line is already tight, return it unchanged.
- Reply with the shortened line only: no quotes, no explanation, one line.

Examples:
Line: so basically Dana said that they are probably going to need the contract sometime before the end of Q3 I think
Reply: Dana: needs the contract before end of Q3

Line: - we talked about maybe moving the weekly sync from Tuesday to Thursday afternoons because of the London team
Reply: - Move weekly sync Tue → Thu afternoon (London team)

Line: # Pricing
Reply: # Pricing`;

/** The one line to send, bounded; null when there is nothing to shorten. */
export function shortenInput(raw: unknown): string | null {
    const line = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (line.length < 12) return null;
    return line.slice(0, MAX_INPUT_CHARS);
}

const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu;
/** Words that may appear in a tightened line without being "new facts". */
// Quarters, days and numbers are facts, so they are NOT free: "Q4" for "Q3" is a change.
const FREE_WORDS = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'for', 'on', 'in', 'at', 'by', 'with', 'from', 'before', 'after', 'end', 'start', 'next', 'move', 'needs', 'need', 'per', 'via', 'vs']);

/**
 * The model's reply as the line to store, or null when it must not replace the
 * original: empty, several lines, not shorter, a changed prefix marker, or a
 * capitalised word / number that was not in the original (a new fact).
 */
export function acceptShortened(reply: unknown, original: string): string | null {
    const out = String(reply ?? '').replace(/^```[a-z]*\s*|\s*```$/g, '').trim().replace(/^["'“]|["'”]$/g, '').trim();
    if (!out || /\n/.test(out)) return null;
    const orig = original.replace(/\s+/g, ' ').trim();
    if (out === orig) return orig;
    if (out.length >= orig.length) return null;
    const marker = (s: string) => (s.match(/^(#+\s|[-*•]\s)/)?.[1] ?? '');
    if (marker(out) !== marker(orig)) return null;
    const origTokens = new Set((orig.match(TOKEN) ?? []).map((t) => t.toLowerCase()));
    for (const t of out.match(TOKEN) ?? []) {
        const low = t.toLowerCase();
        if (origTokens.has(low) || FREE_WORDS.has(low)) continue;
        // A number or a capitalised word the user never wrote is a new fact.
        if (/^\p{N}/u.test(t) || /^\p{Lu}/u.test(t)) return null;
    }
    return out;
}
