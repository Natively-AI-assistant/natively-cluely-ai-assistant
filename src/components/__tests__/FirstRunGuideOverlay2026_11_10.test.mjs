// First-run guide, overlay side: steps 2 and 3, the notepad hand-off and the
// stop prompt, in a banner fold of the overlay's own layout.
// Run: node --test src/components/__tests__/FirstRunGuideOverlay2026_11_10.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the overlay has a guide fold, asks the picker for it, and marks What to answer', () => {
  const ov = read('src/components/NativelyInterface.tsx');
  assert.ok(ov.includes('testId="fold-guide"'));
  assert.ok(/guide: overlayGuide\.wants,/.test(ov), 'the strip asks the banner picker for a slot');
  const marks = ov.split("data-guide={id === 'what_to_answer' ? 'what-to-answer' : undefined}").length - 1;
  assert.equal(marks, 2, 'both chip styles (lavender glass and plain) carry the anchor');
});

test('OverlayGuide reports answers and screenshots and teaches the real keys', () => {
  const g = read('src/components/guide/OverlayGuide.tsx');
  for (const s of ["type: 'answer_shown'", "type: 'screenshot_taken'", 'onIntelligenceSuggestedAnswer', 'onIntelligenceManualResult',
    'onScreenshotTaken', 'onScreenshotAttached', "'chat:whatToAnswer'", "'general:take-screenshot'", "'general:selective-screenshot'",
    '[data-guide="what-to-answer"]', 'notesWindowToggle', "'Not on a call? Play any interview video, or ask a question out loud.'",
    "'They just asked you something.'", "'Show Natively your screen.'", "'Stop the meeting when you’re ready.'"]) {
    assert.ok(g.includes(s), s);
  }
  assert.ok(!/\.focus\(|autoFocus/.test(g), 'the strip never takes focus from the call');
});

// Evin, 2026-11-10, on the first strip: "ui is messy". The overlay's steps are
// the overlay's own banner (ui/OverlayBanner.tsx: neutral body, glass mark,
// title + one line, trailing actions, plain ✕), in a lavender guide tone, not a
// hand-drawn purple block with a stacked right-hand column.
test('the overlay steps are OverlayBanners in the guide tone, one line under the title', () => {
  const g = read('src/components/guide/OverlayGuide.tsx');
  assert.ok(g.includes('<OverlayBanner'), 'built from the overlay banner');
  assert.ok(!g.includes('<GuideStrip'), 'not the hand-drawn strip');
  assert.ok(g.includes("tone={done ? 'ok' : 'guide'}"));
  assert.ok(g.includes('className="ov-banner-keys"'), 'keycaps in the banner style');
  assert.ok(g.includes("dismissLabel={tr('Skip guide')}"), 'the ✕ skips the guide');
  assert.ok(!g.includes("tr('Waiting for you')"), 'no waiting dot: the lit chip says it');
  assert.ok(g.includes('useGuideLit('), 'still lights What to answer');
  const b = read('src/components/ui/OverlayBanner.tsx');
  assert.ok(/OverlayBannerTone = 'warning' \| 'error' \| 'ok' \| 'guide'/.test(b));
  const css = read('src/components/guide/guide.css');
  assert.ok(/\[data-tone='guide'\]/.test(css) && /168, 184, 255/.test(css), 'the guide tone is periwinkle ice');
  assert.ok(/\[data-theme='light'\][^{]*\[data-tone='guide'\]/.test(css), 'and has a light-theme mark');
});

// Evin, 2026-11-15: "use softer periwinkle ice color as accent". No purple left
// anywhere in the guide.
test('the guide accent is a soft periwinkle ice, not the old purple', () => {
  for (const f of ['src/components/guide/guide.css', 'src/components/guide/GuideCard.tsx',
    'src/components/guide/OverlayGuide.tsx', 'src/components/guide/NotesGuide.tsx', 'src/components/guide/LauncherGuide.tsx',
    'src/components/guide/SettingsGuide.tsx']) {
    const src = read(f);
    assert.ok(!/7C5CFF|124, ?92, ?255|B9A6FF|6A4FE0|3d2a9e|ece6ff/i.test(src), `${f} has no old purple`);
  }
  assert.ok(read('src/components/guide/guide.css').includes('--guide-accent: 168, 184, 255;     /* #A8B8FF, periwinkle ice */'));
});

// Evin, 2026-11-15: the meeting overlay and the notepad are separate steps.
test('step 2 is the meeting overlay itself, with Next', () => {
  const g = read('src/components/guide/OverlayGuide.tsx');
  for (const s of ["guideOn(state, 'overlay')", "tr('This is your meeting overlay.')",
    "tr('Answers, screenshots and chat show up here, over your call.')", "dispatch({ type: 'overlay_next' })"]) assert.ok(g.includes(s), s);
  // Step 5's hand-off to the notepad is main's (firstRunGuideWiring.test.mjs).
});

// Evin, 2026-11-15, on the card's dot-and-pill progress: "this looks horrendous".
// The card is Settings' own parts: its card tokens, its button shape, and the
// same "N of 8" count as the overlay banner and the notepad pill.
test('the floating card is built from Settings parts, with a plain step count', () => {
  const c = read('src/components/guide/GuideCard.tsx');
  assert.ok(!c.includes('guide-dot') && !/Array\.from\(\{ length: GUIDE_STEP_COUNT/.test(c), 'no progress dots');
  assert.ok(c.includes("tr('{n} of {total}')"), 'the count the other surfaces use');
  for (const s of ['bg-bg-card', 'border-border-subtle', 'text-text-secondary', 'text-text-tertiary', "from '../settings/SettingsRow'"]) assert.ok(c.includes(s), s);
  assert.ok(c.includes('disabled={action.disabled}'), 'a real disabled button, not a faded span');
  for (const f of ['src/components/guide/GuideCard.tsx', 'src/components/guide/LauncherGuide.tsx']) {
    assert.ok(!read(f).includes('LavenderButton'), `${f}: no onboarding lavender button`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'src/components/guide/guideStyle.tsx')), 'the old accent module is gone');
});
