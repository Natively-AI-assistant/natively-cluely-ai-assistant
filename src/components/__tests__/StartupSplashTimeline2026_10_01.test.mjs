// Guards the startup splash (2026-10-01): the logo rebuilt in characters, one
// spring zoom and one ring, then the launcher, with the logo falling back into
// characters as it leaves.
//
// WHY THIS EXISTS. The splash is the one screen every launch shows, and it has
// already trapped users once ("stuck at logo"). It is now a canvas animation
// instead of two framer-motion elements, so four things have to stay true and
// none of them shows up in a screenshot:
//
//   1. It ends. Every part that matters is over, and exactly at rest, before the
//      splash hands over; the hard cap still sits well behind the dismiss.
//   2. Dismissal is a timer, never a frame callback. Chromium stops
//      requestAnimationFrame for a covered window; a splash that waited for its
//      last frame would never hand over (LauncherBootRevealNotFrameGated).
//   3. The drawn exit is decoration. It starts when the splash is actually being
//      removed (App can hold the splash past the dismiss for the welcome gate),
//      nothing waits for it, and it is finished before App's fade is.
//   4. A frame is a pure function of time. A slow boot frame then shortens the
//      animation instead of stalling it, and the settled frame is reproducible
//      for reduced motion.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as tl from '../startup/splashTimeline.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(HERE, rel), 'utf8');
const component = read('../StartupSequence.tsx');
const renderer = read('../startup/splashRenderer.ts');
const timeline = read('../startup/splashTimeline.ts');
const app = read('../../App.tsx');

// the farthest a logo cell can sit from the centre, in logo radii: the corner of the mark's box
const FARTHEST_LOGO_CELL = Math.SQRT2 + 0.1;
// How long App keeps the leaving splash mounted, read from the source so the two cannot drift apart
const splashWrapper = app.slice(app.indexOf('key="startup"'), app.indexOf('<StartupSequence'));
const [, holdS, fadeS] = splashWrapper.match(/exit=\{\{[^\n]*transition: \{ opacity: \{ delay: ([\d.]+), duration: ([\d.]+) \} \}/) ?? [];
const appHoldMs = Number(holdS) * 1000, appGoneMs = appHoldMs + Number(fadeS) * 1000;

describe('splash timeline', () => {
  test('the phases come in order and the hard cap sits well behind the dismiss', () => {
    assert.equal(tl.SETTLE_AT_MS, tl.FINISH_AT_MS + tl.RIPPLE_MS);
    assert.ok(tl.FINISH_AT_MS + tl.PULSE_MS <= tl.DISMISS_AT_MS, 'the zoom is over before the splash hands over');
  });

  test('the pace slows the whole sequence by one factor and leaves the safety net well clear', () => {
    assert.ok(tl.PACE >= 1 && tl.PACE <= 1.5, `pace ${tl.PACE}`);
    assert.equal(tl.animationTime(tl.SPLASH_SETTLE_MS), tl.SETTLE_AT_MS);
    assert.equal(tl.animationTime(tl.SPLASH_DISMISS_MS), tl.DISMISS_AT_MS);
    assert.ok(tl.SPLASH_HARD_CAP_MS - tl.SPLASH_DISMISS_MS >= 1000, 'the safety net must not race the normal dismiss');
    assert.ok(tl.SPLASH_REDUCED_MOTION_DISMISS_MS <= tl.SPLASH_DISMISS_MS);
  });

  test('only the ring\'s faint tail is left when the splash hands over', () => {
    const ring = tl.rippleAt(tl.DISMISS_AT_MS, tl.RIPPLE_REACH);
    let peak = 0;
    for (let d = 0; d <= 10; d += 0.01) peak = Math.max(peak, ring(d));
    assert.ok(peak < 0.05, `the ring is still at ${peak} of full strength at the dismiss`);
    assert.equal(tl.zoomAt(tl.DISMISS_AT_MS), 1);
  });

  test('every logo cell has locked and focused, and the field has drained, before the finish', () => {
    for (const [h, h2] of [[0, 0], [1, 1], [0, 1], [1, 0]]) {
      const logo = tl.cellTimes(FARTHEST_LOGO_CELL, h, h2, false);
      assert.ok(logo.lockAt + tl.FOCUS_MS <= tl.FINISH_AT_MS, `a logo cell is still settling at ${logo.lockAt + tl.FOCUS_MS}`);
      for (const dist of [0, 1, 3, 6, 20]) {
        const field = tl.cellTimes(dist, h, h2, true);
        assert.ok(field.appear + 140 <= field.drainAt + 260, 'a field cell appears before it has drained');
        assert.ok(field.drainAt + 260 <= tl.DISMISS_AT_MS, `a field cell is still draining at ${field.drainAt + 260}`);
      }
    }
  });

  test('the zoom is one small spring that ends exactly at rest', () => {
    assert.equal(tl.zoomAt(0), 1);
    assert.equal(tl.zoomAt(tl.FINISH_AT_MS), 1, 'no jump when it starts');
    let max = 0, min = Infinity;
    for (let t = tl.FINISH_AT_MS; t <= tl.SETTLE_AT_MS; t++) {
      const z = tl.zoomAt(t);
      max = Math.max(max, z);
      min = Math.min(min, z);
    }
    assert.ok(Math.abs(max - (1 + tl.PULSE_AMP)) < 1e-4, `peak ${max}`);
    assert.ok(tl.PULSE_AMP <= 0.05, 'a nudge, not a bounce');
    assert.ok(min < 1 && 1 - min < tl.PULSE_AMP * 0.1, `the undershoot is a tenth of the peak at most (${min})`);
    assert.ok(Math.abs(tl.zoomAt(tl.FINISH_AT_MS + tl.PULSE_MS - 1) - 1) < 1e-4, 'it eases into rest instead of snapping to it');
    for (const t of [tl.FINISH_AT_MS + tl.PULSE_MS, tl.SETTLE_AT_MS, tl.DISMISS_AT_MS, tl.SPLASH_HARD_CAP_MS])
      assert.equal(tl.zoomAt(t), 1, `still zoomed at ${t}`);
  });

  test('the field drifts towards the viewer and has stopped by the settle', () => {
    assert.equal(tl.cameraAt(0), 1);
    let last = 1;
    for (let t = 0; t <= tl.SETTLE_AT_MS; t += 20) {
      const c = tl.cameraAt(t);
      assert.ok(c >= last, `the field moved away at ${t}`);
      last = c;
    }
    assert.ok(Math.abs(tl.cameraAt(tl.SETTLE_AT_MS) - (1 + tl.CAMERA_PUSH)) < 1e-9);
    assert.equal(tl.cameraAt(tl.SPLASH_HARD_CAP_MS), tl.cameraAt(tl.SETTLE_AT_MS), 'the settled frame must not move');
    const end = tl.cameraAt(tl.SETTLE_AT_MS) - tl.cameraAt(tl.SETTLE_AT_MS - 16), start = tl.cameraAt(16) - tl.cameraAt(0);
    assert.ok(end < start * 0.02, 'it eases to a stop instead of halting');
    assert.ok(tl.CAMERA_PUSH <= 0.06, 'a drift, not a zoom');
  });

  test('the ring starts from nothing, travels outwards and is gone when the frame settles', () => {
    const R = tl.RIPPLE_REACH;
    assert.equal(tl.rippleAt(0, R), null);
    assert.equal(tl.rippleAt(tl.FINISH_AT_MS, R), null);
    assert.equal(tl.rippleAt(tl.SETTLE_AT_MS, R), null);
    const peakOf = (t) => {
      const ring = tl.rippleAt(t, R);
      let best = 0, at = 0;
      for (let d = 0; d <= 10; d += 0.01) if (ring(d) > best) { best = ring(d); at = d; }
      return { best, at };
    };
    let last = -1;
    for (let t = tl.FINISH_AT_MS + 20; t < tl.SETTLE_AT_MS; t += 20) {
      const { best, at } = peakOf(t);
      assert.ok(best >= 0 && best <= 1);
      assert.ok(at >= last - 0.011, `the ring moved inwards at ${t}`);
      last = at;
    }
    assert.ok(peakOf(tl.FINISH_AT_MS + 1).best < 0.01, 'it fades in');
    assert.ok(peakOf(tl.SETTLE_AT_MS - 1).best < 0.01, 'it fades out');
  });

  test('the ring crosses a window of any size to its sides, and never lights a cell the layout dropped', () => {
    const defaultCorner = Math.hypot(600, 400) / (96 * tl.LOGO_SCALE / 2); // 1200 x 800, logo at the centre
    assert.ok(Math.abs(tl.rippleReach(defaultCorner) - tl.RIPPLE_REACH) < 0.05, 'the default window keeps the picked ring');
    assert.equal(tl.rippleReach(1), tl.RIPPLE_REACH, 'never shorter than the picked ring');
    for (const corner of [defaultCorner, 10, 14, 25]) {
      const reach = tl.rippleReach(corner);
      // the launcher is locked to 3:2, where the left and right sides are 0.83 of the way to a corner
      assert.ok(reach >= corner * 0.83 - 1e-9, `the ring dies mid-screen in a window ${corner} radii out`);
      // the renderer only keeps empty cells within reach + 3 widths; nothing beyond may ever light
      for (let t = tl.FINISH_AT_MS; t < tl.SETTLE_AT_MS; t += 10) assert.equal(tl.rippleAt(t, reach)?.(reach + 3 * tl.RIPPLE_WIDTH + 0.001) ?? 0, 0);
    }
    assert.match(renderer, /rippleMax = reach \+ 3 \* RIPPLE_WIDTH/);
  });

  test('a cell churns in steps and slows before it locks, never running ahead of time', () => {
    const lockAt = 1000;
    assert.equal(tl.churnClock(500, lockAt), 500);
    let last = 0;
    for (let t = lockAt - tl.LEAD_MS; t <= lockAt; t += 5) {
      const clock = tl.churnClock(t, lockAt);
      assert.ok(clock <= t + 1e-9 && clock >= last, `churn clock went wrong at ${t}`);
      last = clock;
    }
    assert.ok(lockAt - tl.churnClock(lockAt, lockAt) > tl.STEP_MS, 'the last character is held for longer than a normal step');
  });

  test('the exit lets go from the outside in and is over within EXIT_MS, while App still holds the splash', () => {
    assert.ok(tl.logoLetGo(FARTHEST_LOGO_CELL, 0) < tl.logoLetGo(0.5, 0) && tl.logoLetGo(0.5, 0) < tl.logoLetGo(0, 0), 'outer cells first');
    for (const dist of [0, 0.5, 1, FARTHEST_LOGO_CELL]) for (const h of [0, 1])
      assert.ok(tl.logoLetGo(dist, h) + tl.EXIT_FADE_MS <= tl.EXIT_MS, 'a logo cell is still fading when the exit is declared over');
    assert.ok(Number.isFinite(appHoldMs) && appHoldMs > 0, 'could not read how long App holds the leaving splash');
    assert.ok(tl.EXIT_MS <= appHoldMs, `App removes the splash (${appHoldMs} ms) before its exit is over (${tl.EXIT_MS} ms)`);
    assert.ok(appGoneMs <= 500, 'exits are quick');
  });

  test('the backdrop clears before the logo has gone, so the logo is seen dissolving over the launcher', () => {
    assert.equal(tl.backdropAt(0), 1, 'no jump when the exit starts');
    assert.equal(tl.backdropAt(tl.EXIT_BACKDROP_MS), 0);
    let last = 1;
    for (let e = 0; e <= tl.EXIT_BACKDROP_MS; e += 10) {
      const a = tl.backdropAt(e);
      assert.ok(a <= last && a >= 0, `the backdrop came back at ${e}`);
      last = a;
    }
    assert.ok(tl.backdropAt(tl.EXIT_BACKDROP_MS / 2) < 0.25, 'it clears early: the launcher is visible behind the logo for most of the exit');
    assert.ok(tl.EXIT_BACKDROP_MS + 100 <= tl.EXIT_MS, 'the logo must outlast the backdrop, or there is nothing left to see dissolve');
    assert.match(component, /ctx\.clearRect\(0, 0, canvas\.width, canvas\.height\);\s*ctx\.globalAlpha = exitT < 0 \? 1 : backdropAt\(exitT\);/);
    assert.match(component, /box\.style\.background = 'transparent';\s*wake\.current\(\);/, 'the black box behind the canvas would hide the launcher');
  });

  test('the noise is deterministic and spread over 0..1', () => {
    assert.equal(tl.hash(3, 7, 11), tl.hash(3, 7, 11));
    let sum = 0, n = 0;
    for (let i = 0; i < 60; i++) for (let j = 0; j < 60; j++) {
      const v = tl.hash(i, j, 3);
      assert.ok(v >= 0 && v < 1);
      sum += v;
      n++;
    }
    assert.ok(Math.abs(sum / n - 0.5) < 0.03, `mean ${sum / n}`);
  });
});

describe('splash wiring', () => {
  test('the splash is dismissed by timers armed once, with the hard cap intact', () => {
    assert.match(component, /setTimeout\(\(\) => \{\s*onCompleteRef\.current\(\);\s*\}, prefersReducedMotion\(\) \? SPLASH_REDUCED_MOTION_DISMISS_MS : SPLASH_DISMISS_MS\)/);
    assert.match(component, /try \{ onCompleteRef\.current\(\); \} catch \{[^}]*\}\s*\}, SPLASH_HARD_CAP_MS\)/);
    assert.equal(tl.SPLASH_HARD_CAP_MS, 5000);
    const timers = component.slice(component.indexOf('useEffect(() => {'), component.indexOf('const canvasRef'));
    assert.match(timers, /\}, \[\]\);/, 'deps other than [] re-arm the hard cap on every boot re-render');
    assert.match(timers, /clearTimeout\(timer\);\s*clearTimeout\(hardCap\);/);
  });

  test('no frame callback and no exit animation can dismiss the splash', () => {
    const draw = component.slice(component.indexOf('const draw = () => {'), component.indexOf('const layout = () => {'));
    assert.ok(draw.length > 0);
    assert.doesNotMatch(draw, /onComplete/, 'requestAnimationFrame stops for a covered window: the handover must stay on a timer');
    assert.doesNotMatch(component, /usePresence|safeToRemove/, 'the drawn exit must not hold the splash on screen: it only watches useIsPresent');
    assert.equal(component.match(/onCompleteRef\.current\(\)/g).length, 2, 'only the two timers may dismiss');
  });

  test('the drawn exit starts when the splash is being removed, not at the dismiss time', () => {
    assert.match(component, /const isPresent = useIsPresent\(\);/);
    assert.match(component, /if \(isPresent \|\| exitAt\.current >= 0\) return;\s*exitAt\.current = performance\.now\(\);/);
    assert.match(component, /const exitT = reduced \|\| exitAt\.current < 0 \? -1 : now - exitAt\.current;/);
    assert.match(renderer, /const leaving = exitT >= 0, e = Math\.min\(exitT, EXIT_MS\);/);
  });

  test('the frame loop stops at the settle, runs again only for the exit, and stops on unmount', () => {
    assert.match(component, /if \(t < SPLASH_SETTLE_MS \|\| \(exitT >= 0 && exitT < EXIT_MS\)\) raf = requestAnimationFrame\(draw\);/);
    assert.match(component, /return \(\) => \{\s*wake\.current = \(\) => \{\};\s*resize\.disconnect\(\);\s*if \(raf\) cancelAnimationFrame\(raf\);\s*\};/);
  });

  test('reduced motion shows the settled frame and draws no exit', () => {
    assert.match(component, /t = reduced \? SPLASH_SETTLE_MS : now - startedAt;/);
    assert.match(component, /const exitT = reduced \|\|/);
    // App adds no entrance any more, so without this the still frame would cut in
    assert.match(component, /if \(reduced\) canvas\.animate\(\[\{ opacity: 0 \}, \{ opacity: 1 \}\]/, 'reduced motion means gentler, not a hard cut');
    // ...and on the way out: App no longer fades the splash, so the still frame (or the plain logo) fades itself
    assert.match(component, /if \(plain \|\| prefersReducedMotion\(\)\) \{[\s\S]*?box\.animate\(\[\{ opacity: 1 \}, \{ opacity: 0 \}\], \{ duration: 300, easing: 'ease-out', fill: 'forwards' \}\);\s*return;/);
  });

  test('a canvas failure falls back to the plain logo instead of a blank window', () => {
    assert.match(component, /catch \(err\) \{[\s\S]*?setPlain\(true\);/);
    assert.match(component, /plain \? \(\s*<img src=\{appIcon\}/);
  });

  test('a frame depends on its two clocks alone', () => {
    for (const [name, src] of [['renderer', renderer], ['timeline', timeline]]) {
      assert.doesNotMatch(src, /Math\.random|Date\.now|performance\.now/, `${name} reads a clock or a random source`);
    }
    assert.match(renderer, /const t = Math\.min\(animationTime\(T\), SETTLE_AT_MS\)/, 'the frame must not change after the settle');
  });

  test('the splash is laid over the launcher, not above it in the flow', () => {
    // As an h-full block the splash pushed the launcher a window-height down until it
    // unmounted: the splash faded to black and the launcher cut in. Measured in the
    // recording harness: launcher top = 868 px during the fade, 68 px with this.
    assert.match(splashWrapper, /className="absolute inset-0 z-\[100\]"/, 'in front of the launcher while the logo dissolves');
    assert.doesNotMatch(splashWrapper, /className="h-full w-full"/);
    const container = app.slice(0, app.indexOf('key="startup"'));
    assert.match(container.slice(container.lastIndexOf('<div className=')), /className="[^"]*\brelative\b/, 'absolute inset-0 needs the launcher container to stay positioned');
  });

  test('App adds no entrance or exit of its own over the splash', () => {
    assert.match(splashWrapper, /initial=\{false\}/, 'a fade-in here sits over the first ripple of characters');
    assert.doesNotMatch(splashWrapper, /scale/, 'a zoom on the way out reads as a second zoom after the spring');
    // pointerEvents must not sit behind the delay: the splash is in front of the launcher while it leaves
    assert.match(splashWrapper, /exit=\{\{ opacity: 0, pointerEvents: "none", transition: \{ opacity: \{ delay/);
  });

  test('the logo is the corrected equal-stroke mark shared with NativelyLogoMark', () => {
    const mark = read('../NativelyLogoMark.tsx');
    const d = renderer.match(/const MARK_D = '([^']+)'/)[1];
    assert.ok(mark.includes(`d="${d}"`), 'the splash and the app logo have drifted apart');
  });
});
