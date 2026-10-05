// Guards the stealth-typing caret mirror (NativelyInterface.tsx + index.css).
//
// While the stealth hook is engaged (every click on Windows) the chat input is
// read-only and never DOM-focused, so the caret is drawn by `.nat-caret-mirror`,
// a layer laid over the input. These bugs affected it:
//
//   1. `font: inherit` on .nat-caret-mirror, emitted after `@tailwind
//      utilities`, overrode its `text-[13px] leading-relaxed`: the mirror
//      measured text at 16px while the input drew 13px, so the caret drifted
//      ~1.5px per character.
//   2. The mirror carried `appearance.inputStyle` — the input's translucent
//      background — on TOP of the input, veiling the typed text while engaged;
//      it snapped back to full contrast when the session ended.
//   3. The mirror stayed on one flex row when the input became a textarea,
//      and the unfocused input did not scroll down to newly appended text.
//   4. Resizing an unchanged draft scrolled to the end instead of preserving
//      the user's reading position (PR #337 review).
//
// Measured in Electron (dev:agent) after the fix: caret − end-of-text = 0px for
// short, long (overflowing) and trailing-space text, dark and light.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = strip(readFileSync(join(here, '../../index.css'), 'utf8'));
const TSX = readFileSync(join(here, '../NativelyInterface.tsx'), 'utf8');

describe('stealth caret mirror', () => {
    test('mirror rule does not override its own font size with a font shorthand', () => {
        const m = CSS.match(/\.nat-caret-mirror\s*\{([^}]*)\}/);
        assert.ok(m, '.nat-caret-mirror rule not found');
        assert.ok(!/(^|[;\s])font\s*:/.test(m[1]), '.nat-caret-mirror sets `font:` — it resets the 13px size');
        assert.ok(!/font-size\s*:/.test(m[1]), '.nat-caret-mirror sets font-size — it must match the input via classes');
    });

    test('mirror carries the same type classes as the input', () => {
        const input = TSX.match(/data-testid="overlay-chat-input"[\s\S]*?className=\{`([^`]*)`/);
        const mirror = TSX.match(/className="nat-caret-mirror ([^"]*)"/);
        assert.ok(input && mirror, 'input or mirror markup not found');
        for (const cls of ['pl-3', 'pr-10', 'py-2.5', 'text-[13px]', 'leading-relaxed']) {
            assert.ok(input[1].includes(cls), `input lost ${cls}`);
            assert.ok(mirror[1].split(/\s+/).includes(cls), `mirror lost ${cls}`);
        }
    });

    test('mirror paints no surface over the typed text', () => {
        const i = TSX.indexOf('className="nat-caret-mirror');
        const tag = TSX.slice(TSX.lastIndexOf('<div', i), TSX.indexOf('>', i));
        assert.ok(!/style=/.test(tag), 'the caret mirror must not take an inline style (inputStyle veils the text)');
    });

    test('input and mirror share wrapping and the final visible line', () => {
        const rule = CSS.match(/\.nat-caret-mirror\s*\{([^}]*)\}/)[1];
        assert.match(rule, /display:\s*block/);
        assert.match(rule, /white-space:\s*pre-wrap/);
        assert.match(rule, /overflow-wrap:\s*break-word/);
        assert.match(TSX, /mirror\.style\.width = `\$\{input\.clientWidth \+ borders\}px`/);
        assert.match(TSX, /new ResizeObserver\(syncCaretViewport\)/);
        assert.match(TSX, /ref=\{caretMirrorRef\}/);
    });
});

// Execute the actual layout-effect body so these regressions exercise source
// behavior without mounting the Electron-backed interface or copying its logic.
const mirrorEffect = [...TSX.matchAll(/useLayoutEffect\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/g)]
    .find((match) => match[1].includes('const mirror = caretMirrorRef.current;'));
assert.ok(mirrorEffect, 'caret mirror layout effect not found');
const runMirrorEffect = new Function(
    'textInputRef', 'caretMirrorRef', 'stealthTapActive', 'getComputedStyle', 'ResizeObserver',
    mirrorEffect[1],
);

function viewport(active = true, missingRef) {
    const input = { style: {}, clientWidth: 260, offsetHeight: 112, scrollHeight: 800, scrollLeft: 25 };
    let scrollTop = 0;
    Object.defineProperty(input, 'scrollTop', {
        get: () => scrollTop,
        set: (value) => { scrollTop = Math.max(0, Math.min(value, input.scrollHeight - input.offsetHeight)); },
    });
    const mirror = { style: {}, scrollLeft: 0, scrollTop: 0 };
    const observers = [];
    class Observer {
        constructor(callback) {
            this.callback = callback;
            this.disconnected = false;
            observers.push(this);
        }
        observe(node) { assert.equal(node, input); }
        disconnect() { this.disconnected = true; }
    }
    const render = () => runMirrorEffect(
        { current: missingRef === 'input' ? null : input },
        { current: missingRef === 'mirror' ? null : mirror },
        active,
        () => ({ borderLeftWidth: '1px', borderRightWidth: '1px' }),
        Observer,
    );
    const cleanup = render();
    return { input, mirror, observers, cleanup, render, resize: () => observers.at(-1).callback() };
}

describe('stealth caret viewport', () => {
    test('new text follows the final line and synchronizes the mirror without focus', () => {
        const { input, mirror } = viewport();
        assert.equal(input.scrollTop, 688);
        assert.equal(input.scrollLeft, 0);
        assert.equal(mirror.scrollTop, 688);
        assert.equal(mirror.scrollLeft, 0);
        assert.equal(mirror.style.width, '262px');
        assert.equal(mirror.style.height, '112px');
    });

    test('resize preserves the reading position while updating mirror dimensions and scroll', () => {
        const { input, mirror, resize } = viewport();
        input.scrollTop = 75;
        input.scrollLeft = 9;
        input.clientWidth = 190;
        input.offsetHeight = 100;
        resize();
        assert.equal(input.scrollTop, 75, 'resizing unchanged text must preserve the reading position');
        assert.equal(input.scrollLeft, 9);
        assert.equal(mirror.scrollTop, 75);
        assert.equal(mirror.scrollLeft, 9);
        assert.equal(mirror.style.width, '192px');
        assert.equal(mirror.style.height, '100px');
    });

    test('appended text follows the final line again after reading earlier text', () => {
        const { input, mirror, cleanup, render } = viewport();
        input.scrollTop = 75;
        input.scrollHeight = 900;
        cleanup();
        const nextCleanup = render();
        assert.equal(input.scrollTop, 788);
        assert.equal(mirror.scrollTop, 788);
        nextCleanup();
    });

    test('cleanup disconnects the observer', () => {
        const { observers, cleanup } = viewport();
        cleanup();
        assert.equal(observers[0].disconnected, true);
    });

    test('inactive stealth input and missing refs cause no scrolling or observer', () => {
        for (const [active, missingRef] of [[false], [true, 'input'], [true, 'mirror']]) {
            const { input, observers, cleanup } = viewport(active, missingRef);
            assert.equal(input.scrollTop, 0);
            assert.equal(input.scrollLeft, 25);
            assert.equal(observers.length, 0);
            assert.equal(cleanup, undefined);
        }
    });
});
