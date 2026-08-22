/**
 * Injectable clock for the Auto Answer subsystem (V2 §33).
 *
 * Every timer in the Auto Answer path goes through this interface so tests can
 * drive the hard cap, pending-TTL, quiet windows and holds deterministically —
 * zero real sleeps. Production uses `systemClock`; tests use the FakeClock in
 * `__tests__/fakeClock.mjs`, which implements the same shape.
 */

export type ClockTimer = unknown;

export interface Clock {
    /** Monotonic-enough ms timestamp (epoch ms in production). */
    now(): number;
    setTimeout(fn: () => void, ms: number): ClockTimer;
    clearTimeout(timer: ClockTimer): void;
}

export const systemClock: Clock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
