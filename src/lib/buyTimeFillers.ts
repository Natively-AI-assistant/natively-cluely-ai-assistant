/**
 * Buy-time fillers — natural-sounding stall lines that surface the moment the
 * user clicks an action button, while the real LLM response is still composing.
 *
 * The user reads the filler aloud (~1-2 seconds of speech) so they're already
 * mid-sentence when the streamed answer starts arriving. This collapses the
 * perceived "click → answer" latency from ~1s of awkward silence to zero.
 *
 * Lines are intentionally short (1 sentence, ~5-15 words), low-commitment, and
 * end on an open-ended note so the user can flow naturally into whatever the
 * AI streams next. Picked at random with last-used avoidance so the same line
 * doesn't surface twice in a row.
 */

export type FillerIntent =
    | 'what_to_answer'
    | 'answer_now'
    | 'clarify'
    | 'brainstorm'
    | 'recap'
    | 'follow_up_questions'
    | 'code_hint';

const FILLERS: Record<FillerIntent, string[]> = {
    // Default for the "What to answer?" button. Slightly thoughtful — buys
    // time for behavioral / strategic answers.
    what_to_answer: [
        'Yeah, give me a sec to think about how I want to frame this.',
        "Hmm, good question — let me think about that for a second.",
        "OK so, off the top of my head...",
        "Right, let me think about how to put this.",
        "Yeah, so the way I'd think about that is...",
        "Honestly, let me take a second on that one.",
    ],

    // Direct "Answer" — the user wants to start speaking right now. Shorter,
    // more confident openers.
    answer_now: [
        'Yeah, so...',
        'Right, so basically...',
        "OK, so the way I'd think about it...",
        'Honestly, my take is...',
        'So for me...',
        'Yeah, the short version is...',
    ],

    // Clarifying question — buys a moment by signalling you want to scope.
    clarify: [
        "Quick clarification before I dive in —",
        "Actually, before I jump in, let me ask —",
        "Just so I scope this right —",
        "One quick thing —",
        "Before I start — quick question on scope.",
    ],

    // Brainstorm / thinking-out-loud — coding interview moment. Should sound
    // like an engineer settling in to think.
    brainstorm: [
        "OK, let me think about this out loud for a second.",
        "Right, so let me walk through how I'd approach this.",
        "Alright, my first instinct here is going to be...",
        "Let me think about what's actually going on here.",
        "OK so, the way I usually think about problems like this...",
    ],

    // Recap — neutral, calm.
    recap: [
        "Sure, let me pull this together.",
        "Yeah, so to summarize what we've covered —",
        "Quick recap of where we are —",
    ],

    // "Any questions?" moment — should sound like genuine curiosity.
    follow_up_questions: [
        "Yeah, I do have a couple actually.",
        "Sure, I've been curious about a few things.",
        'Yeah, a few things came up while you were talking.',
        "Definitely — I jotted down a couple as we went.",
    ],

    // Code hint — short, internal-monologue feel since the candidate is
    // mid-coding.
    code_hint: [
        "Hmm, let me check what I have so far.",
        "Wait — let me think about this for a sec.",
        "Hold on, let me trace through this.",
    ],
};

// Tracks the last-used filler per intent so we don't immediately repeat.
// Module-level state is fine: filler picks are session-scoped and don't need
// to persist across reloads.
const lastUsed: Partial<Record<FillerIntent, string>> = {};

/**
 * Pick a stall line for the given intent, avoiding immediate repetition.
 * Falls back to a generic line if the intent has no entries.
 */
export function pickFiller(intent: FillerIntent): string {
    const pool = FILLERS[intent];
    if (!pool || pool.length === 0) return 'Yeah, give me a second...';

    // Filter out the most recent pick when there are alternatives.
    const last = lastUsed[intent];
    const candidates = pool.length > 1 && last ? pool.filter((l) => l !== last) : pool;

    const choice = candidates[Math.floor(Math.random() * candidates.length)];
    lastUsed[intent] = choice;
    return choice;
}
