/**
 * Event-driven wait for the STT "tail" after the user presses Stop on the
 * voice-dictation Answer flow (src/components/NativelyInterface.tsx,
 * handleAnswerNow). Pure helper, unit-tested — see
 * src/lib/__tests__/AnswerNowTranscriptTail2026_09_11.test.mjs.
 *
 * Why this exists: the transcript for the last second or two of speech lands
 * AFTER the Stop press — cloud finals 0.5–2s after speech ends, local models
 * 1.5–7s. The previous code capped the wait at a fixed 750ms and, worse, had
 * already closed the recording gate, so whatever arrived was thrown away and a
 * short question became "No speech detected". The waiter resolves the moment a
 * FINAL user chunk lands, and is bounded so a genuinely empty recording still
 * returns promptly.
 */

/** Nothing captured yet, or an interim is still pending: speech is in flight. */
export const TAIL_WAIT_MS = 3000;
/**
 * A final already landed and nothing is reported pending: a short grace for a
 * straggler. Long enough for a cloud provider's finalize round-trip (300–800 ms
 * for Deepgram/Soniox) — a local model's multi-second tail is covered instead by
 * main reporting `pending` from finalizeMicSTT, which selects the full window.
 */
export const TAIL_GRACE_MS = 1000;

export function createTranscriptTailWaiter(timers = globalThis) {
  let wake = null;
  return {
    /** Call whenever a FINAL user chunk has been merged into the captured text. */
    notifyFinal() {
      const w = wake;
      wake = null;
      if (w) w('final');
    },
    /**
     * Resolves 'final' as soon as notifyFinal() fires, else 'timeout' at the
     * bound. One wait at a time — a new wait supersedes an unresolved one.
     */
    wait({ hasCapturedFinal, hasPendingInterim }) {
      const ms = (!hasCapturedFinal || hasPendingInterim) ? TAIL_WAIT_MS : TAIL_GRACE_MS;
      return new Promise((resolve) => {
        const timer = timers.setTimeout(() => {
          if (wake === settle) wake = null;
          resolve('timeout');
        }, ms);
        const settle = (why) => {
          timers.clearTimeout(timer);
          resolve(why);
        };
        wake = settle;
      });
    },
  };
}
