// Guards the attached-screenshot tray's fold (2026-09-27).
//
// WHY THIS EXISTS. The tray used to be `attachedContext.length > 0 && <div>`.
// The overlay card's height is chrome + chat viewport, and the OS window
// follows the card, so removing a screenshot dropped the card AND the window
// ~130px in one frame. Evin: "the natively overlay abruptly contracts".
//
// Now the tray lives in overlay/ScreenshotTray.tsx inside a ChromeFold, which
// tweens its height and asks the overlay's height channel
// (requestChromeHeightMotion) for one window resize up front instead of one
// per frame. Measured in the headless overlay rig: remove-all went from one
// 130px step to 11 frames (max ~36px), 0 frames with the window shorter than
// the card, one window resize per fold, across all 3 themes x dark/light.
//
// Each of these is easy to undo by accident and invisible in a screenshot.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(HERE, rel), 'utf8');
const host = read('../NativelyInterface.tsx');
const tray = read('../overlay/ScreenshotTray.tsx');
const fold = read('../overlay/ChromeFold.tsx');

describe('screenshot tray fold', () => {
  test('the overlay renders the tray through ScreenshotTray, not a bare conditional', () => {
    assert.match(host, /<ScreenshotTray\b/);
    assert.doesNotMatch(host, /attachedContext\.length > 0 && \(/,
      'a bare `attachedContext.length > 0 && (` tray unmounts in one frame again');
  });

  test('the tray is handed the overlay height channel', () => {
    const el = host.slice(host.indexOf('<ScreenshotTray'), host.indexOf('/>', host.indexOf('<ScreenshotTray')));
    assert.match(el, /requestHeightMotion=\{requestChromeHeightMotion\}/,
      'without it every fold frame is a native setBounds on the glass window');
  });

  test('a thumbnail is removed by path, never by index', () => {
    // A leaving thumbnail is still on screen for its exit; an index-based
    // filter would then delete whichever screenshot slid into that index.
    assert.match(tray, /onRemove\(shot\.path\)/);
    const el = host.slice(host.indexOf('<ScreenshotTray'), host.indexOf('/>', host.indexOf('<ScreenshotTray')));
    assert.match(el, /shot\.path !== path/);
    assert.doesNotMatch(el, /\(_, i\) => i !== idx/);
  });

  test('the fold holds the window for both directions and settles on real completion', () => {
    assert.match(fold, /request\?\.\(grow,/, 'opening must LEAD the window growth');
    assert.match(fold, /request\?\.\(0,/, 'folding must hold the window until the tween ends');
    assert.match(fold, /onExitComplete=\{folded\}/);
    assert.match(fold, /definition !== 'shown' && definition !== 'shownClip'/);
  });

  test('spacing sits inside the animated box, so height 0 leaves no step', () => {
    assert.match(tray, /innerClassName="pb-2"/);
    assert.doesNotMatch(tray, /\bmb-2\b/);
  });

  test('no CSS transition fights framer on the tray or its thumbnails', () => {
    const css = readFileSync(join(HERE, '../../index.css'), 'utf8');
    assert.doesNotMatch(css, /\.ov-tray-in\b|\.ov-thumb-in\b/);
    assert.doesNotMatch(tray, /ov-tray-in|ov-thumb-in/);
  });

  test('nothing folds while the overlay is hidden or only now appearing', () => {
    // A screenshot taken while the overlay is hidden shows it in the same
    // update. A fold then would resize the window every frame under the
    // overlay's own fade-in, so the tray must simply be there.
    const el = host.slice(host.indexOf('<ScreenshotTray'), host.indexOf('/>', host.indexOf('<ScreenshotTray')));
    assert.match(el, /overlayVisible=\{isExpanded\}/);
    assert.match(fold, /const instant = !overlayVisible \|\| !visibleBeforeRef\.current/);
    assert.match(fold, /initial=\{instant \? false : 'hidden'\}/);
  });

  test('a fold during a stream holds shrinks only, and growth still flows', () => {
    // Before the first token the stream reports its exact height every frame;
    // an unheld fold there was one native setBounds per frame.
    assert.match(host, /streamShrinkHoldsRef\.current > 0 &&[\s\S]{0,120}decision\.height <= lastWindowHeightAskedRef\.current/,
      'the hold may only skip reports that would NOT grow the window');
    const channel = host.slice(host.indexOf('const requestChromeHeightMotion = useCallback'));
    const streaming = channel.slice(channel.indexOf('if (streamingMsgIdRef.current !== null) {'), channel.indexOf('const heldUntil'));
    assert.match(streaming, /leadGrowth\(\)/);
    assert.match(streaming, /return release;/);
    assert.doesNotMatch(streaming, /heightReportSuppressedUntilRef/,
      'the ResizeObserver must not be held while an answer streams');
  });

  test('every chrome block that comes and goes folds, with the channel and visibility wired', () => {
    // 2026-09-27 round 2: the transcript line, status pills, tab picker,
    // audio warning, STT-not-configured, hotkey conflict and Accessibility
    // banners all used to pop in and out (28-178px in one frame).
    for (const id of ['fold-status-pills', 'fold-tab-picker', 'fold-audio-warning', 'fold-stt-not-configured',
      'fold-transcript', 'fold-hotkey-conflict', 'fold-accessibility']) {
      const at = host.indexOf(`testId="${id}"`);
      assert.ok(at > 0, `${id} is not folded`);
      const tag = host.slice(host.lastIndexOf('<ChromeFold', at), at);
      assert.match(tag, /overlayVisible=\{isExpanded\} requestHeightMotion=\{requestChromeHeightMotion\}/, id);
    }
    assert.equal((host.match(/<ChromeFold\b/g) || []).length, (host.match(/<\/ChromeFold>/g) || []).length);
    for (const old of ['{hasStatusPill && (', '{showTranscript && rollingTranscript ? (']) {
      assert.ok(!host.includes(old), `bare conditional is back: ${old}`);
    }
  });

  test('vertical margins moved inside the folds (a margin survives height 0)', () => {
    assert.doesNotMatch(host, /mx-4 mt-3 mb-1|mx-4 mt-1 mb-1/);
    assert.doesNotMatch(host, /className="mb-2 px-3 py-2 rounded-xl/);
  });

  test('an open fold tweens a content resize only when the width is still', () => {
    // A banner re-wraps every frame of the width spring; a height on its own
    // curve would lag the width (the 09-13 tear). Refused -> step.
    assert.match(fold, /\{ resize: true \}/);
    assert.match(fold, /tween: settle !== null/);
    assert.match(host, /options\?\.resize &&\s*\(animationControlsRef\.current !== null/);
  });

  test('the quick row padding eases with the transcript fold, trailing its collapse', () => {
    const css = readFileSync(join(HERE, '../../index.css'), 'utf8');
    assert.match(host, /ov-quickrow-pad[^`]*'pt-3 is-bare'/);
    assert.match(css, /\.ov-quickrow-pad\.is-bare \{[\s\S]*?transition-delay: 100ms/);
  });

  test('glass inside a fold clips instead of fading (no backdrop root mid-fold)', () => {
    // opacity < 1 or a filter on the box makes it the backdrop root, so the
    // tab picker's backdrop-blur sampled nothing until the fold ended and then
    // snapped in (mean 15-21/255 across the picker).
    assert.match(fold, /shownClip:/);
    assert.match(fold, /exitClip:/);
    assert.match(fold, /getComputedStyle\(el, pseudo\)/, 'liquid-glass draws glass on pseudo-elements');
    // The mode is decided BEFORE framer gets a target: a later label change
    // leaves an in-flight opacity animation running (same target value).
    assert.match(fold, /animate=\{mode === null \? undefined :/);
  });

  test('contents that change while a fold is opening carry on after the open', () => {
    // framer measures `auto` once at the start of the open; the tab list
    // landing mid-open snapped 130px when the open ended at `auto`.
    assert.match(fold, /openTargetRef\.current = innerRef\.current\?\.offsetHeight/);
    assert.match(fold, /startResizeRef\.current\?\.\(target, now\)/);
  });

  test('the transcript line has no second fold nested inside the transcript fold', () => {
    // Nested, the outer fold's resize tween chased the inner fold every frame.
    const rt = readFileSync(join(HERE, '../ui/RollingTranscript.tsx'), 'utf8');
    assert.doesNotMatch(rt, /ChromeFold/);
  });
});
