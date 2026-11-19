// What one press of What to answer gave (2026-11-19).
//
// The funnel could not tell a meeting where the answer button "gave nothing"
// from one whose answer was simply not counted: about 20% of meetings with a
// press showed no answer and no failure. Each press inside a meeting is now
// counted by what it returned, and meeting_ended carries the counts:
//   answered  an answer was recorded while the press ran
//   message   text came back but no answer was recorded ("Please configure
//             your API Keys", a fallback line)
//   empty     nothing came back: the overlay's quiet "no answer yet" note
//   failed    an error came back or the call threw
// A press still running when the meeting ends is counted as waiting, with how
// long the oldest had waited: seconds is someone moving on, a minute is a hang.
// Counts only, never the question or the answer.

export const ANSWER_PRESS_KINDS = /** @type {const} */ (['answered', 'message', 'empty', 'failed']);

/**
 * @param {{ threw?: boolean, error?: unknown, answer?: unknown, answersBefore?: number, answersAfter?: number }} r
 * @returns {'answered' | 'message' | 'empty' | 'failed'}
 */
export function classifyAnswerPress(r = {}) {
  // An answer recorded while the press ran wins: the user saw it.
  if (Number.isFinite(r.answersBefore) && Number.isFinite(r.answersAfter) && r.answersAfter > r.answersBefore) return 'answered';
  if (r.threw) return 'failed';
  if (r.error !== undefined && r.error !== null && r.error !== '') return 'failed';
  if (typeof r.answer === 'string' && r.answer.trim()) return 'message';
  return 'empty';
}

/**
 * meeting_ended's press fields, or {} when there was no press (the event keeps
 * its old shape for most meetings).
 *
 * @param {{ answered: number, message: number, empty: number, failed: number }} counts
 * @param {number[]} waitingSince when each press still running started (ms)
 * @param {number} now
 */
export function answerPressProps(counts, waitingSince, now) {
  const waiting = waitingSince.length;
  const presses = counts.answered + counts.message + counts.empty + counts.failed + waiting;
  if (presses === 0) return {};
  const props = {
    presses,
    presses_answered: counts.answered,
    presses_message: counts.message,
    presses_empty: counts.empty,
    presses_failed: counts.failed,
    presses_waiting: waiting,
  };
  if (waiting > 0) {
    const oldest = Math.min(...waitingSince);
    props.wait_secs = Math.max(0, Math.min(86_400, Math.floor((now - oldest) / 1000)));
  }
  return props;
}
