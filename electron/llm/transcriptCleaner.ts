// electron/llm/transcriptCleaner.ts
// Deterministic transcript cleaner - NO LLM calls
// Fast string-based processing for interview copilot

export interface TranscriptTurn {
    role: 'interviewer' | 'user' | 'assistant';
    text: string;
    timestamp: number;
    /** Punctuation provenance (WTA audit F9, additive). 'unavailable' means
     *  the STT provider never guaranteed punctuation, so question scoring
     *  must treat a missing '?' as NEUTRAL. Absent = legacy writer (legacy
     *  scoring applies unchanged). */
    punctuationSource?: import('./punctuationProvenance').PunctuationSource;
}

/**
 * Filler words and verbal acknowledgements to remove
 */
const FILLER_WORDS = new Set([
    'uh', 'um', 'ah', 'hmm', 'hm', 'er', 'erm',
    'like', 'you know', 'i mean', 'basically', 'actually',
    'so', 'well', 'anyway', 'anyways'
]);

const ACKNOWLEDGEMENTS = new Set([
    'okay', 'ok', 'yeah', 'yes', 'right', 'sure', 'got it',
    'gotcha', 'uh-huh', 'uh huh', 'mm-hmm', 'mm hmm', 'mhm',
    'cool', 'great', 'nice', 'perfect', 'alright', 'all right'
]);

/**
 * Clean a single turn's text
 * Removes fillers, acknowledgements, and cleans up formatting
 */
// Filler/acknowledgement tokens that are ALSO meaningful as mid-sentence content
// words (adjectives / verbs / prepositions). These must only be stripped as
// LEADING/TRAILING discourse markers, never from the middle of a sentence —
// otherwise "why are you the RIGHT person" → "why are you the person" (which then
// fails JD-fit routing), "do you LIKE Python" loses "like", "is that ALL RIGHT"
// loses meaning. (release 2026-06-06 WTA benchmark: wta_jdfit_083 false refusal.)
const CONTENT_AMBIGUOUS = new Set([
    'right', 'like', 'well', 'so', 'sure', 'great', 'nice', 'perfect', 'cool',
    'all right', 'alright', 'yes', 'no',
]);

// A short but genuinely interrogative turn: either it ends in '?', or it is a
// bare wh-/aux word optionally punctuated. Used to exempt such turns from the
// length floor in isMeaningfulTurn (see the comment there).
const SHORT_INTERROGATIVE = /\?\s*$|^(why|how|when|where|what|who|which|whose|whom|really|seriously)[\s!.,?]*$/i;

function cleanText(text: string): string {
    let result = text.toLowerCase().trim();

    // Remove repeated words (yeah yeah, okay okay)
    result = result.replace(/\b(\w+)(\s+\1)+\b/gi, '$1');

    // Split into words and filter. A filler/acknowledgement word is dropped
    // UNCONDITIONALLY only when it's unambiguous noise (um, uh, hmm, gotcha). A
    // CONTENT-AMBIGUOUS token (right, like, well, …) is dropped ONLY when it sits
    // at the START or END of the turn (a discourse marker), never mid-sentence
    // where it carries meaning.
    const words = result.split(/\s+/);
    const norm = (w: string) => w.replace(/[.,!?;:]/g, '');
    const isFiller = (w: string) => FILLER_WORDS.has(w) || ACKNOWLEDGEMENTS.has(w);
    // Find the first and last indices that are NOT a leading/trailing filler run.
    let start = 0, end = words.length - 1;
    while (start <= end && isFiller(norm(words[start]))) start++;
    while (end >= start && isFiller(norm(words[end]))) end--;
    const cleaned = words.filter((word, i) => {
        const normalized = norm(word);
        if (!isFiller(normalized)) return true;
        // Inside the meaningful span: keep content-ambiguous tokens (right/like/…);
        // still drop pure noise (um/uh/hmm/basically) even mid-sentence.
        if (i > start && i < end) return CONTENT_AMBIGUOUS.has(normalized);
        // Leading/trailing filler run → drop.
        return false;
    });

    // Reconstruct
    result = cleaned.join(' ').trim();

    // Clean up punctuation
    result = result.replace(/\s+([.,!?;:])/g, '$1');
    result = result.replace(/([.,!?;:])+/g, '$1');
    result = result.replace(/\s+/g, ' ');

    return result;
}

/**
 * Check if a turn is meaningful enough to keep
 */
function isMeaningfulTurn(turn: TranscriptTurn, cleanedText: string): boolean {
    // Bare one-word interrogatives ("Why?", "When?", "How?", "Where?") are
    // legitimate — and extremely common — interview follow-ups, but they are
    // 3-5 characters long and were being dropped by the length floor below.
    // Dropping them does not merely lose the question: extractLatestQuestion
    // then walks further back and selects a STALE turn the candidate has
    // already answered (dataset wta_projfu_089 — "Talk about your data
    // project." / "I built an analytics pipeline." / "Why?" selected turn 0
    // instead of turn 2). Keep any interviewer turn that carries interrogative
    // shape, regardless of length.
    if (turn.role === 'interviewer' && SHORT_INTERROGATIVE.test(cleanedText.trim())) {
        return true;
    }

    // Always keep interviewer speech (priority)
    if (turn.role === 'interviewer' && cleanedText.length >= 5) {
        return true;
    }

    // Minimum 3 words for other roles
    const wordCount = cleanedText.split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount < 3) {
        return false;
    }

    // Skip pure filler turns
    if (cleanedText.length < 10) {
        return false;
    }

    return true;
}

const CROSS_CHANNEL_ECHO_WINDOW_MS = 3_000;

function normalizeEchoText(text: string): string {
    return (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9+#\-\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Only function words that duplex transcription commonly inserts or drops.
// Content words are never ignored: one added operation, constraint, direction,
// or algorithm can change the problem and must consume its own transcript turn.
const ECHO_FILLER_TOKENS = new Set(['a', 'an', 'the', 'please']);

function normalizeEchoTokens(text: string): string[] {
    return normalizeEchoText(text)
        .split(' ')
        .filter(token => token && !ECHO_FILLER_TOKENS.has(token));
}

function isNearDuplicateEcho(a: string, b: string): boolean {
    const left = normalizeEchoText(a);
    const right = normalizeEchoText(b);
    if (!left || !right || Math.min(left.length, right.length) < 12) return false;
    if (left === right) return true;
    const leftTokens = normalizeEchoTokens(left);
    const rightTokens = normalizeEchoTokens(right);
    return leftTokens.length > 0
        && leftTokens.length === rightTokens.length
        && leftTokens.every((token, index) => token === rightTokens[index]);
}

/**
 * Collapse near-identical duplex STT echoes before the 12-turn budget is
 * applied. Only opposite live-audio roles are compared; assistant output and
 * repeated speech on the same channel remain untouched. When one copy is tagged
 * interviewer, retain that copy so question extraction does not lose the ask.
 */
export function deduplicateTranscriptEchoes(turns: TranscriptTurn[]): TranscriptTurn[] {
    const deduped: TranscriptTurn[] = [];

    for (const turn of turns) {
        if (turn.role === 'assistant') {
            deduped.push(turn);
            continue;
        }

        let echoIndex = -1;
        for (let i = deduped.length - 1; i >= 0; i--) {
            const candidate = deduped[i];
            // Input is normally chronological, but callers are not required to
            // pre-sort it. Do not stop at one old/out-of-order candidate and
            // miss a newer echo earlier in the array.
            if (Math.abs(turn.timestamp - candidate.timestamp) > CROSS_CHANNEL_ECHO_WINDOW_MS) continue;
            if (candidate.role === 'assistant' || candidate.role === turn.role) continue;
            if (isNearDuplicateEcho(candidate.text, turn.text)) {
                echoIndex = i;
                break;
            }
        }

        if (echoIndex < 0) {
            deduped.push(turn);
            continue;
        }

        const prior = deduped[echoIndex];
        if (turn.role === 'interviewer' && prior.role !== 'interviewer') {
            // The retained copy is newer. Remove the earlier echo and append
            // this turn at its real chronological position; replacing in place
            // would make question extraction treat an intervening older turn as
            // the newest question.
            deduped.splice(echoIndex, 1);
            deduped.push(turn);
        }
    }

    return deduped;
}

/**
 * Clean transcript buffer
 * Removes fillers, acknowledgements, and non-meaningful turns
 * Returns cleaned array preserving order
 */
export function cleanTranscript(turns: TranscriptTurn[]): TranscriptTurn[] {
    const cleaned: TranscriptTurn[] = [];

    for (const turn of turns) {
        const cleanedText = cleanText(turn.text);

        if (isMeaningfulTurn(turn, cleanedText)) {
            cleaned.push({
                role: turn.role,
                text: cleanedText,
                timestamp: turn.timestamp,
                // F9: provenance rides through cleaning so the extractor can
                // score punctuation absence correctly for the CHOSEN turn.
                ...(turn.punctuationSource ? { punctuationSource: turn.punctuationSource } : {}),
            });
        }
    }

    return deduplicateTranscriptEchoes(cleaned);
}

/**
 * Sparsify transcript to target turn count
 * Prioritizes interviewer speech, keeps recent context
 * Target: 8-12 turns, ~300-600 tokens
 */
export function sparsifyTranscript(
    turns: TranscriptTurn[],
    maxTurns: number = 12
): TranscriptTurn[] {
    if (turns.length <= maxTurns) {
        return [...turns].sort((a, b) => a.timestamp - b.timestamp);
    }

    // Separate by role
    const interviewerTurns = turns.filter(t => t.role === 'interviewer');
    const otherTurns = turns.filter(t => t.role !== 'interviewer');

    // Budget allocation. The previous version hard-capped interviewer speech at
    // `slice(-6)` and handed the OTHER `maxTurns - 6` slots to `otherTurns`
    // unconditionally — so when one role underfilled, its slots were simply
    // FORFEITED rather than reallocated. An interviewer-heavy window (very
    // common: several questions in a row while the candidate is still thinking)
    // put 14 turns in and got 6 out, discarding half the budget and with it the
    // earlier, still-unanswered questions.
    //
    // Instead: reserve a floor for interviewer speech, cap the other role at
    // whatever is left above that floor, then give every unused slot back to
    // the interviewer — and if the interviewer underfills, give the slack back
    // to the other role. The budget is always fully spent.
    const INTERVIEWER_FLOOR = 6;
    const otherWanted = Math.min(otherTurns.length, Math.max(0, maxTurns - INTERVIEWER_FLOOR));
    const interviewerCount = Math.min(interviewerTurns.length, maxTurns - otherWanted);
    const otherCount = Math.min(otherTurns.length, maxTurns - interviewerCount);

    // Both take the MOST RECENT turns of their role. `slice(-0)` returns the
    // WHOLE array, so a zero count must be handled explicitly.
    const lastN = (arr: TranscriptTurn[], n: number) => (n <= 0 ? [] : arr.slice(-n));

    const result: TranscriptTurn[] = [
        ...lastN(interviewerTurns, interviewerCount),
        ...lastN(otherTurns, otherCount),
    ];

    // Merge and sort by timestamp
    result.sort((a, b) => a.timestamp - b.timestamp);

    return result;
}

/**
 * Format cleaned transcript for LLM input
 */
export function formatTranscriptForLLM(turns: TranscriptTurn[]): string {
    return turns.map(turn => {
        const label = turn.role === 'interviewer' ? 'INTERVIEWER' :
            turn.role === 'user' ? 'ME' : 'ASSISTANT';
        return `[${label}]: ${turn.text}`;
    }).join('\n');
}

/**
 * Full pipeline: clean, sparsify, format
 */
export function prepareTranscriptForWhatToAnswer(
    turns: TranscriptTurn[],
    maxTurns: number = 12
): string {
    const cleaned = cleanTranscript(turns);
    const sparsified = sparsifyTranscript(cleaned, maxTurns);
    return formatTranscriptForLLM(sparsified);
}
