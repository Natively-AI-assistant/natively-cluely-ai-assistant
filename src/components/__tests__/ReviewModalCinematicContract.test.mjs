// Guards the review modal's composition and behaviour.
//
// WHY THIS EXISTS. The modal was rebuilt more than once. An early rebuild kept
// the header-bar/body/button-row skeleton and only restyled it, so it read as
// the same UI. The contract below therefore pins what makes the composition
// what it is — two panes with the star art inset on the right, a live verdict
// that tracks the rating, the signature rule instead of a boxed field, one
// layout for both themes — not just the colours, which a restyle could satisfy
// while changing nothing.
//
// The behavioural half pins what must survive any future redesign: the two
// explicit attribution outcomes and their exact payloads, the 5s self-dismiss,
// and ResizeObserver-driven numeric sizing (the previous hand-rolled
// prev-height handoff measured the OUTGOING step and collapsed the last two
// cards to one height).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODAL = readFileSync(join(HERE, '../ReviewModal.tsx'), 'utf8');
// The modal's styles are co-located, NOT in index.css. That is load-bearing:
// index.css is edited concurrently by other work in this repo and these rules
// were twice reverted out from under the component, leaving every class
// unresolved and the modal invisible. Reading the co-located file here also
// means this suite fails loudly if the import is ever dropped.
const CSS = readFileSync(join(HERE, '../ReviewModal.css'), 'utf8');
/** Strip comments so prose about the old design never satisfies an assertion. */
const LIVE_CSS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

describe('Review modal — two-pane composition', () => {
    test('is a two-pane grid, not a stacked card', () => {
        // The column/art split IS the design. A future revert to a single
        // centred column would drop these.
        // The variant class is composed (`review-grid-${variant}`), so assert
        // on the composition plus each variant name passed to StepFrame.
        assert.match(MODAL, /review-grid-\$\{variant\}/);
        for (const variant of ['review', 'credit']) {
            assert.match(MODAL, new RegExp(`variant="${variant}"`), `no StepFrame variant="${variant}"`);
            assert.match(
                LIVE_CSS,
                new RegExp(`\\.review-grid-${variant}\\s*\\{[^}]*grid-template-columns`),
                `.review-grid-${variant} does not define its own column split`,
            );
        }
        assert.match(MODAL, /className="review-art"/);
        assert.match(MODAL, /className="review-column/);
        // No header bar: the close glyph floats over the art panel instead.
        assert.match(LIVE_CSS, /\.review-close\s*\{[^}]*position:\s*absolute/);
    });

    test('each step has its own silhouette', () => {
        // Steps 1-2 share the two-pane grid with the art on both; the art is
        // the same object, so the step swap reads as the copy changing beside
        // a still image.
        const code = MODAL.replace(/\/\*[\s\S]*?\*\//g, '');
        assert.equal((code.match(/<ArtPanel \/>/g) || []).length, 2, 'the art sits on steps 1 and 2');
        assert.match(MODAL, /Review · 1 of 3/);
        assert.match(MODAL, /Rating saved · 2 of 3/);
        // Step 3 deliberately leaves the grid: a terminal receipt has one short
        // message, and the grid left a lone seal adrift beside the art.
        assert.match(MODAL, /className="review-receipt"/);
        assert.match(MODAL, /className="review-seal"/);
        assert.match(LIVE_CSS, /\.review-receipt\s*\{[^}]*text-align:\s*center/);
        assert.doesNotMatch(MODAL, /variant="thanks"/, 'receipt was folded back into the plate grid');
    });

    test('the receipt does not claim a byline when attribution never ran', () => {
        // When the create call returns no id there is nothing to PATCH, so
        // can_use_publicly stays false and NOTHING is published. The receipt
        // used to say "Published as Anonymous Natively user" anyway, which is
        // simply untrue — it must fall back to a rating-only message.
        assert.match(MODAL, /setAttributionSkipped\(true\)/);
        assert.match(MODAL, /attributionSkipped\s*\?/);
        assert.match(MODAL, /Your rating was recorded\./);
        // And it must reset, or the next open inherits the flag.
        assert.match(MODAL, /setAttributionSkipped\(false\)/);
    });

    test('does not accept provenance the main process overrides', () => {
        // review:submit re-derives app_version / platform / hardware_id in the
        // main process and ignores the renderer's values. Accepting them here
        // implied this component controlled provenance when it never did.
        // Strip comments — the removal is deliberately DOCUMENTED in a comment
        // naming these props, which would otherwise fail this assertion.
        const code = MODAL
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^[ \t]*\/\/.*$/gm, '');
        for (const dead of ['hardwareId', 'appVersion', 'buildChannel']) {
            assert.doesNotMatch(code, new RegExp(`\\b${dead}\\b`), `${dead} is dead — main process overrides it`);
        }
        assert.doesNotMatch(code, /hardware_id:/);
    });

    test('the receipt states the exact byline that will be published', () => {
        // Describing the outcome ("your name will run alongside it") is weaker
        // than showing it: the last thing the user sees should be the literal
        // string, so a wrong name is caught here rather than after publication.
        assert.match(MODAL, /const byline\s*=\s*displayNamePublicly && name\.trim\(\)\s*\?\s*name\.trim\(\)\s*:\s*"Anonymous Natively user"/);
        assert.match(MODAL, /className="review-byline"/);
        assert.match(MODAL, /\{byline\}/);
    });

    test('the verdict tracks the live (hover-or-selected) rating', () => {
        // The verdict word is keyed on shownRating so it re-mounts and swaps
        // per value; keying it on `rating` alone would kill the hover preview.
        assert.match(MODAL, /shownRating\s*=\s*hoverRating\s*\|\|\s*rating/);
        assert.match(MODAL, /key=\{shownRating\}/);
        assert.match(MODAL, /className="review-verdict"/);
        assert.match(MODAL, /\{ratingWord\}/);
    });

    test('the name field is a signature rule, not a boxed input', () => {
        assert.match(MODAL, /className="review-signature-input"/);
        assert.match(MODAL, /className="review-signature-rule"/);
        assert.match(LIVE_CSS, /\.review-signature-input:focus \+ \.review-signature-rule/);
    });

    test('keeps the approved attribution outcomes and payloads', () => {
        assert.match(MODAL, /Save with name/);
        assert.match(MODAL, /Keep anonymous/);
        assert.match(MODAL, /name:\s*credited\s*\?\s*\(name\.trim\(\)\s*\|\|\s*null\)\s*:\s*null/);
        assert.match(MODAL, /can_use_publicly:\s*true/);
        assert.match(MODAL, /display_name_publicly:\s*credited/);
        // Save requires a name; Keep anonymous never reads the field.
        assert.match(MODAL, /canSave\s*=\s*!busy\s*&&\s*name\.trim\(\)\.length\s*>\s*0/);
        assert.doesNotMatch(MODAL, /Show my name publicly/);
    });

    test('the confirmation self-dismisses at 5s with no Done button', () => {
        // Through closeModal, so the genie plays before the host hears onClose.
        assert.match(MODAL, /window\.setTimeout\(\(\) => closeModal\(\), 5000\)/);
        assert.match(MODAL, /review-thanks-countdown/);
        assert.doesNotMatch(MODAL, />\s*Done\s*</);
    });

    test('sizes the shell from ResizeObserver, never a stale previous height', () => {
        assert.match(MODAL, /new ResizeObserver/);
        assert.match(MODAL, /review-modal-measure/);
        assert.match(MODAL, /cardStyle[\s\S]*height:\s*cardHeight/);
        // The hand-rolled handoff that caused the shared-height bug.
        assert.doesNotMatch(MODAL, /useLayoutEffect|prevHeightRef/);
    });

    test('preserves star radiogroup semantics and keyboard navigation', () => {
        assert.match(MODAL, /role="radiogroup"/);
        assert.match(MODAL, /role="radio"/);
        assert.match(MODAL, /aria-checked=\{rating === n\}/);
        assert.match(MODAL, /data-review-star=\{n\}/);
        for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
            assert.match(MODAL, new RegExp(`"${key}"`), `star keyboard nav lost ${key}`);
        }
    });

    test('the stylesheet is co-located and actually imported', () => {
        // The whole reason the modal rendered invisible before: the rules lived
        // in index.css, another agent reverted that file, and every className
        // resolved to nothing. Without this import there is no styling at all.
        assert.match(MODAL, /import\s+["']\.\/ReviewModal\.css["']/);
        assert.doesNotMatch(MODAL, /\bt-resize\b/, 'depends on a class defined in the contested index.css');
    });

    test('animates exact properties with reduced-motion fallbacks', () => {
        // The shell owns its own height transition now (numeric endpoints only —
        // `auto` is not animatable), rather than borrowing a global utility.
        assert.match(LIVE_CSS, /\.review-modal-shell\s*\{[\s\S]*?transition:\s*height\s+300ms/);
        assert.doesNotMatch(LIVE_CSS, /transition:\s*all\b/);
        assert.doesNotMatch(LIVE_CSS, /will-change/);
        const reducedBlocks = LIVE_CSS.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/g) ?? [];
        assert.ok(reducedBlocks.length > 0, 'no reduced-motion block covers the review modal');
        const joined = reducedBlocks.join('\n');
        assert.match(joined, /\.review-art-image::before/);
        assert.match(joined, /\.review-thanks-countdown/);
        assert.match(joined, /\.review-modal-shell/);
    });

    test('one layout for both themes, driven by variables', () => {
        // Every theme difference is a --rv-* variable, so no rule branches on
        // the theme except the variable blocks, the backdrop and the art
        // hairline. The old stylesheet was dark-only.
        assert.match(LIVE_CSS, /\[data-theme='light'\] \.review-modal-shell\s*\{[^}]*--rv-ground:\s*#F7F8FC/);
        assert.match(LIVE_CSS, /\.review-modal-shell\s*\{[^}]*--rv-ground:\s*#1C1C1E/);
        for (const v of ['--rv-strong', '--rv-body', '--rv-quiet', '--rv-faint', '--rv-gold']) {
            assert.match(LIVE_CSS, new RegExp(`\\[data-theme='light'\\] \\.review-modal-shell\\s*\\{[^}]*${v}:`), `light theme does not set ${v}`);
        }
        assert.match(LIVE_CSS, /url\("\.\.\/assets\/cards\/star\.jpg"\)/, 'the art is the star');
    });

    test('the scrim dims without blurring, and nothing idles in a loop', () => {
        // 3a9901ae4: frosting the whole launcher behind the card left it
        // unreadable. And a card waiting for a decision should be still: the
        // countdown is the one animation, and it runs once (`forwards`).
        assert.doesNotMatch(LIVE_CSS, /backdrop-filter/);
        assert.doesNotMatch(LIVE_CSS, /\binfinite\b/);
        assert.doesNotMatch(MODAL, /review-modal-ambient/);
        assert.match(LIVE_CSS, /animation:\s*review-countdown 5s linear forwards/);
    });

    test('labels are sentence case', () => {
        // Tracked-out capitals on buttons and eyebrows shouted the quietest
        // words on the card.
        assert.doesNotMatch(LIVE_CSS, /text-transform:\s*uppercase/);
    });
});
