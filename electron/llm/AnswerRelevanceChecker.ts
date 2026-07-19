// electron/llm/AnswerRelevanceChecker.ts
//
// Campaign 2 longsession (2026-07-19): the fifth and last of this campaign's
// tracked failure families — MiniMax-M3 occasionally answers with a
// free-form non-answer that doesn't address the real question, despite the
// prompt being correctly assembled (verified via [TRACE:LONGCTX] on every
// repro: the real question and any needed grounding are present). Unlike
// the other four families (harness auth wiring, stock-refusal leaks,
// coding-scaffold misfires, JSON-envelope leaks — all fixed by pattern-
// matching specific text shapes), this family has NO shared vocabulary
// across occurrences. Confirmed across ~15 benchmark runs, every instance
// uses different wording: "I'm welcome, ready whenever you want to keep
// going." (run-031 A6), "This turn appears empty.", "(trajectory truncated;
// nothing captured yet)", "No input from you yet, what would you like help
// with?" — regex/phrase-matching (isFalseNoContentClaim, shipped iteration
// 27) cannot generalize to this; a semantic check is the only remaining
// option.
//
// Reuses the SAME local zero-shot NLI classifier (Xenova/mobilebert-
// uncased-mnli) IntentClassifier.ts already loads and warms on the live WTA
// path — no second model/worker/ONNX session. transformers.js's zero-shot-
// classification pipeline supports a custom `hypothesis_template`, so a
// single-label classification with the ANSWER as the premise and a
// hypothesis like "this response directly answers the question: {question}"
// gives a direct entailment-vs-not confidence score, framed as a relevance
// check rather than an intent label.

import { classifyZeroShotRaw } from './IntentClassifier';

export interface AnswerRelevanceResult {
    relevant: boolean;
    confidence: number;
}

/**
 * Confidence threshold below which the answer is flagged as NOT relevant.
 *
 * Empirically tuned (2026-07-19) against a 16-example corpus pulled from
 * this campaign's real repro history (9 known-bad no-content hallucinations
 * from runs 001-031's logged transcripts, 7 known-good real answers of
 * varying length/style), using the exact HYPOTHESIS_TEMPLATE below via a
 * throwaway smoke script (not committed):
 *
 *   bad scores:  [0.0, 0.0, 0.001, 0.001, 0.004, 0.005, 0.075, 0.083, 0.224]
 *   good scores: [0.169, 0.189, 0.27, 0.299, 0.393, 0.55, 0.698]
 *
 * 8/9 bad examples and 6/7 good examples separate cleanly below ~0.16; the
 * remaining two (bad_max=0.224 "I'm welcome, ready whenever you want to
 * keep going.", good_min=0.169 a short real Datadog answer) overlap, so no
 * single threshold perfectly separates this corpus. Set BELOW good_min
 * (0.15, not e.g. 0.19) to bias toward false negatives over false
 * positives: this guard's downstream action is a real, user-visible
 * regeneration attempt (see IntelligenceEngine.ts), and a regeneration
 * triggered on a genuinely fine answer is strictly worse than silently
 * missing one hallucination phrasing that a human would also find only
 * mildly odd ("I'm welcome, ready whenever...") rather than a hard failure.
 */
const ANSWER_RELEVANCE_THRESHOLD = 0.15;

/**
 * BERT-family models have a ~512-token context window. An uncapped long
 * real answer would be silently truncated by the tokenizer before
 * classification, risking a false "irrelevant" verdict if the answer's
 * relevant content happens to land past the truncation point. Cap well
 * under the model's raw token limit — chars, not tokens, since this is a
 * cheap pre-check, not exact tokenization; ~1000 chars is comfortably
 * under 512 tokens for English prose even accounting for tokenizer
 * subword expansion on rare terms.
 *
 * Code-review 2026-07-19 HIGH: classifying ONLY the first 1000 chars
 * systematically penalizes a real, correct answer that opens with a few
 * sentences of scene-setting/preamble before the specific facts — a
 * completely normal MiniMax-M3 speaking pattern this same file's sibling
 * humanizer/speakability machinery already exists to compensate for
 * elsewhere. Empirically verified: a realistic answer with generic preamble
 * before its concrete facts scored BELOW threshold when truncated to the
 * head alone, but comfortably above it when the tail (where the concrete
 * content actually sat) was checked instead. See checkAnswerRelevance's
 * head+tail max-score handling below — this constant now bounds EACH
 * classified chunk, not the whole answer.
 */
const MAX_ANSWER_CHARS_FOR_RELEVANCE_CHECK = 1000;

/**
 * transformers.js's zero-shot-classification pipeline builds the NLI
 * hypothesis by substituting the candidate label into this template's `{}`
 * placeholder — the label itself is just the question text, so the
 * resulting hypothesis is a single complete, natural sentence (NLI models
 * are trained on well-formed hypothesis sentences, not fragments).
 *
 * This exact wording is load-bearing: earlier candidate templates were
 * empirically tested and rejected before landing here (throwaway smoke
 * scripts, not committed). A two-label contrastive framing ("directly
 * answers" vs "is an evasive non-answer / vague filler") consistently
 * misclassified "I'm welcome, ready whenever you want to keep going." as
 * RELEVANT (0.91-0.99 across three different negative-label wordings) —
 * that phrase reads as superficially cooperative/engaged to this small NLI
 * model regardless of what the contrasting label said. A "does this
 * contain specific/substantive content" framing (no question, answer
 * alone) also missed the same phrase (0.99 SPECIFIC). Reverting to a
 * single-label (non-contrastive) score against this specific wording gave
 * the best separation found — see ANSWER_RELEVANCE_THRESHOLD's comment for
 * the actual corpus scores. Do not change this wording without re-running
 * that tuning pass against the same corpus.
 */
const HYPOTHESIS_TEMPLATE = 'This response directly answers the specific question asked: {}';

/**
 * Check whether `answer` actually addresses `question`, using zero-shot NLI
 * entailment rather than pattern-matching specific non-answer phrasings.
 * Returns null when the classifier is unavailable/fails — callers MUST
 * treat null as "skip this check", exactly like every other null-returning
 * guard in this codebase (IntentClassifier.classify, etc.) — never as a
 * negative verdict.
 */
async function scoreChunk(question: string, chunk: string): Promise<number | null> {
    // Single-label classification: the returned score for this one label IS
    // the entailment confidence directly (multi_label:false's softmax-over-
    // one-label degenerates to just the raw entailment probability). The
    // label itself is the question text, substituted into
    // HYPOTHESIS_TEMPLATE's `{}` placeholder by the pipeline.
    const result = await classifyZeroShotRaw(chunk, [question], HYPOTHESIS_TEMPLATE);
    return result ? result.topScore : null;
}

export async function checkAnswerRelevance(question: string, answer: string): Promise<AnswerRelevanceResult | null> {
    const q = String(question || '').trim();
    const a = String(answer || '').trim();
    if (!q || !a) return null;

    if (a.length <= MAX_ANSWER_CHARS_FOR_RELEVANCE_CHECK) {
        const score = await scoreChunk(q, a);
        if (score === null) return null;
        return { relevant: score >= ANSWER_RELEVANCE_THRESHOLD, confidence: score };
    }

    // Head+tail scoring (code-review 2026-07-19 HIGH): a long answer's
    // relevant content is at least as likely to land in its closing
    // sentences (the "punchline" after scene-setting preamble) as its
    // opening ones. Classify both the head and tail chunk and take the MAX
    // score — this only costs a second ~100ms inference, and only for
    // answers that actually exceed the cap (the common short-answer case
    // pays zero extra cost). Taking the max (not requiring both to pass)
    // matches this guard's stated bias: a false positive here triggers a
    // real regeneration on a genuinely fine answer, which is worse than an
    // occasional missed hallucination.
    const headChunk = a.slice(0, MAX_ANSWER_CHARS_FOR_RELEVANCE_CHECK);
    const tailChunk = a.slice(-MAX_ANSWER_CHARS_FOR_RELEVANCE_CHECK);
    const [headScore, tailScore] = await Promise.all([
        scoreChunk(q, headChunk),
        scoreChunk(q, tailChunk),
    ]);
    if (headScore === null && tailScore === null) return null;
    const bestScore = Math.max(headScore ?? -Infinity, tailScore ?? -Infinity);
    return { relevant: bestScore >= ANSWER_RELEVANCE_THRESHOLD, confidence: bestScore };
}
