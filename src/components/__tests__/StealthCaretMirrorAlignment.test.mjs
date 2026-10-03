// Guards the stealth-typing caret mirror (NativelyInterface.tsx + index.css).
//
// While the stealth hook is engaged (every click on Windows) the chat input is
// read-only and never DOM-focused, so the caret is drawn by `.nat-caret-mirror`,
// a layer laid over the input. Three things broke it:
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
        assert.match(TSX, /input\.scrollTop = input\.scrollHeight;[\s\S]*mirror\.scrollTop = input\.scrollTop;/);
        assert.match(TSX, /mirror\.style\.width = `\$\{input\.clientWidth \+ borders\}px`/);
        assert.match(TSX, /new ResizeObserver\(syncCaretViewport\)/);
        assert.match(TSX, /ref=\{caretMirrorRef\}/);
    });
});
