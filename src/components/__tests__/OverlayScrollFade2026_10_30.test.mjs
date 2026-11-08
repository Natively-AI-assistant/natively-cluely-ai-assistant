// src/components/__tests__/OverlayScrollFade2026_10_30.test.mjs
//
// The overlay's answer area fades out where it scrolls instead of slicing a
// bubble with a straight line above the buttons (the owner, 2026-10-30). A
// mask on the scroller, its two lengths set by scroll-driven animations: up
// to 24px at the head and 32px at the foot, each growing with the distance to
// its end, so the newest answer at the bottom is whole and an answer that
// fits gets no fade.
//
// Source reads only. In headless Chrome, at the bottom the lengths read
// 24px / 0px, mid-scroll 24px / 32px, at the top 0px / 32px, and 10px from
// the bottom the foot is 10px. The CSS has no platform branch.
//
// Run: node --experimental-strip-types --test src/components/__tests__/OverlayScrollFade2026_10_30.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, '../..');
const overlay = fs.readFileSync(path.join(src, 'components/NativelyInterface.tsx'), 'utf8');
const css = fs.readFileSync(path.join(src, 'index.css'), 'utf8');

test('the answer scroller carries the fade', () => {
  assert.match(overlay, /ref=\{scrollContainerRef\}\s*className=\{`overlay-scroll-fade /);
});

test('each fade follows the distance to its end, over the last 32px and first 24px', () => {
  assert.match(css, /@keyframes ov-scroll-fade-top \{ to \{ --ov-fade-top: 24px; \} \}/);
  assert.match(css, /@keyframes ov-scroll-fade-bottom \{ from \{ --ov-fade-bottom: 32px; \} to \{ --ov-fade-bottom: 0px; \} \}/);
  assert.match(css, /animation-timeline: scroll\(self y\), scroll\(self y\);/);
  assert.match(css, /animation-range: 0px 24px, calc\(100% - 32px\) 100%;/);
});

test('both lengths start at 0, so an answer that fits has no fade', () => {
  assert.match(css, /@property --ov-fade-top \{ syntax: "<length>"; inherits: false; initial-value: 0px; \}/);
  assert.match(css, /@property --ov-fade-bottom \{ syntax: "<length>"; inherits: false; initial-value: 0px; \}/);
});

// Without scroll timelines the two animations would run at once to their end
// and leave a fade at the head for good.
test('the fade only applies where scroll timelines exist', () => {
  const guarded = css.slice(css.indexOf('@supports (animation-timeline: scroll()) {\n  .overlay-scroll-fade {'));
  assert.ok(guarded.length > 0);
  assert.match(guarded.slice(0, 800), /mask-image: linear-gradient\(to bottom, transparent 0, #000 var\(--ov-fade-top\), #000 calc\(100% - var\(--ov-fade-bottom\)\), transparent 100%\);/);
});
