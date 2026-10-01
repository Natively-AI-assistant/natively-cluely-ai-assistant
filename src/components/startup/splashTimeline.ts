// Timing and maths for the startup splash (StartupSequence.tsx). No DOM and no
// imports, so node can test it directly (src/components/__tests__/StartupSplash*.test.mjs).
//
// Two parts, both written in milliseconds of ANIMATION time and played PACE times
// slower; only the SPLASH_*_MS / EXIT_MS constants further down are real time.
//
// The intro, on the clock that starts when the splash mounts:
//   120 - 1070   a sparse, out-of-focus field of 0 1 . : ripples out from the centre and churns,
//                drifting slowly towards the viewer
//   380 - 1180   the cells covering the logo churn, slow, then lock from the centre outwards,
//                each pulling into focus as it locks
//   980 - 1620   the field drains away, outer cells first
//  1560          the splash hands over: the launcher is mounted behind it
//
// The reveal, on the clock that starts when the splash is actually being removed
// (App can hold it past the handover; until then the logo simply rests on black):
//     0 -  720   the logo gives one small spring zoom
//     0 - 1100   one soft ring of characters leaves the logo and travels out past the
//                corners of the window; the black opens right behind it, so the ring
//                is what uncovers the launcher
//     0 -  ~200  the logo goes with the black: its cells let go from the centre outwards
//                as the ring leaves and fall back into churning characters, and none
//                is ever drawn brighter than the black still behind it, so the logo
//                is never left standing on the launcher
//
// Every value is a pure function of its clock. Nothing is carried from one frame to
// the next, so a slow frame during boot shortens the animation instead of stalling it,
// and from SETTLE_AT_MS on the frame no longer changes until the reveal.

export const STEP_MS = 60; // a cell changes character every 60 ms (stepped, never every frame)
export const LEAD_MS = 260; // ...and slows over its last 260 ms before it locks
export const FOCUS_MS = 180; // a locked cell pulls into focus over 180 ms
export const LOGO_SCALE = 2.3; // the character logo is 2.3 x the 96 px mark, so the characters stay legible

export const CAMERA_PUSH = 0.05; // the field ends 5 % larger
const CAMERA_MS = 2660; // ...at the end of a drift this long; the field has drained long before it stops

export const HANDOVER_AT_MS = 1560; // a beat after the last logo cell has locked and focused
export const SETTLE_AT_MS = 1620; // the last of the field has drained: nothing changes until the reveal

// The reveal.
export const PULSE_MS = 720; // the spring zoom
export const PULSE_AMP = 0.045; // peak zoom: 4.5 % larger, then a slight undershoot and rest
export const REVEAL_MS = 1100; // the ring's whole life
export const RING_WIDTH = 0.5; // the ring's softness (gaussian width), in logo radii
export const RING_DENSITY = 0.6; // share of empty cells the ring may light
export const IRIS_FEATHER = 1.4; // how soft the edge of the opening is, in logo radii
export const IRIS_LAG = 0.15; // the opening's edge sits this far inside the crest of the ring
// The logo's dissolve starts with the ring: cells let go over DRAIN_SPREAD_MS (plus a
// little noise each), the centre first, and each then fades over DRAIN_FADE_MS.
const DRAIN_SPREAD_MS = 190, DRAIN_NOISE_MS = 60;
export const DRAIN_FADE_MS = 200;

// The pace: both parts are played this many times slower than they are written above.
// One number, so the character of the motion (what overlaps what) cannot drift.
export const PACE = 1.2;
/** Real milliseconds on either clock -> animation time. */
export const animationTime = (realMs: number) => realMs / PACE;
// In real time: when the resting frame is reached, when the splash hands over, and how
// long the reveal takes once the splash is being removed.
export const SPLASH_SETTLE_MS = SETTLE_AT_MS * PACE;
export const SPLASH_DISMISS_MS = HANDOVER_AT_MS * PACE;
export const EXIT_MS = REVEAL_MS * PACE;
// No matter what, the splash never persists past this.
export const SPLASH_HARD_CAP_MS = 5000;

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const prog = (t: number, start: number, dur: number) => clamp((t - start) / dur);
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
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

/** The logo's scale `e` into the reveal: 1, one spring to 1.045, back to exactly 1. */
export const zoomAt = (e: number) => 1 + PULSE_AMP * spring(prog(e, 0, PULSE_MS));

/**
 * How much larger the out-of-focus field is drawn at t. It drifts towards the
 * viewer while the logo stays put.
 */
export function cameraAt(t: number): number {
    const x = prog(t, 0, CAMERA_MS);
    return 1 + CAMERA_PUSH * (1 - (1 - x) * (1 - x));
}

/**
 * How far the ring travels, in logo radii, given the distance to the window's
 * farthest corner: far enough that the opening behind it has cleared that corner
 * completely by the time the ring has gone.
 */
export const revealReach = (cornerDist: number) => cornerDist + IRIS_FEATHER + IRIS_LAG + 0.3;

/** Where the crest of the ring is, `e` into the reveal: it leaves fast and eases out. */
export const ringRadius = (e: number, reach: number) => easeOut(prog(e, 0, REVEAL_MS)) * reach;

/**
 * The ring `e` into the reveal, as a function of a cell's distance from the centre
 * in logo radii (1 = the logo's outer edge). Null while there is no ring.
 */
export function ringAt(e: number, reach: number): ((dist: number) => number) | null {
    const p = prog(e, 0, REVEAL_MS);
    if (p <= 0 || p >= 1) return null;
    const r = ringRadius(e, reach), a = smoothstep(p, 0, 0.12) * Math.pow(1 - p, 1.8);
    return (dist) => a * gauss((dist - r) / RING_WIDTH);
}

/**
 * The opening in the black, `e` into the reveal: everything nearer the centre than
 * `clear` shows the launcher, everything beyond `edge` is still black, and it is
 * feathered in between. The edge rides just inside the ring.
 */
export function irisAt(e: number, reach: number): { edge: number; clear: number } {
    const edge = Math.max(0, ringRadius(e, reach) - IRIS_LAG);
    return { edge, clear: edge - IRIS_FEATHER };
}

/**
 * How much of the black is still behind a point `dist` logo radii from the centre
 * (1 = untouched, 0 = fully opened), for the opening `iris`. The logo is drawn no
 * brighter than this: it only ever exists on black, never over the launcher.
 */
export const irisCover = (dist: number, iris: { clear: number }) => clamp((dist - iris.clear) / IRIS_FEATHER);

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
 * When a logo cell lets go, in animation ms into the reveal: the centre at once,
 * the rest in the ring's wake. `h` is the cell's own 0..1 noise. It then fades
 * over DRAIN_FADE_MS.
 */
export const logoLetGo = (dist: number, h: number) => (Math.min(dist, 1.45) / 1.45) * DRAIN_SPREAD_MS + h * DRAIN_NOISE_MS * Math.min(1, dist);
