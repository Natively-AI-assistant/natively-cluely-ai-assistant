// Two review-modal defects found by code review on 2026-08-12, pinned as
// source contracts (this component has no render harness in the repo; its
// sibling suite pins the composition the same way).
//
//  1. EXIT ANIMATIONS COULD NEVER RUN. `if (!isOpen) return null` sat ABOVE the
//     <AnimatePresence>, so closing unmounted the presence boundary together
//     with its children on the next render. AnimatePresence can only animate
//     children it outlives — it cannot animate its own unmount — so both `exit`
//     variants were dead code and the modal hard-cut. The parent
//     (ReviewPromptHost) renders <ReviewModal> unconditionally, so the boundary
//     can simply stay mounted and the CHILDREN come and go.
//
//  2. THE MODAL OPENED PRE-RATED. The open effect focuses star 1 so keyboard
//     users land in the rail, but each star's onFocus paints a hover preview —
//     so the modal opened showing a 1-star "Poor" verdict the user never chose,
//     with Send disabled (it keys on `rating`, not `hoverRating`) and no way to
//     clear it without a mouse. Landing focus is a placement, not an opinion.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODAL = readFileSync(join(HERE, '../ReviewModal.tsx'), 'utf8');
/** Strip comments so prose describing the OLD behaviour can't satisfy a check. */
const LIVE = MODAL.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('Review modal — open/close state', () => {
    test('the presence boundary outlives the modal, so exit variants can run', () => {
        assert.doesNotMatch(LIVE, /if\s*\(\s*!isOpen\s*\)\s*return\s+null/,
            'an early return above <AnimatePresence> unmounts the boundary with its children; exit animations become dead code');
    });

    test('the animated children are what mount and unmount', () => {
        const presenceStart = LIVE.indexOf('<AnimatePresence>');
        assert.ok(presenceStart >= 0, 'the modal must still use AnimatePresence');
        const body = LIVE.slice(presenceStart);
        assert.match(body, /\{isOpen\s*&&\s*\(/,
            'backdrop and container must be conditional CHILDREN of AnimatePresence');
    });

    test('both animated children still declare an exit variant', () => {
        for (const key of ['backdrop', 'container']) {
            const at = LIVE.indexOf(`key="${key}"`);
            assert.ok(at > 0, `the ${key} motion element is missing`);
            assert.match(LIVE.slice(at, at + 600), /exit=\{/, `${key} lost its exit variant`);
        }
    });

    test('landing focus on the first star does not paint a rating', () => {
        // The guard must wrap the FOCUS handler specifically: mouse hover still
        // previews, and a genuine keyboard focus still previews.
        const at = LIVE.indexOf('onFocus=');
        assert.ok(at > 0, 'the star focus handler is missing');
        assert.match(LIVE.slice(at, at + 220), /suppressStarFocusPreview\.current/,
            'a programmatic focus must not set hoverRating');
        assert.match(LIVE, /onMouseEnter=\{\(\)\s*=>\s*!submitting\s*&&\s*setHoverRating\(n\)\}/,
            'mouse hover preview must be unchanged');
    });

    test('the suppression flag is set and cleared around the synthetic focus only', () => {
        const effect = LIVE.slice(LIVE.indexOf('data-review-star="1"') - 400, LIVE.indexOf('data-review-star="1"') + 400);
        assert.match(effect, /suppressStarFocusPreview\.current\s*=\s*true/);
        assert.match(effect, /suppressStarFocusPreview\.current\s*=\s*false/,
            'the flag must be cleared in the same turn, or the first genuine focus is swallowed');
    });

    test('Send still keys on the CHOSEN rating, never the preview', () => {
        assert.match(LIVE, /const\s+canSubmit\s*=[^\n]*\brating\b/);
        assert.doesNotMatch(LIVE, /const\s+canSubmit\s*=[^\n]*hoverRating/);
    });
});
