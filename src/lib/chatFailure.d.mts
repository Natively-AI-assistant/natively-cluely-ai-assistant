import type { DirectAssistAnswerFailure } from './directAssistFailure.mjs';

/** The provider's own sentence with ids, endpoints, keys, statuses and codes taken out. */
export function scrubErrorText(raw: unknown): string;

/** A raw error from the overlay's non-direct answer paths, as notice data. */
export function chatFailureFromError(
  raw: unknown,
  context?: { provider?: string },
): DirectAssistAnswerFailure;

/** Is this the sentence main's engine sends as the answer when What to Answer failed on a provider? */
export function isProviderFailureSentence(text: string | null | undefined): boolean;
export const PROVIDER_FAILURE_SENTENCE_STARTS: readonly string[];
