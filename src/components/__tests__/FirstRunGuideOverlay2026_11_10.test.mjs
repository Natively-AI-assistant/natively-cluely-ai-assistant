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
    '[data-guide="what-to-answer"]', "'Not on a call? Play any interview video, or ask a question out loud.'",
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
test('the guide is option D: clear glass, no colour, never the old purple', () => {
  for (const f of ['src/components/guide/guide.css', 'src/components/guide/GuideCard.tsx',
    'src/components/guide/OverlayGuide.tsx', 'src/components/guide/NotesGuide.tsx', 'src/components/guide/LauncherGuide.tsx',
    'src/components/guide/SettingsGuide.tsx']) {
    const src = read(f);
    assert.ok(!/7C5CFF|124, ?92, ?255|B9A6FF|6A4FE0|3d2a9e|ece6ff/i.test(src), `${f} has no old purple`);
  }
  const css = read('src/components/guide/guide.css');
  // Evin picked D of five (2026-11-15): monochrome. White in dark, near-black in light.
  assert.ok(css.includes('--gt-accent: #ffffff;') && css.includes('--guide-ring: 255, 255, 255;'), 'white accent and ring in dark');
  assert.ok(css.includes('--gt-accent: #1d1d1f;') && css.includes('--guide-ring: 29, 29, 31;'), 'near-black in light');
  assert.ok(css.includes('--lg-lav-bg: #ffffff;') && css.includes('--lg-lav-fg: #111113;'), 'Next is white with a dark label');
});

// Evin, 2026-11-15: the meeting overlay and the notepad are separate steps.
test('step 2 is the meeting overlay itself, with Next', () => {
  const g = read('src/components/guide/OverlayGuide.tsx');
  for (const s of ["guideOn(state, 'overlay')", "tr('This is your meeting overlay.')",
    "tr('Answers, screenshots and chat show up here, over your call.')", "dispatch({ type: 'overlay_next' })"]) assert.ok(g.includes(s), s);
  // Step 5's hand-off to the notepad is main's (firstRunGuideWiring.test.mjs).
});

// Evin, 2026-11-15: the dot-and-pill progress "looks horrendous", then "i didnt
// like the ui of the guide, redesign it". The launcher and Settings steps are a
// TipKit-style tip: an arrow to the control, a surface inverted against the page,
// icon + title + one line + one action, a ✕ that skips, a quiet "N of 8".
test('the launcher and Settings steps are a tip that points at its control', () => {
  const c = read('src/components/guide/GuideCard.tsx');
  assert.ok(c.includes('className="guide-tip-arrow"'), 'an arrow joins the tip to its control');
  assert.ok(/arrowX = Math\.max\(ARROW_INSET, Math\.min\(width - ARROW_INSET, centre - left\)\)/.test(c), 'the arrow follows the control, not the tip');
  assert.ok(c.includes("tr('{n} of {total}')"), 'the count the other surfaces use');
  assert.ok(!c.includes('eyebrow') && !c.includes('guide-dot') && !/length: GUIDE_STEP_COUNT/.test(c), 'no kicker label, no dots');
  assert.ok(c.includes("aria-label={tr('Skip guide')}"), 'the ✕ skips the guide');
  assert.ok(c.includes('disabled={action.disabled}'), 'a real disabled button');
  const css = read('src/components/guide/guide.css');
  // Evin: "why dark mode not having a dark mode" and "use expo liquid glass":
  // the app's own refracting glass, dark in dark mode, light in light mode.
  // Evin, 2026-11-15: "card isnt liquid glass, i want proper liquid glass with tint".
  assert.ok(c.includes('<GuideGlass radius={18} />'), 'the tip is liquid glass');
  const gg = read('src/components/guide/GuideGlass.tsx');
  for (const s of ['<GlassSurface', 'guide-glass-frost', 'glass-cta__bevel', 'glass-cta__sheen', 'glass-cta__edge']) assert.ok(gg.includes(s), s);
  const glassCss = read('src/components/guide/guide.css');
  assert.ok(/backdrop-filter: var\(--gt-frost\)/.test(glassCss) && (glassCss.match(/--gt-tint:/g) || []).length === 2, 'frosted, with a tint per theme');
  // Seen live: at a 62% tint a card's text read through the tip. Frosted.
  assert.ok(/--gt-frost: blur\(22px\)/.test(glassCss), 'the tip body is frosted, not clear');
  assert.ok(c.includes('<LiquidGlassButton variant="lavender"'), 'the action is the app glass button');
  assert.ok(css.includes('--gt-ink: rgba(255, 255, 255, 0.95);') && css.includes('--gt-ink: #1d1d1f;'), 'ink set per theme: white on dark glass, near-black on light');
  const lg = read('src/components/guide/LauncherGuide.tsx');
  assert.ok(lg.includes('<GuideGlass radius={22} />') && lg.includes('<LiquidGlassButton variant="lavender"'), 'the Continue pill is the same glass');
  // Evin: "stop using generic icons or logos".
  assert.ok(!/lucide-react'/.test(c) || /import \{ Check, X \} from 'lucide-react';/.test(c), 'only the done tick and the close');
  assert.ok(!c.includes('STEP_ICON') && !css.includes('.guide-tip-icon'), 'no step icon');
  assert.ok(css.includes('.guide-tip.guide-enter { animation: guideTipGrow var(--g-open) var(--g-spring) backwards; }'), 'it grows out of its arrow, transform only');
  for (const f of ['src/components/guide/GuideCard.tsx', 'src/components/guide/LauncherGuide.tsx', 'src/components/guide/SettingsGuide.tsx']) {
    const src = read(f);
    assert.ok(!src.includes('LavenderButton'), `${f}: no onboarding lavender button`);
    assert.ok(!/eyebrow=|place="below"|\bdy=\{/.test(src), `${f}: no old card props`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'src/components/guide/guideStyle.tsx')), 'the old accent module is gone');
});

// Meeting 2 is the notepad's: type, Ask, a recipe, stop. Each lights the real
// control and moves on from what the notes window really did.
test('the notepad steps light Ask, the recipes and Stop, and move on from the real thing', () => {
  const g = read('src/components/guide/NotesGuide.tsx');
  for (const s of ['[data-guide="notes-ask"]', '[data-guide="notes-recipes"]', '[data-guide="notes-stop"]',
    "type: 'note_typed'", "type: 'ask_opened'", "type: 'recipe_run'"]) assert.ok(g.includes(s), s);
  const w = read('src/components/NotesWindow.tsx');
  assert.ok(w.includes('data-guide="notes-ask"') && w.includes('data-guide="notes-recipes"'), 'the anchors exist');
  assert.ok(/npTrack\('recipe', recipe\.id\);\n\s+guideRecipeRunRef\.current\(\);/.test(w), 'every recipe run reports, chip, All recipes or /');
  assert.ok(w.includes("[askOpen, phase, notesGuide.live, notesGuide.onAskOpened]"), 'Ask opening reports, also when step 10 arrives with Ask open');
  assert.ok(read('src/components/settings/OverlaySettings.tsx').includes('data-guide="surface-switch"'), 'step 7 points at the switch');
});

test('the launcher has the second Start and the notepad meeting\'s notes, and goes Home for it', () => {
  const l = read('src/components/guide/LauncherGuide.tsx');
  for (const s of ['stepId="start2"', 'stepId="notes2"', "surface: 'overlay'", 'onShowHome();']) assert.ok(l.includes(s), s);
  const launcher = read('src/components/Launcher.tsx');
  assert.ok(launcher.includes("| { kind: 'home'; seq: number }") && launcher.includes("request.kind === 'home'"));
  assert.ok(read('src/App.tsx').includes('onShowHome={openLauncherHome}'));
});


// Evin, 2026-11-15, at step 5: "show the stop button". It is in the top pill,
// a window of its own, so that window lights it.
test('step 5 lights the Stop button in the top pill window', () => {
  const pill = read('src/components/ui/TopPill.tsx');
  assert.equal((pill.match(/data-guide="overlay-stop"/g) || []).length, 2, 'both pill layouts');
  const aux = read('src/components/OverlayAuxWindows.tsx');
  assert.ok(aux.includes(`useGuideLit(guideOn(guide.state, 'stop') && !guide.justDone ? '[data-guide="overlay-stop"]' : null);`));
  assert.ok(aux.includes("import './guide/guide.css';"), 'the ring style loads in that window');
});

// A notes step whose saved meeting never came (save failed, or a quit between
// Stop and the save) must not leave nothing on screen: the way back moves on.
test('a notes step with no saved meeting offers to go on', () => {
  const l = read('src/components/guide/LauncherGuide.tsx');
  assert.ok(l.includes('onNotes && !endedMeetingId ? NO_NOTES_MS : OFF_SCREEN_MS'), 'waits for the save, then offers the way on');
  assert.ok(l.includes("if (onNotes && !endedMeetingId) dispatch({ type: 'notes_next' });"), 'and the way on passes the notes step');
});

// Evin, 2026-11-15: "i want apple like animations". The surface moves by
// transform only (a fade on it would cut the frost); each glass layer fades
// itself; a step leaves before the next arrives; the lit ring closes in.
test('guide motion: Apple-like, and never fades the box that holds the frost', () => {
  const css = read('src/components/guide/guide.css');
  for (const k of ['guideTipGrow', 'guidePillRise', 'guideLitIn', 'guideDraw', 'guideTextIn']) assert.ok(css.includes(`@keyframes ${k}`), k);
  assert.ok(!/@keyframes guideTipGrow[^}]*opacity/.test(css) && !/@keyframes guidePillRise[^}]*opacity/.test(css), 'the surface itself never fades');
  assert.ok(css.includes('[data-guide-leaving] .guide-tip {'), 'tips leave');
  assert.ok(!/box-shadow:[^;]*!important/.test(css.slice(css.indexOf('[data-guide-lit]'))), 'no important ring, so the ring can animate');
  assert.ok(css.includes('guideLit 2.8s ease-in-out 520ms 2;'), 'breathes twice, then holds still');
  const g = read('src/components/guide/useGuide.ts');
  assert.ok(g.includes('DONE_MS - LEAVE_MS') && g.includes("next.status === 'skipped'"), 'leaves at the end of the hold; a skip leaves at once');
  assert.ok(!read('src/components/guide/LauncherGuide.tsx').includes("transform: 'translateX(-50%)'"), 'the pill is centred without a transform');
});
