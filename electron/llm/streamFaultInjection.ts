// electron/llm/streamFaultInjection.ts
//
// Deliberate, test-only faults for the streaming path.
//
// WHY THIS EXISTS
// Two guards added 2026-08-12 can only fire when a provider misbehaves:
//
//   * the post-commit guard (trackCommit) — a provider that fails AFTER its
//     first token must end the turn rather than fall through to the next
//     provider, which would append a second, different, complete answer
//   * the runaway output cap (capOutput)
//
// Neither can be summoned on demand, so the honest status was "confirmed not to
// break anything; not confirmed to work". That is a bad place for a guard whose
// whole job is to handle a rare failure. These switches make both provokable in
// a real app run, so the behaviour can be watched end to end instead of trusted.
//
// SAFETY — three independent conditions, all required:
//   1. an explicit env var must be set (never on by default)
//   2. the build must NOT be packaged (app.isPackaged === false)
//   3. the value must parse to something sane
//
// Condition 2 is the load-bearing one: a shipped app ignores these even if the
// environment sets them, so a stray variable in a user's shell cannot break
// their answers. When Electron's `app` cannot be resolved at all we are not in a
// packaged main process (a packaged build always has it), so that case is
// treated as dev — but condition 1 still applies, so nothing activates by
// accident.

/** True only in a non-packaged build. Packaged apps ignore every fault switch. */
function faultInjectionAllowed(): boolean {
  try {
    // Lazy require: this module is imported by pure-logic paths and unit tests
    // that have no Electron runtime, and a static import would break them.
    const { app } = require('electron');
    if (app && typeof app.isPackaged === 'boolean') return !app.isPackaged;
    return true; // Electron present but no app (utility process / test runner).
  } catch {
    return true; // Not an Electron main process at all — dev or a test harness.
  }
}

/**
 * Chars after which a stream should throw, simulating a provider that dies
 * mid-answer AFTER committing output.
 *
 *   NATIVELY_TEST_FAIL_STREAM_AFTER_CHARS=200 npm start
 *
 * Returns null when disabled. A value of 0 or less is rejected: failing before
 * any output is the PRE-commit case, which already fails over normally and is
 * not what this exists to exercise.
 */
export function failStreamAfterChars(): number | null {
  if (!faultInjectionAllowed()) return null;
  const raw = process.env.NATIVELY_TEST_FAIL_STREAM_AFTER_CHARS;
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Override for the total-output ceiling, so the runaway cap can be provoked
 * without waiting for a model to actually loop.
 *
 *   NATIVELY_TEST_STREAM_OUTPUT_CHARS=400 npm start
 *
 * Returns null when disabled. Only ever LOWERS the ceiling in practice, but the
 * caller applies it directly — it is a test switch, not a tuning knob, and the
 * real ceiling stays the shipped constant.
 */
export function testOutputCharCeiling(): number | null {
  if (!faultInjectionAllowed()) return null;
  const raw = process.env.NATIVELY_TEST_STREAM_OUTPUT_CHARS;
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Error thrown by the injected mid-stream fault, so logs name it clearly. */
export class InjectedStreamFault extends Error {
  constructor(afterChars: number) {
    super(`injected test fault: provider died after ${afterChars} chars (NATIVELY_TEST_FAIL_STREAM_AFTER_CHARS)`);
    this.name = 'InjectedStreamFault';
  }
}
