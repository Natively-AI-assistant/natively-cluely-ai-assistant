// Guards the startup splash (2026-10-01): the logo rebuilt in characters, then a
// ring of characters that leaves the logo and uncovers the launcher behind it.
//
// WHY THIS EXISTS. The splash is the one screen every launch shows, and it has
// already trapped users once ("stuck at logo"). It is a canvas animation in two
// parts, an intro and a reveal, so four things have to stay true and none of them
// shows up in a screenshot:
//
//   1. It ends. The intro is at rest before the splash hands over, the hard cap
//      sits well behind the handover, and the reveal leaves nothing on the canvas.
//   2. Dismissal is a timer, never a frame callback. Chromium stops
//      requestAnimationFrame for a covered window; a splash that waited for its
//      last frame would never hand over (LauncherBootRevealNotFrameGated).
//   3. The reveal is decoration on its own clock. It starts when the splash is
//      actually being removed (App can hold the splash past the handover for the
//      welcome gate), nothing waits for it, and App keeps the splash mounted for
//      exactly as long as it takes.
//   4. A frame is a pure function of its clocks. A slow boot frame then shortens
//      the animation instead of stalling it, and the settled frame is reproducible
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
// the default 1200 x 800 window: how far its corners are from the centred logo, in logo radii
const DEFAULT_CORNER = Math.hypot(600, 400) / ((96 * tl.LOGO_SCALE) / 2);
// How long App keeps the leaving splash mounted, read from the source so the two cannot drift apart
const splashWrapper = app.slice(app.indexOf('key="startup"'), app.indexOf('<StartupSequence'));
const [, holdS, fadeS] = splashWrapper.match(/exit=\{\{[^\n]*transition: \{ opacity: \{ delay: ([\d.]+), duration: ([\d.]+) \} \}/) ?? [];
const appHoldMs = Number(holdS) * 1000, appGoneMs = appHoldMs + Number(fadeS) * 1000;

describe('the intro', () => {
  test('every logo cell has locked and focused before the handover, and the field has drained by the settle', () => {
    for (const [h, h2] of [[0, 0], [1, 1], [0, 1], [1, 0]]) {
      const logo = tl.cellTimes(FARTHEST_LOGO_CELL, h, h2, false);
      assert.ok(logo.lockAt + tl.FOCUS_MS <= tl.HANDOVER_AT_MS, `a logo cell is still settling at ${logo.lockAt + tl.FOCUS_MS}`);
      for (const dist of [0, 1, 3, 6, 20]) {
        const field = tl.cellTimes(dist, h, h2, true);
        assert.ok(field.appear + 140 <= field.drainAt + 260, 'a field cell appears before it has drained');
        assert.ok(field.drainAt + 260 <= tl.SETTLE_AT_MS, `a field cell is still draining at ${field.drainAt + 260}`);
      }
    }
  });

  test('the pace slows both parts by one factor and leaves the safety net well clear', () => {
    assert.ok(tl.PACE >= 1 && tl.PACE <= 1.5, `pace ${tl.PACE}`);
    assert.equal(tl.animationTime(tl.SPLASH_SETTLE_MS), tl.SETTLE_AT_MS);
    assert.equal(tl.animationTime(tl.SPLASH_DISMISS_MS), tl.HANDOVER_AT_MS);
    assert.equal(tl.animationTime(tl.EXIT_MS), tl.REVEAL_MS);
    assert.ok(tl.SPLASH_HARD_CAP_MS - tl.SPLASH_DISMISS_MS >= 1000, 'the safety net must not race the normal dismiss');
    assert.ok(tl.SPLASH_DISMISS_MS + tl.EXIT_MS <= tl.SPLASH_HARD_CAP_MS, 'the reveal fits in front of the hard cap');
  });

  test('the field drifts towards the viewer and never moves away', () => {
    assert.equal(tl.cameraAt(0), 1);
    let last = 1;
    for (let t = 0; t <= 4000; t += 20) {
      const c = tl.cameraAt(t);
      assert.ok(c >= last && c <= 1 + tl.CAMERA_PUSH + 1e-9, `the field moved away or too far at ${t}`);
      last = c;
    }
    assert.ok(tl.CAMERA_PUSH <= 0.06, 'a drift, not a zoom');
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

describe('the reveal', () => {
  test('the zoom is one small spring that ends exactly at rest', () => {
    assert.equal(tl.zoomAt(0), 1, 'no jump when it starts');
    let max = 0, min = Infinity;
    for (let e = 0; e <= tl.REVEAL_MS; e++) {
      const z = tl.zoomAt(e);
      max = Math.max(max, z);
      min = Math.min(min, z);
    }
    assert.ok(Math.abs(max - (1 + tl.PULSE_AMP)) < 1e-4, `peak ${max}`);
    assert.ok(tl.PULSE_AMP <= 0.05, 'a nudge, not a bounce');
    assert.ok(min < 1 && 1 - min < tl.PULSE_AMP * 0.1, `the undershoot is a tenth of the peak at most (${min})`);
    assert.ok(Math.abs(tl.zoomAt(tl.PULSE_MS - 1) - 1) < 1e-4, 'it eases into rest instead of snapping to it');
    for (const e of [tl.PULSE_MS, tl.REVEAL_MS, 5000]) assert.equal(tl.zoomAt(e), 1, `still zoomed at ${e}`);
  });

  test('the ring starts from nothing at the logo, only ever travels outwards, and is gone at the end', () => {
    const reach = tl.revealReach(DEFAULT_CORNER);
    assert.equal(tl.ringAt(0, reach), null);
    assert.equal(tl.ringAt(tl.REVEAL_MS, reach), null);
    assert.equal(tl.ringRadius(0, reach), 0);
    const peakOf = (e) => {
      const ring = tl.ringAt(e, reach);
      let best = 0;
      for (let d = 0; d <= reach + 2; d += 0.01) best = Math.max(best, ring(d));
      return best;
    };
    let last = 0;
    for (let e = 20; e < tl.REVEAL_MS; e += 20) {
      const r = tl.ringRadius(e, reach);
      assert.ok(r >= last, `the ring moved inwards at ${e}`);
      assert.ok(peakOf(e) >= 0 && peakOf(e) <= 1);
      last = r;
    }
    assert.ok(peakOf(1) < 0.01, 'it fades in');
    assert.ok(peakOf(tl.REVEAL_MS - 1) < 0.01, 'it fades out');
    // the renderer only keeps empty cells within reach + 3 widths; nothing beyond may ever light
    for (let e = 0; e < tl.REVEAL_MS; e += 10) assert.equal(tl.ringAt(e, reach)?.(reach + 3 * tl.RING_WIDTH + 0.001) ?? 0, 0);
    assert.match(renderer, /ringMax = reach \+ 3 \* RING_WIDTH/);
  });

  test('the black opens right behind the ring: never ahead of it, never far behind', () => {
    const reach = tl.revealReach(DEFAULT_CORNER);
    assert.deepEqual(tl.irisAt(0, reach), { edge: 0, clear: -tl.IRIS_FEATHER }, 'solid black when the reveal starts');
    let lastEdge = 0;
    for (let e = 0; e <= tl.REVEAL_MS; e += 10) {
      const { edge, clear } = tl.irisAt(e, reach), ring = tl.ringRadius(e, reach);
      assert.ok(edge <= ring, `the black opened ahead of the ring at ${e}`);
      assert.ok(ring - edge <= tl.IRIS_LAG + 1e-9, `the opening fell behind the ring at ${e}`);
      assert.ok(edge >= lastEdge, `the opening closed again at ${e}`);
      assert.ok(Math.abs(edge - clear - tl.IRIS_FEATHER) < 1e-9);
      lastEdge = edge;
    }
    assert.ok(tl.IRIS_LAG < tl.RING_WIDTH, 'the edge must sit inside the ring, so the ring reads as what uncovers the launcher');
  });

  test('the whole window is uncovered by the end, at any window size', () => {
    for (const corner of [DEFAULT_CORNER, 10, 14, 25]) {
      const reach = tl.revealReach(corner);
      assert.ok(tl.irisAt(tl.REVEAL_MS, reach).clear >= corner, `a window ${corner} radii out keeps black corners`);
      // ...and well before the end: the last third is only the ring fading
      assert.ok(tl.irisAt(tl.REVEAL_MS * 0.7, reach).clear >= corner * 0.97, `the corners of a window ${corner} radii out open too late`);
    }
    assert.match(renderer, /if \(exitT >= 0 && animationTime\(exitT\) >= REVEAL_MS\) return;/, 'nothing may be left on the canvas after the reveal');
  });

  test('the logo starts to dissolve the moment the ring starts, from the centre outwards, and is gone early', () => {
    // The black behind the logo opens at once, so a logo that stayed whole would sit on the launcher.
    assert.equal(tl.logoLetGo(0, 0), 0, 'the dissolve must start with the ring, not after it');
    assert.equal(tl.logoLetGo(0, 1), 0, 'noise must not delay the very first cell');
    assert.ok(tl.logoLetGo(0, 0) < tl.logoLetGo(0.5, 0) && tl.logoLetGo(0.5, 0) < tl.logoLetGo(FARTHEST_LOGO_CELL, 0), 'centre first, in the ring\'s wake');
    for (const dist of [0, 0.5, 1, FARTHEST_LOGO_CELL]) for (const h of [0, 1])
      assert.ok(tl.logoLetGo(dist, h) + tl.DRAIN_FADE_MS <= tl.REVEAL_MS / 2, 'the logo lingers over the launcher');
    // ...but not so fast that it reads as a cut: a cell takes a few frames to go
    assert.ok(tl.DRAIN_FADE_MS >= 120);
  });

  test('the logo is never left standing on the launcher: it is only as visible as the black behind it', () => {
    const reach = tl.revealReach(DEFAULT_CORNER);
    for (const dist of [0, 0.5, 1, FARTHEST_LOGO_CELL]) {
      assert.equal(tl.irisCover(dist, tl.irisAt(0, reach)), 1, 'the logo is whole when the reveal starts');
      let last = 1;
      for (let e = 0; e <= tl.REVEAL_MS; e += 5) {
        const cover = tl.irisCover(dist, tl.irisAt(e, reach));
        assert.ok(cover >= 0 && cover <= last, `the logo came back at ${e}`);
        last = cover;
      }
      assert.equal(last, 0);
    }
    // the same ramp the backdrop is cut with: linear between `clear` and `edge`
    assert.equal(tl.irisCover(2, { clear: 2 - tl.IRIS_FEATHER / 2 }), 0.5);
    assert.match(renderer, /const cover = iris \? irisCover\(k\.dist, iris\) : 1;\s*if \(cover <= 0\) continue;\s*const a = easeOut\(prog\(t, k\.appear, 140\)\) \* cover;/);
  });

  test('App keeps the leaving splash mounted for exactly the reveal, and no longer', () => {
    assert.ok(Number.isFinite(appHoldMs) && appHoldMs > 0, 'could not read how long App holds the leaving splash');
    assert.ok(tl.EXIT_MS <= appHoldMs, `App removes the splash (${appHoldMs} ms) before the reveal is over (${tl.EXIT_MS} ms)`);
    assert.ok(appGoneMs - tl.EXIT_MS <= 100, 'an invisible splash must not linger over the launcher');
  });
});

describe('splash wiring', () => {
  test('the splash is dismissed by timers armed once, with the hard cap intact', () => {
    assert.match(component, /setTimeout\(\(\) => \{\s*onCompleteRef\.current\(\);\s*\}, SPLASH_DISMISS_MS\)/);
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
    assert.doesNotMatch(component, /usePresence|safeToRemove/, 'the reveal must not hold the splash on screen: it only watches useIsPresent');
    assert.equal(component.match(/onCompleteRef\.current\(\)/g).length, 2, 'only the two timers may dismiss');
  });

  test('the reveal starts when the splash is being removed, not at the handover time', () => {
    assert.match(component, /const isPresent = useIsPresent\(\);/);
    assert.match(component, /if \(isPresent \|\| exitAt\.current >= 0\) return;\s*exitAt\.current = performance\.now\(\);/);
    assert.match(component, /const exitT = reduced \|\| exitAt\.current < 0 \? -1 : now - exitAt\.current;/);
    assert.match(renderer, /const leaving = exitT >= 0, e = leaving \? Math\.min\(animationTime\(exitT\), REVEAL_MS\) : 0;/);
    assert.match(renderer, /const ring = leaving \? ringAt\(e, s\.reach\) : null;/, 'a held splash must rest: no ring until it leaves');
    assert.match(renderer, /const zoom = leaving \? zoomAt\(e\) : 1;/);
  });

  test('the canvas owns the backdrop, and the box behind it gets out of the way', () => {
    assert.match(component, /drawBackdrop\(ctx, scene, exitT\);\s*renderSplash\(ctx, scene, t, exitT\);/);
    assert.match(component, /box\.style\.background = 'transparent';\s*wake\.current\(\);/, 'the black box behind the canvas would hide the launcher');
    assert.match(renderer, /ctx\.globalCompositeOperation = 'destination-out';/);
  });

  test('the frame loop stops at the settle, runs again only for the reveal, and stops on unmount', () => {
    assert.match(component, /if \(t < SPLASH_SETTLE_MS \|\| \(exitT >= 0 && exitT < EXIT_MS\)\) raf = requestAnimationFrame\(draw\);/);
    assert.match(component, /return \(\) => \{\s*wake\.current = \(\) => \{\};\s*resize\.disconnect\(\);\s*if \(raf\) cancelAnimationFrame\(raf\);\s*\};/);
  });

  test('reduced motion shows the settled frame, fades in and out, and draws no reveal', () => {
    assert.match(component, /t = reduced \? SPLASH_SETTLE_MS : now - startedAt;/);
    assert.match(component, /const exitT = reduced \|\|/);
    // App adds no entrance any more, so without this the still frame would cut in
    assert.match(component, /if \(reduced\) canvas\.animate\(\[\{ opacity: 0 \}, \{ opacity: 1 \}\]/, 'reduced motion means gentler, not a hard cut');
    // ...and on the way out the still frame (or the plain logo) fades itself
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
    assert.match(renderer, /const t = Math\.min\(animationTime\(T\), SETTLE_AT_MS\)/, 'a held splash must not change after the settle');
  });

  test('the splash is laid over the launcher, not above it in the flow', () => {
    // As an h-full block the splash pushed the launcher a window-height down until it
    // unmounted: the splash faded to black and the launcher cut in. Measured in the
    // recording harness: launcher top = 868 px during the fade, 68 px with this.
    assert.match(splashWrapper, /className="absolute inset-0 z-\[100\]"/, 'in front of the launcher while the ring uncovers it');
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
