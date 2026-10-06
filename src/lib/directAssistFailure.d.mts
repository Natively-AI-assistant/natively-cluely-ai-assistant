/** One provider that failed, and why. */
export interface DirectAssistFailure {
  /** Display name, not the provider id. */
  provider: string;
  code: string;
  status?: number;
  waitedMs?: number;
  partial?: boolean;
  /** No status came back at all: offline, or connection refused. */
  unreachable?: boolean;
  /** The provider's own words, already cut down in main. */
  detail?: string;
}

export interface DirectAssistFallbackHop extends DirectAssistFailure {
  /** Display name of the provider tried after this one. */
  next: string;
}

export interface DirectAssistFallbackNotice {
  hops: DirectAssistFallbackHop[];
  /** Set only once a provider has actually answered. */
  answeredBy?: string;
}

/** An answer that failed: outright, or partway (`partial`). */
export interface DirectAssistAnswerFailure extends Omit<DirectAssistFailure, 'provider'> {
  /** Absent when the request never reached a provider. */
  provider?: string;
  /** Main's own fixed sentence; shown when the failure is not a provider's. */
  message?: string;
  /** Every provider tried, when more than one was and none answered. */
  attempts?: DirectAssistFailure[];
}

export interface DirectAssistNoticeRow {
  text: string;
  detail?: string;
}

export interface DirectAssistNoticeView {
  tone: 'trying' | 'answered' | 'cutoff' | 'failed';
  headline: string;
  /** The provider's own words for the headline. */
  detail?: string;
  /** One per provider that failed. */
  rows: DirectAssistNoticeRow[];
  /** Opening AI Providers could fix at least one of the causes. */
  fixable: boolean;
}

export const DIRECT_ASSIST_PHRASES: readonly string[];
/** The quiet "still working" line for a quick action pressed twice, by action key. */
export const CHAT_HINTS: Readonly<Record<'what_to_say' | 'code_hint', string>>;
export const DIRECT_ASSIST_OPEN_PROVIDERS: string;

export function directAssistFailureReason(
  failure: DirectAssistFailure,
  t?: (text: string) => string,
): string;

/** Every cause a failure can be sorted into. */
export const DIRECT_ASSIST_CAUSES: readonly string[];
/** The cause of a failure as one of DIRECT_ASSIST_CAUSES. */
export function directAssistFailureCause(failure: {
  code: string; status?: number; waitedMs?: number; partial?: boolean; unreachable?: boolean;
}): string;

export function directAssistNoticeView(
  state: {
    failure?: DirectAssistAnswerFailure;
    fallbackNotice?: DirectAssistFallbackNotice;
    /** The request is over (the card is no longer streaming). */
    ended?: boolean;
  },
  t?: (text: string) => string,
): DirectAssistNoticeView | null;

export function directAssistFailureText(
  failure: DirectAssistAnswerFailure,
  t?: (text: string) => string,
): string;

export function ownStopFailure(reason: string | undefined | null): { partial: true; code: 'OUTPUT_LIMIT' | 'OUTPUT_REPETITION'; provider: '' } | null;

export type ChatNoteKind = 'late' | 'stopped' | 'superseded' | 'noneYet';
/** A quiet note about an answer. `question` is the late answer's own question. */
export interface ChatNote {
  kind: ChatNoteKind;
  question?: string;
  /** A sentence main wrote, shown in place of the kind's own. */
  text?: string;
  /** There is no answer text: the note is all the row shows. */
  alone?: boolean;
}
export const CHAT_NOTES: Readonly<Record<ChatNoteKind, string>>;
export function chatNoteText(note: ChatNote, t?: (text: string) => string): string;
