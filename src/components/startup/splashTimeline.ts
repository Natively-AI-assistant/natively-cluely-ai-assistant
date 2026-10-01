// Timing and maths for the startup splash (StartupSequence.tsx). No DOM and no
// imports, so node can test it directly (src/components/__tests__/StartupSplash*.test.mjs).
//
// The sequence, in milliseconds of ANIMATION time. It is played PACE times slower
// than written, so every time below (and every `t` these functions take) is
// animation time; only the SPLASH_*_MS constants at the bottom are real time.
//   120 - 1070   a sparse, out-of-focus field of 0 1 . : ripples out from the centre and churns,
//                drifting slowly towards the viewer
//   380 - 1180   the cells covering the logo churn, slow, then lock from the centre outwards,
//                each pulling into focus as it locks
//   980 - 1620   the field drains away, outer cells first
//  1560 - 2280   the logo gives one small spring zoom
//  1560 - 2660   one soft ring leaves the centre, lights the logo as it crosses it and
//                glides out to the sides of the window, whatever its size
//  2500          the launcher takes over, over the ring's faint tail
// and, whenever the splash is actually removed, for EXIT_MS: the black backdrop clears so
// the launcher shows behind, while the logo lets go from the outside in and dissolves
// into churning characters in front of it.
//
// Every value is a pure function of t (and of the time since the exit began). Nothing
// is carried from one frame to the next, so a slow frame during boot shortens the
// animation instead of stalling it, and from SETTLE_AT_MS on the frame no longer
// changes until the exit.

export const STEP_MS = 60; // a cell changes character every 60 ms (stepped, never every frame)
export const LEAD_MS = 260; // ...and slows over its last 260 ms before it locks
export const FOCUS_MS = 180; // a locked cell pulls into focus over 180 ms
export const LOGO_SCALE = 2.3; // the character logo is 2.3 x the 96 px mark, so the characters stay legible

export const FINISH_AT_MS = 1560; // a beat after the last logo cell has locked and focused (about 1.36 s)
export const RIPPLE_MS = 1100;
export const PULSE_MS = 720; // the spring zoom, starting with the ripple
export const PULSE_AMP = 0.045; // peak zoom: 4.5 % larger, then a slight undershoot and rest
export const RIPPLE_REACH = 5.5; // how far the ring travels in the default 1200 x 800 window, in logo radii
export const RIPPLE_REACH_OF_CORNER = 0.83; // ...which is this share of the way to the farthest corner: the window's sides
export const RIPPLE_WIDTH = 0.5; // its softness (gaussian width), in logo radii
export const RIPPLE_DENSITY = 0.6; // share of empty cells the ring may light

export const CAMERA_PUSH = 0.05; // the field ends 5 % larger
// The drawn exit, measured from the moment the splash starts to leave: cells let go
// over EXIT_SPREAD_MS (plus a little noise each) and then fade over EXIT_FADE_MS.
// The backdrop clears faster than that, so the logo is seen dissolving over the launcher.
const EXIT_SPREAD_MS = 190, EXIT_NOISE_MS = 60;
export const EXIT_FADE_MS = 150;
export const EXIT_MS = EXIT_SPREAD_MS + EXIT_NOISE_MS + EXIT_FADE_MS;
export const EXIT_BACKDROP_MS = 240;

export const SETTLE_AT_MS = FINISH_AT_MS + RIPPLE_MS;
// Nothing visible moves after about 2.4 s (the zoom is over at 2.28 s and the ring
// has all but faded), so the splash hands over here instead of holding a still frame.
export const DISMISS_AT_MS = 2500;

// The pace: the whole sequence is played this many times slower than it is written
// above. One number, so the character of the motion (what overlaps what) cannot drift.
// The exit is not paced: leaving stays quick.
export const PACE = 1.2;
/** Real milliseconds since the splash mounted -> animation time. */
export const animationTime = (realMs: number) => realMs / PACE;
// In real time: when the frame stops changing, and when the splash hands over.
export const SPLASH_SETTLE_MS = SETTLE_AT_MS * PACE;
export const SPLASH_DISMISS_MS = DISMISS_AT_MS * PACE;
// With reduced motion the settled frame is shown at once, so it is held only as
// long as the splash it replaced.
export const SPLASH_REDUCED_MOTION_DISMISS_MS = 2200;
// No matter what, the splash never persists past this.
export const SPLASH_HARD_CAP_MS = 5000;

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const prog = (t: number, start: number, dur: number) => clamp((t - start) / dur);
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeOutQuint = (x: number) => 1 - Math.pow(1 - x, 5);
export const smoothstep = (v: number, a: number, b: number) => {
    const x = clamp((v - a) / (b - a));
    return x * x * (3 - 2 * x);
};
const gauss = (x: number) => (x > 3 || x < -3 ? 0 : Math.exp(-x * x));

/** Deterministic 0..1 noise: the same cell shows the same character at the same time on every launch. */
export function hash(a: number, b: number, c: number): number {
    let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul((c | 0) + 0x3c6ef372, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

// A damped spring: rises fast, overshoots, dips just below rest and is exactly 0 at p = 1.
const springRaw = (p: number) => Math.exp(-4.5 * p) * Math.sin(1.8 * Math.PI * p) * (1 - p * p * p);
const SPRING_PEAK = (() => {
    let m = 0;
    for (let i = 0; i <= 400; i++) m = Math.max(m, springRaw(i / 400));
    return m;
})();
export const spring = (p: number) => (p <= 0 || p >= 1 ? 0 : springRaw(p) / SPRING_PEAK);

/** The logo's scale at t: 1, one spring to 1.045, back to exactly 1. */
export const zoomAt = (t: number) => 1 + PULSE_AMP * spring(prog(t, FINISH_AT_MS, PULSE_MS));

/**
 * How much larger the out-of-focus field is drawn at t. It drifts towards the
 * viewer while the logo stays put, and eases to a stop by the settle.
 */
export function cameraAt(t: number): number {
    const x = prog(t, 0, SETTLE_AT_MS);
    return 1 + CAMERA_PUSH * (1 - (1 - x) * (1 - x));
}

/**
 * How far the ring travels, in logo radii, given the distance to the window's
 * farthest corner: the default window's reach, or further in a larger window so
 * that the ring always crosses it.
 */
export const rippleReach = (cornerDist: number) => Math.max(RIPPLE_REACH, cornerDist * RIPPLE_REACH_OF_CORNER);

/**
 * The ring at t, as a function of a cell's distance from the centre in logo
 * radii (1 = the logo's outer edge). Null while there is no ring.
 */
export function rippleAt(t: number, reach: number): ((dist: number) => number) | null {
    const p = prog(t, FINISH_AT_MS, RIPPLE_MS);
    if (p <= 0 || p >= 1) return null;
    const r = easeOutQuint(p) * reach;
    const a = smoothstep(p, 0, 0.12) * Math.pow(1 - p, 1.8);
    return (dist) => a * gauss((dist - r) / RIPPLE_WIDTH);
}

/** When a cell appears, locks and drains. `h` and `h2` are the cell's own 0..1 noise. */
export function cellTimes(dist: number, h: number, h2: number, field: boolean) {
    const appear = 120 + Math.min(dist, 6) * 120 + h * 90; // ripple out from the centre
    return {
        appear,
        lockAt: field ? appear : 380 + dist * 260 + h2 * 240, // logo cells lock from the centre outwards
        drainAt: 980 + (1 - Math.min(dist, 6) / 6) * 260 + h2 * 120, // the outer field drains first
    };
}

/** A logo cell's churn clock: it runs slower and slower over the LEAD_MS before the cell locks. */
export function churnClock(t: number, lockAt: number): number {
    if (t <= lockAt - LEAD_MS) return t;
    const x = Math.min(1, (t - (lockAt - LEAD_MS)) / LEAD_MS);
    return lockAt - LEAD_MS + LEAD_MS * (x - 0.35 * x * x);
}

/**
 * The exit, in ms since the splash started to leave. A logo cell lets go at
 * `logoLetGo` (outer cells first; `h` is the cell's own 0..1 noise) and then
 * fades over EXIT_FADE_MS.
 */
export const logoLetGo = (dist: number, h: number) => (1 - Math.min(dist, 1.45) / 1.45) * EXIT_SPREAD_MS + h * EXIT_NOISE_MS;
/** How opaque the black backdrop is, `e` ms into the exit: it clears quickly and smoothly. */
export const backdropAt = (e: number) => 1 - easeOut(prog(e, 0, EXIT_BACKDROP_MS));
