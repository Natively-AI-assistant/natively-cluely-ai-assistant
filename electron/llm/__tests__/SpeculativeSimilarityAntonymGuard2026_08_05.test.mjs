// electron/llm/__tests__/SpeculativeSimilarityAntonymGuard2026_08_05.test.mjs
//
// Regression for the speculative-reuse antonym false-accept (PR #427 tech-debt
// finding, verified 2026-08-05): the speculative pre-fetch gate compared the
// speculative partial against the final question with raw-token Jaccard blended
// with containment (`max(jaccard, containment * 0.9)`). Interview questions
// share almost all their stop words, so semantically OPPOSITE questions scored
// above the 0.75 reuse threshold — measured on the exact HEAD formula:
//
//   "Tell me about a time you succeeded" vs "...you failed"  → 0.771  FALSE ACCEPT
//   "What are your greatest strengths" vs "...weaknesses"    → 0.720  near-miss
//
// A false accept serves the candidate the *wrong prepared answer* to speak
// aloud — the worst possible failure mode for this feature. The fix keeps the
// raw blended score for prefix-completion (the case containment was added for)
// but caps it when the CONTENT words — the words that carry the question's
// meaning — disagree. Stop-word overlap alone can no longer clear the gate.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { speculativeQuestionSimilarity } from '../../../dist-electron/electron/llm/index.js';

// Must mirror IntelligenceEngine's SPECULATIVE_SIMILARITY_THRESHOLD.
const THRESHOLD = 0.75;

describe('antonym questions must not clear the reuse threshold', () => {
    test('"succeeded" vs "failed" (measured 0.771 pre-fix — the false accept)', () => {
        const score = speculativeQuestionSimilarity(
            'Tell me about a time you succeeded',
            'Tell me about a time you failed',
        );
        assert.ok(score < THRESHOLD, `expected < ${THRESHOLD}, got ${score.toFixed(3)}`);
    });

    test('"strengths" vs "weaknesses" (measured 0.720 pre-fix — near miss)', () => {
        const score = speculativeQuestionSimilarity(
            'What are your greatest strengths',
            'What are your greatest weaknesses',
        );
        assert.ok(score < THRESHOLD, `expected < ${THRESHOLD}, got ${score.toFixed(3)}`);
    });

    test('single differing content word ("your strengths" vs "your weaknesses")', () => {
        // Raw formula scores this 0.72 — a near-miss one rephrase from accept.
        const score = speculativeQuestionSimilarity(
            'Tell me about your strengths',
            'Tell me about your weaknesses',
        );
        assert.ok(score < THRESHOLD, `expected < ${THRESHOLD}, got ${score.toFixed(3)}`);
    });
});

describe('prefix completion — the case the gate exists for — still accepts', () => {
    test('partial is a strict prefix of the final question', () => {
        const score = speculativeQuestionSimilarity(
            'Can you walk me through',
            'Can you walk me through your design process?',
        );
        assert.ok(score >= THRESHOLD, `expected >= ${THRESHOLD}, got ${score.toFixed(3)}`);
    });

    test('partial cut before the final noun still reuses (same speculative input)', () => {
        const score = speculativeQuestionSimilarity(
            'What are your greatest',
            'What are your greatest weaknesses',
        );
        assert.ok(score >= THRESHOLD, `expected >= ${THRESHOLD}, got ${score.toFixed(3)}`);
    });

    test('identical question scores 1', () => {
        assert.equal(speculativeQuestionSimilarity('What is a closure?', 'What is a closure?'), 1);
    });
});

describe('degenerate inputs keep the pre-fix behavior', () => {
    test('both empty → 1 (matches the original guard)', () => {
        assert.equal(speculativeQuestionSimilarity('', ''), 1);
    });

    test('all-stop-word partial falls back to the raw blended score', () => {
        // No content words on the partial side — the content guard must not
        // fire; the raw containment blend (0.9 here) decides, as before.
        const score = speculativeQuestionSimilarity(
            'Can you tell me about',
            'Can you tell me about your team?',
        );
        assert.ok(score >= THRESHOLD, `expected >= ${THRESHOLD}, got ${score.toFixed(3)}`);
    });
});

describe('long-sentence antonym pairs (100-pair sweep, 2026-08-11)', () => {
    // The content-word guard compared SET similarity, so a longer question
    // dilutes a single flipped word: "Describe a moment when you made your
    // best decision" vs "...worst decision" shares 4 of 5 content words,
    // clears CONTENT_AGREEMENT_MIN, and the raw blend (0.800) false-accepts.
    // One flipped content word flips the ANSWER — dilution must not save it.
    test('"made your best decision" vs "made your worst decision" rejects', () => {
        const s = speculativeQuestionSimilarity(
            'Describe a moment when you made your best decision',
            'Describe a moment when you made your worst decision',
        );
        assert.ok(s < THRESHOLD, `expected < ${THRESHOLD}, got ${s.toFixed(3)}`);
    });

    test('"Describe a moment when you succeeded" vs failed rejects', () => {
        const s = speculativeQuestionSimilarity(
            'Describe a moment when you succeeded',
            'Describe a moment when you failed',
        );
        assert.ok(s < THRESHOLD, `expected < ${THRESHOLD}, got ${s.toFixed(3)}`);
    });

    test('a long prefix completion still accepts (no collateral damage)', () => {
        const s = speculativeQuestionSimilarity(
            'Describe a moment when you made your best',
            'Describe a moment when you made your best decision under pressure',
        );
        assert.ok(s >= THRESHOLD, `expected >= ${THRESHOLD}, got ${s.toFixed(3)}`);
    });

    test('identical long questions still score 1', () => {
        const q = 'Describe a moment when you made your best decision under pressure';
        assert.equal(speculativeQuestionSimilarity(q, q), 1);
    });
});
