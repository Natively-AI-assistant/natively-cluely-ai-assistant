// electron/llm/punctuationRestoration.ts
//
// Candidate P of the interaction-router campaign: punctuation and truecasing
// restoration for STT text that arrives with neither.
//
// WHY THIS MATTERS, MEASURED RATHER THAN ASSUMED
//
// `punctuationProvenance.ts` records the stakes: stripping punctuation and
// casing roughly doubles dialogue-act segmentation error (14.2% to 32.9% DSER),
// and question detection in this codebase keys on question marks specifically.
// The local STT models emit no punctuation at all, so on those providers every
// question arrives indistinguishable from a statement.
//
// THIS MODULE IS THE PURE DECODER ONLY.
//
// It turns a token-classification model's per-token labels back into text. It
// performs no I/O, loads no model, and knows nothing about ONNX. The model runs
// in its own worker (see the worker rule in every other local-model loader in
// this repo); this half is pure so it can be tested exhaustively without one.
//
// RAW TEXT IS NEVER OVERWRITTEN. `punctuationProvenance.ts` states that as a
// requirement of the future restoration stage, and it is a real constraint, not
// a style preference: the retrieval and question-extraction paths both key off
// raw transcript text, and silently substituting a model's guess would change
// what they match against with no way to tell afterwards. Restoration produces
// a SECOND field alongside the original.

/**
 * The label vocabulary of `unikei/distilbert-base-re-punctuate`, exported to
 * ONNX by scripts/intent-benchmark/tools/export_punctuation_onnx.py.
 *
 * Each label is a casing decision and a trailing-punctuation decision fused
 * into one token: `{UPPER|Upper|lower}{_|.|,|!|?|:|;|-}` where `_` means no
 * trailing punctuation. That fusion is why one model covers both halves of
 * what the campaign brief calls "punctuation and truecasing restoration".
 */
export type CasingDecision = 'UPPER' | 'Upper' | 'lower';

export interface TokenLabel {
    /** The token as the tokenizer produced it, `##` prefix intact for subwords. */
    word: string;
    /** The predicted label, e.g. `Upper,` or `lower_`. */
    entity: string;
    /** Model confidence for this token, when the pipeline supplies one. */
    score?: number;
}

export interface RestorationResult {
    /** The restored text. Never written back over the source. */
    text: string;
    /** Mean per-token confidence, or null when the pipeline supplied none. */
    confidence: number | null;
    /** How many tokens the model actually labelled. */
    tokenCount: number;
}

/** Split a fused label into its two decisions. Unknown labels degrade to a
 *  no-op rather than throwing: a single odd label must not lose a whole turn. */
export function parseLabel(entity: string): { casing: CasingDecision; punctuation: string } {
    const raw = String(entity ?? '');
    const casing: CasingDecision =
        raw.startsWith('UPPER') ? 'UPPER' : raw.startsWith('Upper') ? 'Upper' : 'lower';
    const tail = raw.slice(casing.length);
    // `_` is the model's "no punctuation here" marker and must not be emitted.
    const punctuation = tail === '_' || tail === '' ? '' : tail;
    return { casing, punctuation };
}

function applyCasing(word: string, casing: CasingDecision): string {
    if (!word) return word;
    if (casing === 'UPPER') return word.toUpperCase();
    if (casing === 'Upper') return word.charAt(0).toUpperCase() + word.slice(1);
    return word;
}

/**
 * Rebuild text from per-token labels.
 *
 * Subword handling is the fiddly part and it is where a naive implementation
 * silently corrupts output. WordPiece splits "what's" into `what` + `##s`, and
 * the model labels BOTH. The `##` pieces must be glued to the previous word
 * with no space, must not have their own casing applied (uppercasing the `s` in
 * `what's` would produce `WhatS`), and their punctuation decision belongs at
 * the end of the whole word, not in the middle of it.
 */
export function restoreFromLabels(tokens: readonly TokenLabel[]): RestorationResult {
    const words: string[] = [];
    let pendingPunct = '';
    let scoreSum = 0;
    let scoreCount = 0;

    for (const tok of tokens) {
        if (!tok || typeof tok.word !== 'string') continue;
        const { casing, punctuation } = parseLabel(tok.entity);
        if (typeof tok.score === 'number' && Number.isFinite(tok.score)) {
            scoreSum += tok.score;
            scoreCount++;
        }

        if (tok.word.startsWith('##')) {
            // Continuation of the previous word: glue it on, keep its casing
            // decision out of it, and let its punctuation replace whatever the
            // stem proposed, since the stem was not the end of the word.
            const piece = tok.word.slice(2);
            if (words.length === 0) words.push(piece);
            else words[words.length - 1] += piece;
            pendingPunct = punctuation;
            continue;
        }

        // A new word starts, so any punctuation the previous word earned is now
        // final and gets attached to it.
        if (pendingPunct && words.length > 0) {
            words[words.length - 1] += pendingPunct;
        }
        pendingPunct = punctuation;
        words.push(applyCasing(tok.word, casing));
    }
    if (pendingPunct && words.length > 0) words[words.length - 1] += pendingPunct;

    return {
        text: words.join(' '),
        confidence: scoreCount > 0 ? scoreSum / scoreCount : null,
        tokenCount: tokens.length,
    };
}

/**
 * Whether a restored string is safe to use.
 *
 * A restoration that drops or invents words is worse than no restoration,
 * because every downstream consumer would then be reading text the speaker
 * never said. The check is on the WORD SEQUENCE with casing and punctuation
 * removed: that must be unchanged, or the result is rejected and the caller
 * keeps the raw text.
 *
 * This is not paranoia about a hypothetical. A token-classification decoder
 * that mishandles subwords produces exactly this failure, and it is invisible
 * unless something compares against the input.
 */
export function isFaithfulRestoration(raw: string, restored: string): boolean {
    const norm = (s: string) =>
        String(s ?? '')
            .toLowerCase()
            .replace(/[.,!?:;-]/g, '')
            .split(/\s+/)
            .filter(Boolean)
            .join(' ');
    return norm(raw) === norm(restored);
}
