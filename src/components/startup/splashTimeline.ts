// Timing and maths for the startup splash (StartupSequence.tsx). No DOM and no
// imports, so node can test it directly (src/components/__tests__/StartupSplash*.test.mjs).
//
// Two parts. The intro is written in milliseconds of ANIMATION time and played PACE
// times slower; the SPLASH_*_MS constants and the exit are real time.
//
// The intro, on the clock that starts when the splash mounts:
//   120 - 1070   a sparse, out-of-focus field of 0 1 . : ripples out from the centre and churns,
//                drifting slowly towards the viewer
//   380 - 1180   the cells covering the logo churn, slow, then lock from the centre outwards,
//                each pulling into focus as it locks
//   980 - 1620   the field drains away, outer cells first
//  1560          the splash hands over: the launcher is mounted behind it
//
// The exit, on the clock that starts when the splash is actually being removed
// (App can hold it past the handover; until then the logo simply rests on black).
// It is one move away from the viewer, nothing bounces, and the logo only ever
// exists on black:
//     0 - 300    the logo falls back into the black: it shrinks and fades
//   220 - 620    the black lifts off the launcher, which was laid out underneath
//   220 - 1108   the launcher lands from 9 % larger on a critically damped spring
// The exit is transform and opacity on the finished frame, so it runs on the
// compositor while the launcher mounts on the main thread.
//
// Every value of the intro is a pure function of its clock. Nothing is carried from one
// frame to the next, so a slow frame during boot shortens the animation instead of
// stalling it, and from SETTLE_AT_MS on the frame no longer changes.

export const STEP_MS = 60; // a cell changes character every 60 ms (stepped, never every frame)
export const LEAD_MS = 260; // ...and slows over its last 260 ms before it locks
export const FOCUS_MS = 180; // a locked cell pulls into focus over 180 ms
export const LOGO_SCALE = 2.3; // the character logo is 2.3 x the 96 px mark, so the characters stay legible

export const CAMERA_PUSH = 0.05; // the field ends 5 % larger
const CAMERA_MS = 2660; // ...at the end of a drift this long; the field has drained long before it stops

export const HANDOVER_AT_MS = 1560; // a beat after the last logo cell has locked and focused
export const SETTLE_AT_MS = 1620; // the last of the field has drained: the frame no longer changes

// The pace: the intro is played this many times slower than it is written above.
// One number, so the character of the motion (what overlaps what) cannot drift.
export const PACE = 1.2;
/** Real milliseconds since the splash mounted -> animation time. */
export const animationTime = (realMs: number) => realMs / PACE;
// In real time: when the resting frame is reached and when the splash hands over.
export const SPLASH_SETTLE_MS = SETTLE_AT_MS * PACE;
export const SPLASH_DISMISS_MS = HANDOVER_AT_MS * PACE;
// No matter what, the splash never persists past this.
export const SPLASH_HARD_CAP_MS = 5000;

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const prog = (t: number, start: number, dur: number) => clamp((t - start) / dur);
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
export const smoothstep = (v: number, a: number, b: number) => {
    const x = clamp((v - a) / (b - a));
    return x * x * (3 - 2 * x);
};

/** Deterministic 0..1 noise: the same cell shows the same character at the same time on every launch. */
export function hash(a: number, b: number, c: number): number {
    let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul((c | 0) + 0x3c6ef372, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/**
 * How much larger the out-of-focus field is drawn at t. It drifts towards the
 * viewer while the logo stays put.
 */
export function cameraAt(t: number): number {
    const x = prog(t, 0, CAMERA_MS);
    return 1 + CAMERA_PUSH * (1 - (1 - x) * (1 - x));
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

// The exit, in real milliseconds from the moment the splash starts to leave. It is
// one move away from the viewer, the way iOS lands the Home Screen on unlock.

// The logo falls back into the black: it shrinks and fades.
export const LOGO_OUT = { scale: 0.8, moveMs: 300, moveEase: 'cubic-bezier(0.3, 0, 0.3, 1)', fadeMs: 220, fadeEase: 'ease-out' };
// The black lifts off the launcher. It starts once the logo has gone.
export const LIFT = { at: 220, ms: 400, ease: 'cubic-bezier(0.3, 0, 0.3, 1)' };
// The launcher lands from in front of the viewer: 9 % larger, then to its size on a spring.
export const LANDING = { at: 220, from: 1.09, response: 0.6 };

/** When the black has lifted and the splash can be removed. */
export const EXIT_MS = LIFT.at + LIFT.ms;

// A critically damped spring from 0 to 1: it never overshoots. `response` is the period
// the spring would have without damping, in seconds, the way Apple specifies its springs.
const springAt = (secs: number, response: number) => {
    const w = (2 * Math.PI) / response;
    return 1 - (1 + w * secs) * Math.exp(-w * secs);
};
/** How long the landing takes: the spring is within 0.1 % of rest by then. */
export const LANDING_MS = Math.round((9.3 * LANDING.response * 1000) / (2 * Math.PI));
/** The launcher's scale `ms` into its landing. */
export const landingScale = (ms: number) => (ms >= LANDING_MS ? 1 : LANDING.from + (1 - LANDING.from) * springAt(Math.max(0, ms) / 1000, LANDING.response));

/**
 * The landing as Web Animations input: the launcher is held at its starting size
 * under the black until `delay`, then lands. Sampled, linear between samples.
 */
export function launcherLanding(): { keyframes: { transform: string; easing: string }[]; delay: number; duration: number } {
    const samples = 48;
    const keyframes = Array.from({ length: samples + 1 }, (_, i) => ({
        transform: `scale(${landingScale((i / samples) * LANDING_MS).toFixed(5)})`,
        easing: 'linear',
    }));
    return { keyframes, delay: LANDING.at, duration: LANDING_MS };
}
