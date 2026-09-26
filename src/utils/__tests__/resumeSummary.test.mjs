// Regression for the Identity → Resume candidate snapshot summary.
//
// Hard rules (cross-checked with the renderer at
// src/components/ProfileIntelligenceSettings.tsx):
//   1. Empty / non-string input → null (render nothing).
//   2. Summary at or under SUMMARY_CHAR_CAP → render whole, untouched.
//   3. Summary over the cap → first SUMMARY_CHAR_CAP characters, snapped
//      back to the last sentence terminator inside the cap that ends ≥ 8
//      words. If no terminator exists in the cap, emit the cap verbatim.
//   4. NEVER produce an "…" ellipsis in the output.
//
// The cap is sized to fit exactly 3 rendered lines in the candidate snapshot
// card (fontSize 11, lineHeight 1.55, ~360px content width → ~70 chars/line).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { truncateResumeSummary, SUMMARY_CHAR_CAP } from '../resumeSummary.mjs';

describe('truncateResumeSummary', () => {
    test('null / undefined / non-string → null', () => {
        assert.equal(truncateResumeSummary(null), null);
        assert.equal(truncateResumeSummary(undefined), null);
        assert.equal(truncateResumeSummary(42), null);
        assert.equal(truncateResumeSummary({ summary: 'x' }), null);
        assert.equal(truncateResumeSummary([]), null);
    });

    test('empty / whitespace-only string → null', () => {
        assert.equal(truncateResumeSummary(''), null);
        assert.equal(truncateResumeSummary('   '), null);
        assert.equal(truncateResumeSummary('\n\t  '), null);
    });

    test('short summary (≤ 210 chars) → render whole, untouched', () => {
        const s = 'AI engineer with five years of full-stack experience.';
        assert.equal(truncateResumeSummary(s), s);
        // Leading/trailing whitespace is stripped; internal whitespace is
        // preserved (we don't mangle the summary text).
        const padded = '   spaced   out   summary   ';
        assert.equal(truncateResumeSummary(padded), 'spaced   out   summary');
    });

    test('exactly SUMMARY_CHAR_CAP chars → render whole', () => {
        const exactly210 = 'x'.repeat(SUMMARY_CHAR_CAP);
        assert.equal(truncateResumeSummary(exactly210), exactly210);
    });

    test('over the cap, with sentence terminator inside the cap → snap to terminator', () => {
        // First sentence ends with a period inside the cap.
        const input = 'Senior full-stack engineer with five years building AI products. ' +
                      'I have shipped user-facing features across desktop and web platforms. ' +
                      'Now I lead a small team on a generative coding tool. ' +
                      'I also write about distributed systems and developer experience regularly.';
        const out = truncateResumeSummary(input);
        // Output must end at a sentence terminator (., !, ?).
        assert.match(out, /[.!?]$/);
        // No ellipsis.
        assert.ok(!out.endsWith('…'), `Output must NOT end with ellipsis: ${out}`);
        // Must be inside the cap.
        assert.ok(out.length <= SUMMARY_CHAR_CAP,
            `Length ${out.length} exceeds cap ${SUMMARY_CHAR_CAP}`);
        // Must contain complete sentences only — no unterminated tail.
        assert.ok(!/[a-z]\s*$/.test(out), `Output must end at sentence boundary, got: "${out}"`);
    });

    test('over the cap, no terminator inside the cap → emit first 210 chars verbatim', () => {
        // Build a 400-char string with no periods/exclamations/questions inside
        // the first 210 chars.
        const longNoTerm = 'word'.repeat(100); // 400 chars, no terminators at all
        const out = truncateResumeSummary(longNoTerm);
        assert.equal(out.length, SUMMARY_CHAR_CAP);
        assert.equal(out, longNoTerm.slice(0, SUMMARY_CHAR_CAP));
        assert.ok(!out.endsWith('…'));
    });

    test('output NEVER contains an ellipsis', () => {
        const inputs = [
            'Engineer with experience shipping user-facing AI products across desktop, web, and real-time systems.',
            'A B C D E F G H I J K L M N O P Q R S T U V W X Y Z ' +
                'AA BB CC DD EE FF GG HH II JJ KK LL MM NN OO PP QQ RR SS TT UU VV WW XX YY ZZ.',
            'foo. bar. baz. quux. quux. quux. quux. quux. quux. quux. quux. quux. ' +
                'quux. quux. quux. quux. quux. quux. quux. quux. quux. quux. quux. quux. ' +
                'quux. quux. quux. quux. quux. quux. quux. quux. quux. quux. quux. quux.',
            'x'.repeat(500),
        ];
        for (const input of inputs) {
            const out = truncateResumeSummary(input);
            assert.ok(out == null || !out.endsWith('…'),
                `Ellipsis found in output of: ${input.slice(0, 80)}…`);
        }
    });

    test('short "Hi." (terminator before 8 words) is NOT treated as a complete sentence', () => {
        // Build a long summary where the only period is at "Hi." (1 word), well
        // below the 8-word minimum. The cap kicks in and the first 210 chars
        // are returned verbatim — NOT snapped to "Hi.".
        const input = 'Hi. ' + Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');
        const out = truncateResumeSummary(input);
        assert.equal(out.length, SUMMARY_CHAR_CAP);
        // The output must NOT be just "Hi.".
        assert.notEqual(out, 'Hi.');
    });

    test('real-world long summary snaps cleanly to a sentence end', () => {
        // Reproduces the kind of summary the LLM extractor emits for experienced
        // engineers. The bug being prevented: rendering ended as "...real-…"
        // (mid-word ellipsis) instead of a full sentence.
        const input = 'Senior engineer with 8 years building distributed systems and developer ' +
                      'tooling at consumer-scale. Shipped fraud detection pipelines processing 50M+ ' +
                      'events daily. Led microfrontend platform serving 2000+ internal users across ' +
                      '15 product teams. Mentored 6 junior engineers through promotion to senior. ' +
                      'Speaker at JSConf and React Summit. Open-source maintainer of three libraries ' +
                      'with combined 25k stars on GitHub.';
        const out = truncateResumeSummary(input);
        assert.ok(!out.endsWith('…'), `Output must NOT end with ellipsis: ${out}`);
        assert.match(out, /[.!?]$/);
        assert.ok(out.length <= SUMMARY_CHAR_CAP);
    });

    test('summary fills approximately 3 lines at fontSize 11 / lineHeight 1.55 / ~360px', () => {
        // Sanity check that the cap maps to the visual target.
        // ~70 chars per line × 3 lines = 210 chars target.
        const input = 'Senior full-stack engineer with five years building AI products. ' +
                      'I have shipped user-facing features across desktop and web platforms. ' +
                      'Now I lead a small team on a generative coding tool.';
        const out = truncateResumeSummary(input);
        // Should be at-or-near the cap to fill 3 lines.
        assert.ok(out.length >= 180,
            `Expected near-cap length for 3-line fill, got ${out.length}`);
        assert.ok(out.length <= SUMMARY_CHAR_CAP);
    });
});