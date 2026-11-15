// electron/llm/answerLength.ts
//
// The Answer length (2026-11-14): Shorter, Smart or Longer. One setting for the
// whole app, in Settings › Overlay (moved there from the Modes editor, where it
// was per mode, 2026-11-15: Evin). Smart is the app as it was:
// the planner picks a length for each question (speakability.ts bands). Shorter
// and Longer move those same targets down or up; they never add a length where
// Smart has none (code, step-by-step and "in detail" asks, "tell me about a
// time" stories, launcher chat), and they never outrank a length the user asked
// for in the question or wrote into the Real-time prompt.
//
// Pure: no I/O. ipcHandlers registers the provider that reads the setting.

export type AnswerLength = 'shorter' | 'smart' | 'longer';

export const ANSWER_LENGTHS: readonly AnswerLength[] = ['shorter', 'smart', 'longer'];

export const DEFAULT_ANSWER_LENGTH: AnswerLength = 'smart';

export function isAnswerLength(value: unknown): value is AnswerLength {
  return value === 'shorter' || value === 'smart' || value === 'longer';
}

/** Anything unknown (an old row, a typo, null) reads as Smart. */
export function normalizeAnswerLength(value: unknown): AnswerLength {
  return isAnswerLength(value) ? value : DEFAULT_ANSWER_LENGTH;
}

// ── where the length comes from ─────────────────────────────────────────────
//
// Same arrangement as userInstructionContract's provider: the OWNER
// (ipcHandlers, beside the setting's IPC) registers once, the prompt code asks. No provider (every unit
// test) means Smart, so the planner stays pure by default. The slot lives on
// globalThis because scripts/build-electron.js inlines this module into each
// bundle separately; a module-level variable would be one private copy per
// bundle and the registration would be invisible to the reader.

export type AnswerLengthProvider = () => AnswerLength | null | undefined;

const PROVIDER_SLOT = '__nativelyAnswerLengthProviderV1';

/** Register (or, with null, clear) the source of the Answer length. */
export function registerAnswerLengthProvider(provider: AnswerLengthProvider | null): void {
  (globalThis as any)[PROVIDER_SLOT] = provider ?? undefined;
}

/**
 * The Answer length answers use now. Never throws: a broken provider must not
 * break a turn, so any failure reads as Smart.
 */
export function getRegisteredAnswerLength(): AnswerLength {
  const provider = (globalThis as any)[PROVIDER_SLOT] as AnswerLengthProvider | undefined;
  if (typeof provider !== 'function') return DEFAULT_ANSWER_LENGTH;
  try {
    return normalizeAnswerLength(provider());
  } catch {
    return DEFAULT_ANSWER_LENGTH;
  }
}

/**
 * The length answers use: Shorter and Longer are Pro (or a trial); without it
 * every answer is Smart. The stored choice is kept, so Pro back means length back.
 */
export function effectiveAnswerLength(stored: unknown, proActive: boolean): AnswerLength {
  const length = normalizeAnswerLength(stored);
  return length === 'smart' || proActive ? length : 'smart';
}

// ── profile answers ─────────────────────────────────────────────────────────

/**
 * The word target the profile-evidence prompt (ProfileJitPromptBuilder) states.
 * An explicit "in detail" in the question keeps its 180, or Longer's 200 when
 * that is the setting. Smart stays 90, the value every caller passed before
 * this setting existed.
 */
export function profileAnswerWordCap(answerStyle: string | undefined, length: AnswerLength): number {
  if (answerStyle === 'detailed') return length === 'longer' ? 200 : 180;
  if (length === 'shorter') return 50;
  if (length === 'longer') return 200;
  return 90;
}
