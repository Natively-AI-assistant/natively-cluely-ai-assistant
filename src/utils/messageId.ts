// Monotonic React key generator for chat messages.
//
// `Date.now().toString()` collides whenever two messages are appended in the
// same synchronous handler (e.g. user-message + streaming-placeholder in
// handleManualSubmit). Duplicate React keys cause the reconciler to swap DOM
// between rows and the rendered chat flickers / repeats — see issue #253.
//
// Appending an ever-increasing counter guarantees uniqueness across calls
// inside one tick while keeping the timestamp prefix for ordering & debugging.
// The counter is seeded with a random offset so Vite HMR (which re-evaluates
// the module and zeros module-level state) cannot produce an id that collides
// with one already living in a retained React `messages` array.
let counter = Math.floor(Math.random() * 1_000_000);

export const genMessageId = (): string => `${Date.now()}-${++counter}`;
