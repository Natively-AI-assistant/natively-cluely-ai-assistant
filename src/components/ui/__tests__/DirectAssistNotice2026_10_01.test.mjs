// DirectAssistNotice — the overlay rules it has to keep (2026-10-01).
//
// The component is small and visual; what can regress silently is not its
// layout but the overlay-window rules it was written around. Each assertion
// below is one of those rules, with the reason it exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(dirname, '../DirectAssistNotice.tsx'), 'utf8');
// What the component DOES, not what its comments say about what it avoids.
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

test('colours follow the APP theme, never the OS', () => {
  // Tailwind `dark:` is media-based here (prefers-color-scheme); the app theme
  // is token-based. A dark OS with the light app theme would get the wrong one.
  assert.doesNotMatch(code, /\bdark:/);
  assert.match(code, /overlay-text-primary/);
  assert.match(code, /isLightTheme \? 'text-amber-600' : 'text-amber-400'/);
  assert.match(code, /isLightTheme \? 'text-red-600' : 'text-red-400'/);
});

test('no native tooltip, no outer shadow, no emoji standing in for an icon', () => {
  // Native tooltips get their own window in the overlay; an outer shadow is
  // clipped by the exact-content-sized window.
  assert.doesNotMatch(code, /\btitle=/);
  assert.doesNotMatch(code, /\bshadow-/);
  assert.doesNotMatch(code, /[\u{2600}-\u{27BF}\u{1F300}-\u{1FAFF}]/u);
  assert.match(code, /from 'lucide-react'/);
});

test('the quietest text is never the low-contrast muted token', () => {
  // Measured in the overlay: the primary token at 76% is 4.79:1 on the dark
  // panel and 6.4:1 on the light one. The muted token is about 3:1 on light.
  assert.doesNotMatch(code, /overlay-text-muted/);
  assert.match(code, /opacity-\[0\.76\]/);
});

test('a failure is announced; a footnote to an answer that arrived is not', () => {
  assert.match(code, /role=\{failed \|\| view\.tone === 'cutoff' \? 'alert' : 'status'\}/);
});

test('one action, the shared overlay button, and never while the next provider is still being tried', () => {
  assert.match(code, /view\.fixable && view\.tone !== 'trying'/);
  assert.equal((code.match(/<OverlayBannerButton/g) || []).length, 1);
  assert.match(code, /from '\.\/OverlayBanner'/);
});

test('it words nothing itself: every string comes in already translated', () => {
  // The only text nodes are the view's fields and the passed-in label.
  const literals = [...code.matchAll(/>\s*([A-Za-z][^<>{}]*?)\s*</g)].map((match) => match[1].trim()).filter(Boolean);
  assert.deepEqual(literals, []);
  assert.match(code, /\{view\.headline\}/);
  assert.match(code, /\{row\.text\}/);
  assert.match(code, /\{actionLabel\}/);
});
