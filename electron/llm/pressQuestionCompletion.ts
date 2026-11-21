// electron/llm/pressQuestionCompletion.ts
//
// Issue #774 (2026-11-21): a manual What to Answer press made while the
// interviewer is still talking reads the transcript as it stands at the press:
// the finals so far plus the live interim ("there could be zero", "application
// port"). The finished line ("zero one two", "application portfolio", "with
// other AWS services?") arrived 0.3-2.6 s later, long before the answer was
// done (6-15 s), and was never read. Three answers in one Windows/Deepgram
// session answered the fragment.
//
// This decides whether an interviewer final that arrives while that answer is
// still being written completes the question the press heard, so the engine
// can start the answer again, once, from the finished transcript.
//
// Pure and platform-independent: timestamps are the receive times the main
// process stamps on every STT segment (Date.now() in main.ts), the same clock
// on macOS and Windows.

/** An interim this recent at the press means the interviewer was mid-sentence. */
export const LIVE_INTERIM_AT_PRESS_MS = 2_000;

/**
 * How long after the press a final still finishes the sentence the press cut
 * into, when an interim was live at the press. The issue's finals came 0.3,
 * 0.6 and 2.6 s after their presses; a provider finalises at the first pause,
 * so a final later than this is a new sentence.
 */
export const FINAL_AFTER_LIVE_INTERIM_MS = 5_000;

/**
 * With no live interim at the press (the sentence started too recently for one
 * to arrive), only a final this soon can be speech that was under way at the
 * press rather than something said after it.
 */
export const FINAL_AFTER_QUIET_PRESS_MS = 1_500;

export interface PressTranscriptSnapshot {
  /** When the press read the transcript (ms, same clock as segment timestamps). */
  readAt: number;
  /** Receive time of the interviewer interim live at that moment, if any. */
  interimAt: number | null;
  /** The interim text the press put in its transcript ('' when none was injected). */
  heardInterim: string;
}

const words = (text: string): string[] =>
  (String(text ?? '').toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).map((w) => w.replace(/'/g, ''));

/**
 * Whether `final` (an interviewer final) finishes the question the press heard.
 *
 * True when it arrives inside the window and carries words the press did not
 * hear. A final that only repeats the injected interim (the provider confirmed
 * what was already read) changes nothing and returns false.
 */
export function finalCompletesPressedQuestion(
  snapshot: PressTranscriptSnapshot,
  final: { text: string; timestamp: number },
): boolean {
  const age = final.timestamp - snapshot.readAt;
  if (!Number.isFinite(age) || age < 0) return false;

  const interimLive = snapshot.interimAt !== null
    && Number.isFinite(snapshot.interimAt)
    && snapshot.readAt - snapshot.interimAt <= LIVE_INTERIM_AT_PRESS_MS;
  if (age > (interimLive ? FINAL_AFTER_LIVE_INTERIM_MS : FINAL_AFTER_QUIET_PRESS_MS)) return false;

  const finalWords = words(final.text);
  if (finalWords.length === 0) return false;
  const heard = words(snapshot.heardInterim);
  if (heard.length > 0 && ` ${heard.join(' ')} `.includes(` ${finalWords.join(' ')} `)) return false;
  return true;
}
