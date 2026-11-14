// electron/llm/answerLength.ts
//
// A mode's Answer length (2026-11-14): Shorter, Smart or Longer, picked in the
// Modes editor beside the Real-time prompt's Save. Smart is the app as it was:
// the planner picks a length for each question (speakability.ts bands). Shorter
// and Longer move those same targets down or up; they never add a length where
// Smart has none (code, step-by-step and "in detail" asks, "tell me about a
// time" stories, launcher chat), and they never outrank a length the user asked
// for in the question or wrote into the Real-time prompt.
//
// Pure: no I/O. ModesManager registers the provider that reads the mode.

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
// (ModesManager) registers once, the prompt code asks. No provider (every unit
// test) means Smart, so the planner stays pure by default. The slot lives on
// globalThis because scripts/build-electron.js inlines this module into each
// bundle separately; a module-level variable would be one private copy per
// bundle and the registration would be invisible to the reader.

export type AnswerLengthProvider = (pinnedModeId?: string) => AnswerLength | null | undefined;

const PROVIDER_SLOT = '__nativelyAnswerLengthProviderV1';

/** Register (or, with null, clear) the source of the mode's Answer length. */
export function registerAnswerLengthProvider(provider: AnswerLengthProvider | null): void {
  (globalThis as any)[PROVIDER_SLOT] = provider ?? undefined;
}

/**
 * The Answer length of the pinned mode (or the active one). Never throws: a
 * broken provider must not break a turn, so any failure reads as Smart.
 */
export function getRegisteredAnswerLength(pinnedModeId?: string | null): AnswerLength {
  const provider = (globalThis as any)[PROVIDER_SLOT] as AnswerLengthProvider | undefined;
  if (typeof provider !== 'function') return DEFAULT_ANSWER_LENGTH;
  try {
    return normalizeAnswerLength(provider(pinnedModeId ?? undefined));
  } catch {
    return DEFAULT_ANSWER_LENGTH;
  }
}

// ── profile answers ─────────────────────────────────────────────────────────

/**
 * The word target the profile-evidence prompt (ProfileJitPromptBuilder) states.
 * An explicit "in detail" in the question keeps its 180 whatever the mode says.
 * Smart stays 90, the value every caller passed before this setting existed.
 */
export function profileAnswerWordCap(answerStyle: string | undefined, length: AnswerLength): number {
  if (answerStyle === 'detailed') return 180;
  if (length === 'shorter') return 50;
  if (length === 'longer') return 160;
  return 90;
}
