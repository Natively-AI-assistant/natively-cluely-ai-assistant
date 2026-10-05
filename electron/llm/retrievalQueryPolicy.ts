// electron/llm/retrievalQueryPolicy.ts
//
// Provenance policy for the MODE-REFERENCE retrieval query (HDFC leak,
// 2026-08-18, session_31d52d42): a WTA press with no captured speech, no
// screenshot, and no page text fell back to `retrievalQuery = cleanedTranscript`
// — but the only content in the transcript window was the assistant's OWN
// previous answer. That self-echo query ran hybrid retrieval over the active
// mode's reference files, and because mode-reference admission is pool-relative
// (best-of-pool wins), an entirely off-topic document was admitted and became
// the only substantive evidence in the prompt. The model dutifully summarized
// the user's private bank document in the middle of a coding interview.
//
// The invariant this module enforces: a mode-reference retrieval query MUST be
// user-originated. In priority order that means
//   1. the extracted question (the user/interviewer actually asked something),
//   2. the non-assistant lines of the transcript window (someone spoke),
//   3. captured screen text (DOM capture / OCR — the user pointed at a page).
// When none of these exist the turn has NO user signal, and retrieval is not
// merely re-keyed — it is DISALLOWED, because any query we could synthesize
// (assistant echo, mode name, empty string) selects best-of-pool content the
// user never asked about. This applies in EVERY mode, including document-
// grounded ones: a blind press must go through the no-question handling, not
// dump whichever document scores highest against nothing.
//
// Pure and dependency-free so main-process callers (WhatToAnswerLLM,
// IntelligenceEngine's parallel prefetch) and tests share the exact rule.

/** Where the derived retrieval query came from. `none` ⇒ retrieval disallowed. */
export type RetrievalQuerySource = 'question' | 'user_transcript' | 'screen_text' | 'none';

export interface RetrievalQuerySignals {
    /** The extracted/planned question for this turn (answerPlan.question). */
    extractedQuestion?: string | null;
    /**
     * The prepared transcript window, in the labelled format produced by
     * formatTranscriptForLLM: turns begin with `[INTERVIEWER]: `, `[ME]: ` or
     * `[ASSISTANT]: `; a turn's text may itself span multiple lines.
     */
    transcriptWindow?: string | null;
    /** Screen content that arrived as text: DOM capture and/or screen OCR. */
    capturedScreenText?: string | null;
}

export interface RetrievalQueryDecision {
    /** The user-originated query ('' when source is 'none'). */
    query: string;
    source: RetrievalQuerySource;
    /** False ⇒ skip mode-reference retrieval entirely for this turn. */
    allowed: boolean;
}

/**
 * Screen text can be an entire page dump; cap what we embed/rank on so the
 * query stays a query. The cap is generous enough to keep the page's subject.
 */
export const SCREEN_TEXT_QUERY_MAX_CHARS = 2000;

const TURN_LABEL_RE = /^\[(INTERVIEWER|ME|ASSISTANT)\]: /;

/**
 * Drop `[ASSISTANT]: ` turns (including their continuation lines, which carry
 * no label) from a labelled transcript window. Unlabelled leading text is
 * kept: it can only come from user-side context paths, and provenance-unknown
 * text must not be silently attributed to the assistant.
 */
export function stripAssistantTurns(transcriptWindow: string): string {
    const kept: string[] = [];
    // Turns are label-delimited, not line-delimited: an assistant turn's
    // markdown body spans lines until the next label.
    let dropping = false;
    for (const line of transcriptWindow.split('\n')) {
        const label = TURN_LABEL_RE.exec(line)?.[1];
        if (label) dropping = label === 'ASSISTANT';
        if (!dropping) kept.push(line);
    }
    return kept.join('\n').trim();
}

/**
 * Derive the mode-reference retrieval query for a turn from user-originated
 * signals only. See the module header for the invariant and its origin.
 */
export function deriveRetrievalQuery(signals: RetrievalQuerySignals): RetrievalQueryDecision {
    const question = signals.extractedQuestion?.trim();
    if (question) {
        return { query: question, source: 'question', allowed: true };
    }

    const userTranscript = signals.transcriptWindow ? stripAssistantTurns(signals.transcriptWindow) : '';
    if (userTranscript) {
        return { query: userTranscript, source: 'user_transcript', allowed: true };
    }

    const screenText = signals.capturedScreenText?.trim();
    if (screenText) {
        return {
            query: screenText.slice(0, SCREEN_TEXT_QUERY_MAX_CHARS),
            source: 'screen_text',
            allowed: true,
        };
    }

    return { query: '', source: 'none', allowed: false };
}
