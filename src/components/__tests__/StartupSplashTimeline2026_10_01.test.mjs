// Guards the startup splash (2026-10-01, exit redone 2026-10-02): the logo rebuilt
// in characters, then one move away from the viewer that lands the launcher.
//
// WHY THIS EXISTS. The splash is the one screen every launch shows, and it has
// already trapped users once ("stuck at logo"). It is a canvas intro followed by
// an exit made of three Web Animations, so five things have to stay true and none
// of them shows up in a screenshot:
//
//   1. It ends. The intro is at rest before the splash hands over, and the hard
//      cap sits well behind the handover.
//   2. Dismissal is a timer, never a frame callback. Chromium stops
//      requestAnimationFrame for a covered window; a splash that waited for its
//      last frame would never hand over (LauncherBootRevealNotFrameGated).
//   3. The exit is decoration on its own clock. It starts when the splash is
//      actually being removed (App can hold the splash past the handover for the
//      welcome gate), nothing waits for it, and App keeps the splash mounted for
//      exactly as long as it takes.
//   4. The exit keeps its shape: the logo is gone before the black lifts (the logo
//      only ever exists on black), the launcher lands without overshooting, is
//      never dimmed or blurred, and nothing is left on it afterwards.
//   5. Main is told the reveal is over only after the splash has been removed
//      (LauncherThrottlingRestoredAfterReveal): told earlier, a hidden window
//      stops its frames with the splash still mounted.
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
// App's layer around the splash, and the launcher's layer
const splashWrapper = app.slice(app.indexOf('key="startup"'), app.indexOf('<StartupSequence'));
const launcherWrapper = app.slice(app.indexOf('key="main"'), app.indexOf('<QueryClientProvider', app.indexOf('key="main"')));
// How long App takes to drop the splash once the exit has ended, read from the source
const [, fadeS] = splashWrapper.match(/transition: \{ opacity: \{ delay: EXIT_MS \/ 1000, duration: ([\d.]+) \} \}/) ?? [];
const appFadeMs = Number(fadeS) * 1000;
// the exit as the component starts it
const exitBlock = component.slice(component.indexOf('const isPresent = useIsPresent();'), component.indexOf('useLayoutEffect(() => {'));

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

  test('the pace slows the intro by one factor and leaves the safety net well clear', () => {
    assert.ok(tl.PACE >= 1 && tl.PACE <= 1.5, `pace ${tl.PACE}`);
    assert.equal(tl.animationTime(tl.SPLASH_SETTLE_MS), tl.SETTLE_AT_MS);
    assert.equal(tl.animationTime(tl.SPLASH_DISMISS_MS), tl.HANDOVER_AT_MS);
    assert.ok(tl.SPLASH_HARD_CAP_MS - tl.SPLASH_DISMISS_MS >= 1000, 'the safety net must not race the normal dismiss');
    assert.ok(tl.SPLASH_DISMISS_MS + tl.LANDING.at + tl.LANDING_MS <= tl.SPLASH_HARD_CAP_MS, 'the exit fits in front of the hard cap');
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

describe('the exit', () => {
  test('the logo is gone before the black starts to lift: it only ever exists on black', () => {
    assert.ok(tl.LOGO_OUT.fadeMs <= tl.LIFT.at, `the logo is still fading (${tl.LOGO_OUT.fadeMs} ms) when the launcher starts to show (${tl.LIFT.at} ms)`);
    assert.ok(tl.LOGO_OUT.moveMs <= tl.EXIT_MS, 'the logo is still moving when the splash is removed');
    // ...but not so fast that it reads as a cut
    assert.ok(tl.LOGO_OUT.fadeMs >= 150);
  });

  test('the logo falls back, a step and not a zoom', () => {
    assert.ok(tl.LOGO_OUT.scale < 1, 'the logo moves away from the viewer, the same way the launcher lands');
    assert.ok(tl.LOGO_OUT.scale >= 0.7, `the logo shrinks to ${tl.LOGO_OUT.scale}`);
  });

  test('the launcher is already landing when the black starts to lift, and is all but there when it has gone', () => {
    assert.ok(tl.LANDING.at <= tl.LIFT.at, 'the launcher would show at its starting size, standing still, then jump');
    assert.ok(tl.landingScale(tl.EXIT_MS - tl.LANDING.at) - 1 <= 0.01, 'the launcher is still visibly moving once it is fully uncovered');
    assert.equal(tl.EXIT_MS, tl.LIFT.at + tl.LIFT.ms);
    assert.ok(tl.EXIT_MS <= 700, `the handoff takes ${tl.EXIT_MS} ms`);
  });

  test('the landing never overshoots and ends exactly at its size', () => {
    assert.ok(tl.LANDING.from > 1 && tl.LANDING.from <= 1.12, `the launcher starts at ${tl.LANDING.from}: from in front of the viewer, a landing and not a zoom`);
    assert.equal(tl.landingScale(0), tl.LANDING.from, 'no jump when it starts');
    let last = tl.LANDING.from;
    for (let ms = 0; ms <= tl.LANDING_MS + 200; ms++) {
      const s = tl.landingScale(ms);
      assert.ok(s <= last + 1e-12, `the launcher grew again at ${ms}`);
      assert.ok(s >= 1, `the launcher overshot its size at ${ms} (${s})`);
      last = s;
    }
    assert.ok(tl.landingScale(tl.LANDING_MS - 1) - 1 < 2e-4, 'it eases into rest instead of snapping to it');
    for (const ms of [tl.LANDING_MS, tl.LANDING_MS + 1, 5000]) assert.equal(tl.landingScale(ms), 1, `still off its size at ${ms}`);
  });

  test('the keyframes are that spring from start to finish, and move the launcher only', () => {
    const { keyframes, delay, duration } = tl.launcherLanding();
    assert.equal(delay, tl.LANDING.at);
    assert.equal(duration, tl.LANDING_MS);
    assert.equal(keyframes[0].transform, `scale(${tl.LANDING.from.toFixed(5)})`);
    assert.equal(keyframes.at(-1).transform, 'scale(1.00000)');
    assert.ok(keyframes.length >= 30, 'too few samples: straight lines between them would show');
    keyframes.forEach((k, i) => {
      // never dimmed, never blurred: the launcher arrives as itself
      assert.deepEqual(Object.keys(k).sort(), ['easing', 'transform']);
      assert.equal(k.easing, 'linear');
      assert.equal(k.transform, `scale(${tl.landingScale((i / (keyframes.length - 1)) * duration).toFixed(5)})`);
    });
  });

  test('App removes the splash as soon as the exit has ended', () => {
    assert.ok(Number.isFinite(appFadeMs), 'could not read how App removes the leaving splash');
    assert.ok(appFadeMs <= 100, 'an invisible splash must not linger over the launcher');
    assert.match(app, /import \{ EXIT_MS, launcherLanding \} from "\.\/components\/startup\/splashTimeline"/);
  });

  test('the reveal is reported to main only after the splash has been removed', () => {
    // Main restores background throttling on that report. Sent while the splash is
    // still leaving, a hidden window stops its frames with the splash mounted.
    assert.ok(tl.LANDING.at + tl.LANDING_MS >= tl.EXIT_MS + appFadeMs + 100, 'the landing ends before the splash is gone');
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
    assert.doesNotMatch(component, /usePresence|safeToRemove/, 'the exit must not hold the splash on screen: it only watches useIsPresent');
    assert.doesNotMatch(exitBlock, /onComplete|\.finished|onfinish/, 'nothing may wait for the exit animations');
    assert.equal(component.match(/onCompleteRef\.current\(\)/g).length, 2, 'only the two timers may dismiss');
  });

  test('the exit starts when the splash is being removed, not at the handover time, and only once', () => {
    assert.match(exitBlock, /const isPresent = useIsPresent\(\);/);
    assert.match(exitBlock, /if \(isPresent \|\| leaving\.current\) return;\s*leaving\.current = true;/);
    assert.match(exitBlock, /\}, \[isPresent\]\);/);
  });

  test('the exit is transform and opacity on the finished frame, in the order logo then black', () => {
    // the logo is the canvas, or the plain image when the canvas failed: both leave the same way,
    // so the launcher never shows standing still at its starting size
    assert.match(exitBlock, /const box = boxRef\.current, logo = box\?\.firstElementChild;/);
    assert.match(exitBlock, /logo\.animate\(\[\{ transform: 'scale\(1\)' \}, \{ transform: `scale\(\$\{LOGO_OUT\.scale\}\)` \}\], \{ duration: LOGO_OUT\.moveMs, easing: LOGO_OUT\.moveEase, fill: 'forwards' \}\);/);
    assert.match(exitBlock, /logo\.animate\(\[\{ opacity: 1 \}, \{ opacity: 0 \}\], \{ duration: LOGO_OUT\.fadeMs, easing: LOGO_OUT\.fadeEase, fill: 'forwards' \}\);/);
    assert.match(exitBlock, /box\.animate\(\[\{ opacity: 1 \}, \{ opacity: 0 \}\], \{ delay: LIFT\.at, duration: LIFT\.ms, easing: LIFT\.ease, fill: 'forwards' \}\);/);
    assert.equal(exitBlock.match(/\.animate\(/g).length, 4, 'three animations for the exit, one for the still-frame fade');
    // anything else (a filter, a redraw per frame) leaves the compositor and stutters while the launcher mounts
    assert.doesNotMatch(exitBlock, /filter|blur|requestAnimationFrame|renderSplash/);
    assert.match(renderer, /export function renderSplash\(ctx: CanvasRenderingContext2D, s: SplashScene, T: number\): void/, 'the canvas draws the intro only');
    assert.doesNotMatch(renderer, /destination-out|exitT/);
  });

  test('the frame loop stops at the settle and on unmount', () => {
    assert.match(component, /renderSplash\(ctx, scene, t\);/);
    assert.match(component, /if \(t < SPLASH_SETTLE_MS\) raf = requestAnimationFrame\(draw\);/);
    assert.match(component, /return \(\) => \{\s*resize\.disconnect\(\);\s*if \(raf\) cancelAnimationFrame\(raf\);\s*\};/);
  });

  test('reduced motion shows the settled frame, and it fades in and out without moving', () => {
    assert.match(component, /const t = reduced \? SPLASH_SETTLE_MS : performance\.now\(\) - startedAt;/);
    // App adds no entrance any more, so without this the still frame would cut in
    assert.match(component, /if \(reduced\) canvas\.animate\(\[\{ opacity: 0 \}, \{ opacity: 1 \}\]/, 'reduced motion means gentler, not a hard cut');
    // ...and on the way out the still frame dissolves instead of moving
    assert.match(exitBlock, /if \(!logo \|\| prefersReducedMotion\(\)\) \{[\s\S]*?box\.animate\(\[\{ opacity: 1 \}, \{ opacity: 0 \}\], \{ duration: 300, easing: 'ease-out', fill: 'forwards' \}\);\s*return;/);
    // ...and the launcher does not land: it keeps its plain entrance
    assert.match(app, /const launcherLands = !cameFromWelcome\.current && !reduceManagerMotion;/);
  });

  test('a canvas failure falls back to the plain logo instead of a blank window', () => {
    assert.match(component, /catch \(err\) \{[\s\S]*?setPlain\(true\);/);
    assert.match(component, /plain \? \(\s*<img src=\{appIcon\}/);
  });

  test('a frame depends on its clock alone, and the timeline stays testable in node', () => {
    for (const [name, src] of [['renderer', renderer], ['timeline', timeline]]) {
      assert.doesNotMatch(src, /Math\.random|Date\.now|performance\.now/, `${name} reads a clock or a random source`);
    }
    assert.doesNotMatch(timeline, /^import |\bwindow\b|\bdocument\b|sessionStorage|localStorage/m, 'the timeline must stay free of imports and the DOM');
    assert.match(renderer, /const t = Math\.min\(animationTime\(T\), SETTLE_AT_MS\)/, 'a held splash must not change after the settle');
  });

  test('the splash is laid over the launcher, not above it in the flow', () => {
    // As an h-full block the splash pushed the launcher a window-height down until it
    // unmounted: the splash faded to black and the launcher cut in. Measured in the
    // recording harness: launcher top = 868 px during the fade, 68 px with this.
    assert.match(splashWrapper, /className="absolute inset-0 z-\[100\]"/, 'in front of the launcher until the black has lifted');
    assert.doesNotMatch(splashWrapper, /className="h-full w-full"/);
    const container = app.slice(0, app.indexOf('key="startup"'));
    assert.match(container.slice(container.lastIndexOf('<div className=')), /className="[^"]*\brelative\b/, 'absolute inset-0 needs the launcher container to stay positioned');
  });

  test('App adds no entrance or exit of its own over the splash', () => {
    assert.match(splashWrapper, /initial=\{false\}/, 'a fade-in here sits over the first ripple of characters');
    assert.doesNotMatch(splashWrapper, /scale/, 'the splash moves its own logo; a second move here fights it');
    // pointerEvents must not sit behind the delay: the splash is in front of the launcher while it leaves
    assert.match(splashWrapper, /exit=\{\{ opacity: 0, pointerEvents: "none", transition: \{ opacity: \{ delay: EXIT_MS \/ 1000,/);
  });

  test('after the splash the launcher lands as a Web Animation that leaves nothing behind', () => {
    assert.match(launcherWrapper, /ref=\{launcherLands \? landLauncher : undefined\}/);
    assert.match(launcherWrapper, /initial=\{launcherLands \? false : \{ opacity: 0, scale: 0\.99, y: 8 \}\}/, 'a second entrance would run under the landing');
    assert.match(launcherWrapper, /animate=\{launcherLands \? undefined : \{ opacity: 1, scale: 1, y: 0 \}\}/);
    const land = app.slice(app.indexOf('const landLauncher = useCallback'), app.indexOf('}, [reportRevealComplete]);'));
    assert.match(land, /if \(!el \|\| launcherLanded\.current\) return;\s*launcherLanded\.current = true;/, 'once: a second ref call must not restart it');
    // fill backwards holds the starting size under the black; nothing after the end, so no
    // transform stays on the launcher (it would become the containing block of fixed children)
    assert.match(land, /el\.animate\(keyframes, \{ delay, duration, fill: 'backwards' \}\)\.finished\.then\(reportRevealComplete, reportRevealComplete\);/);
    assert.match(land, /if \(typeof el\.animate !== 'function'\) \{\s*reportRevealComplete\(\);\s*return;/, 'main must still hear that the reveal is over');
    // after the welcome, or with reduced motion, the plain entrance still reports it
    assert.match(launcherWrapper, /onAnimationComplete=\{reportRevealComplete\}/);
    assert.match(app, /if \(showWelcome\) cameFromWelcome\.current = true;/);
  });

  // The splash is frozen on the mark it was designed with: every stroke 68 wide. On 2026-10-03 the
  // white logo everywhere else went to 75 and the owner asked for this animation to stay exactly as
  // it is, so the splash and the app logo are no longer one path. Do not make them agree again by
  // editing the splash.
  test('the splash keeps its own equal-stroke mark (every stroke 68 wide)', () => {
    const d = renderer.match(/const MARK_D = '([^']+)'/)[1];
    assert.ok(d.includes('A338 338'), 'ring: outer radius 406, inner 338');
    assert.ok(d.includes('M288 192.77 H356') && d.includes('M668 192.77 H736'), 'uprights 68 wide');
  });

  test('NativelyLogoMark draws the white logo master (brand/natively-mark-white.svg)', () => {
    const mark = read('../NativelyLogoMark.tsx');
    const master = read('../../../brand/natively-mark-white.svg').match(/ d="([^"]+)"/)[1];
    assert.ok(mark.includes(`d="${master}"`), 'the app logo and its master have drifted apart');
  });
});
