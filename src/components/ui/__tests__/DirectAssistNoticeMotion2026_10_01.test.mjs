// DirectAssistNotice motion — the rules it moves by (2026-10-01).
//
// The notice animates on the transitions.dev motion-token scale and under the
// meeting overlay's own motion rules (the `@overlay-motion` block in
// index.css). Motion is visual, but the rules that keep it from breaking the
// overlay are checkable from the source, and each one below has cost a bug
// here before.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const cssSource = fs.readFileSync(path.resolve(dirname, '../DirectAssistNotice.css'), 'utf8');
const tsxSource = fs.readFileSync(path.resolve(dirname, '../DirectAssistNotice.tsx'), 'utf8');
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const css = stripComments(cssSource);
const tsx = stripComments(tsxSource).split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');

// The transitions.dev scale (skills/transitions-dev, "Motion tokens").
const DURATIONS = ['40ms', '80ms', '150ms', '250ms', '350ms', '400ms', '500ms'];
const EASINGS = [
  'cubic-bezier(0.22, 1, 0.36, 1)',     // --ease-smooth-out
  'cubic-bezier(0.34, 1.36, 0.64, 1)',  // --ease-bounce
  'ease-in-out',
  'ease-out',
  'linear',
];

test('inside the overlay card only transform, opacity and filter move', () => {
  // Animating a size would feed the viewport ResizeObserver every frame and
  // fight the card's own 300ms height tween.
  const transitions = [...css.matchAll(/transition:\s*([^;]+);/g)].map((match) => match[1]);
  assert.ok(transitions.length >= 3, 'the stylesheet declares its transitions');
  for (const declaration of transitions) {
    if (declaration.trim() === 'none !important') continue;
    for (const part of declaration.split(/,(?![^(]*\))/)) {
      const property = part.trim().split(/\s+/)[0];
      assert.ok(['opacity', 'transform', 'filter'].includes(property), `"${property}" must not be transitioned`);
    }
  }
  assert.doesNotMatch(css, /transition:\s*all\b/);
  assert.doesNotMatch(css, /\b(?:height|width|margin|padding|top|left|max-height)\s+\d+ms/);
});

test('every duration and easing is on the motion-token scale', () => {
  for (const [, value] of css.matchAll(/(?<![\w.-])(\d+ms)\b/g)) {
    assert.ok(DURATIONS.includes(value), `${value} is not a token duration`);
  }
  for (const [value] of css.matchAll(/cubic-bezier\([^)]*\)/g)) {
    assert.ok(EASINGS.includes(value), `${value} is not a token easing`);
  }
  // Text reveal: 500ms, 12px, 3px blur (--duration-very-slow, --distance-medium, --blur-medium).
  assert.match(css, /--notice-reveal-dur:\s*500ms;/);
  assert.match(css, /--notice-reveal-distance:\s*12px;/);
  assert.match(css, /--notice-reveal-blur:\s*3px;/);
  assert.match(css, /--notice-stagger:\s*40ms;/);
  // The token each literal maps to is named beside it, as in the overlay block.
  for (const name of ['--duration-very-slow', '--distance-medium', '--blur-medium', '--duration-stagger', '--ease-smooth-out', '--ease-bounce', '--duration-micro']) {
    assert.ok(cssSource.includes(name), `${name} is named beside the literal it stands for`);
  }
});

test('entrances play once, on insertion, and nothing loops that this file owns', () => {
  // @starting-style, like every other entrance in the overlay: it never
  // replays on a re-render or when the overlay is hidden and shown again.
  assert.ok((css.match(/@starting-style/g) || []).length >= 3);
  assert.doesNotMatch(css, /@keyframes/, 'the one loop (the trying shimmer) is the overlay\'s existing one');
  assert.doesNotMatch(css, /animation:/);
  assert.doesNotMatch(tsx, /from 'framer-motion'/, 'CSS only, like the rest of the overlay block');
});

test('the stagger never makes the last line late', () => {
  // 40ms a line; the index is capped so the whole reveal starts within 300ms
  // however many providers failed.
  const cap = Number(/const MAX_STAGGER_STEPS = (\d+);/.exec(tsx)?.[1]);
  assert.ok(Number.isInteger(cap) && cap > 0, 'the component caps the stagger index');
  assert.ok(cap * 40 <= 300, `${cap} steps × 40ms must stay within 300ms`);
  assert.match(tsx, /Math\.min\(\w+, MAX_STAGGER_STEPS\)/);
  assert.match(css, /transition-delay:\s*calc\(var\(--i, 0\) \* var\(--notice-stagger\)\)/);
});

test('nothing moves on hover', () => {
  // Evin's rule for the overlay: a hover highlights in place.
  for (const [, body] of css.matchAll(/[^{}]*:hover[^{}]*\{([^}]*)\}/g)) {
    assert.doesNotMatch(body, /transform|translate|scale/);
  }
});

test('reduced motion drops every transition this file adds', () => {
  const guard = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  for (const selector of ['.ov-notice-line', '.ov-notice-words::before', '.ov-notice-mark']) {
    assert.ok(guard.includes(selector), `${selector} is covered by the reduced-motion guard`);
  }
  assert.match(guard, /transition:\s*none !important/);
});

test('a row keeps its identity when another is put in front of it', () => {
  // A cut-off answer puts the provider that broke off ABOVE the ones that
  // failed earlier. Keyed by position, the old row silently became the new
  // one and the old one "entered" again underneath — the wrong row animated
  // (measured in the overlay). Keyed by what it says, the new row is the one
  // that enters.
  assert.doesNotMatch(tsx, /<li key=\{index\}/);
  assert.match(tsx, /<li\s+key=\{rowKeys\[index\]\}/);
  assert.match(tsx, /const rowKeys = /);
});

test('the trying shimmer sweeps over a readable base, not the muted token', () => {
  // The overlay's "Thinking..." sweep rests on --overlay-text-muted, about
  // 3:1 on the light theme. Here it is a sentence someone reads, so its base
  // is the notice's own quietest text: the primary token at 76%.
  assert.match(
    css,
    /\.ov-notice \.natively-thinking-label \{\s*--natively-thinking-base: color-mix\(in srgb, var\(--overlay-text-primary\) 76%, transparent\);/,
  );
});

test('the component wires the motion the stylesheet defines', () => {
  assert.match(tsx, /import '\.\/DirectAssistNotice\.css';/);
  // "Trying Google…" → "Answered by Google" swaps in place (transitions.dev #04).
  assert.match(tsx, /<SwapText swapKey=\{view\.headline\}>/);
  // While the next provider is tried the headline carries the overlay's own
  // "Thinking..." shimmer, and only then.
  assert.match(tsx, /view\.tone === 'trying' \? 'natively-thinking-label'/);
  // The mark swaps instead of popping when the tone changes under it (#09).
  assert.match(tsx, /className="t-icon-swap\b/);
  assert.match(tsx, /data-state=\{/);
  // A failure's mark pops once; a footnote's does not.
  assert.match(tsx, /ov-notice-mark--pop/);
  // Each line carries its stagger step.
  assert.match(tsx, /'--i'/);
});
