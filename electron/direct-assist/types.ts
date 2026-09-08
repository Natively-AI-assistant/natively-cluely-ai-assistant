/**
 * Direct Assist is deliberately a small, provider-agnostic request contract.
 * Context fields stay separate until the final provider payload is built so
 * meeting history can never become the authority for the current request.
 */

export const DIRECT_ASSIST_PROVIDERS = [
  'natively',
  'gemini',
  'openai',
  'claude',
  'groq',
  'deepseek',
  'nvidia_nim',
  'litellm',
  'ollama',
  'codex-cli',
  'antigravity',
  'custom',
  'curl',
] as const;

export type DirectAssistProvider = typeof DIRECT_ASSIST_PROVIDERS[number];
export type DirectAssistSource = 'typed' | 'stt' | 'screenshot';
export type DirectAssistHistoryRole = 'user' | 'assistant';

export interface DirectAssistSelection {
  readonly provider: DirectAssistProvider;
  readonly model: string;
}

/** One attached mode reference file, kept structured so overflow can share the
 *  budget across files instead of letting the first file consume all of it. */
export interface DirectAssistReferenceFile {
  readonly fileName: string;
  readonly content: string;
  /** The file's true size, which survives the processing bound applied before
   *  allocation. The TRUNCATED notice quotes it, and quoting the bounded length
   *  instead would tell the model a smaller file was cut than actually was. */
  readonly totalChars?: number;
}

export interface DirectAssistSkill {
  readonly id?: string;
  readonly name?: string;
  readonly instructions: string;
}

export interface DirectAssistPageContext {
  readonly title?: string;
  readonly url?: string;
  readonly dom?: string;
  readonly ocr?: string;
}

export interface DirectAssistHistoryTurn {
  readonly role: DirectAssistHistoryRole;
  readonly content: string;
  /**
   * Screenshots the user attached to THIS turn, still on disk. Without them a
   * screenshot was reachable only on the turn it was sent: the renderer clears
   * its attachment tray immediately after dispatch, so "what was the error code
   * in the screenshot I sent?" two turns later reached the model as bare text
   * with no image and no hint that one had ever existed.
   */
  readonly imagePaths?: readonly string[];
  /**
   * How many the user actually attached, which is NOT `imagePaths.length` once
   * the screenshot queue has evicted and unlinked a file (ScreenshotHelper keeps
   * 5). The difference is what lets the prompt announce a screenshot it is not
   * sending, instead of leaving the model to invent what was in a picture it
   * cannot see.
   */
  readonly imageCount?: number;
  /**
   * The turn's screenshots as text, from the shared ScreenshotDescriptionStore.
   *
   * ONE string for the whole attachment set, not one per image: a single
   * `understand()` call over N images returns ONE result about all of them, so
   * there is no honest way to attribute it to any single screenshot. The
   * earlier positionally-aligned array had to be padded, could silently
   * mis-pair, and made a multi-image turn uncacheable in both directions.
   *
   * Text is strictly better than bytes for an OLD turn: a fraction of the
   * tokens, and it survives the file being unlinked, a text-only model, and a
   * provider that may not receive images. When it is present the bytes are not
   * carried at all.
   */
  readonly imageDescription?: string;
}

/** Post-normalization form: both attachment fields are always populated. */
export interface DirectAssistNormalizedHistoryTurn extends DirectAssistHistoryTurn {
  readonly imagePaths: readonly string[];
  readonly imageCount: number;
  /** '' when nothing has transcribed this turn's screenshots. */
  readonly imageDescription: string;
}

/** Serializable input accepted at the main-process boundary. */
export interface DirectAssistRequestInput {
  readonly requestId: string;
  readonly source: DirectAssistSource;
  readonly selection: DirectAssistSelection;
  readonly currentRequest: string;
  readonly skill?: DirectAssistSkill | null;
  readonly manualContext?: string;
  /** Legacy pre-rendered form. Prefer `referenceFiles`: a flat string cannot be
   *  re-fitted per file when the budget is tight, so it can only be truncated
   *  from the front (which starves later files) or dropped whole. */
  readonly referenceContext?: string;
  /** Server-populated structured form. When present it is authoritative and
   *  `referenceContext` is ignored. */
  readonly referenceFiles?: readonly DirectAssistReferenceFile[];
  readonly pageContext?: DirectAssistPageContext | null;
  readonly history?: readonly DirectAssistHistoryTurn[];
  readonly transcript?: string;
  /**
   * The live session's last 180 seconds of transcript, server-populated.
   * Distinct from `transcript`, which for screenshot requests carries only
   * the current turn's spoken text.
   */
  readonly meetingTranscript?: string;
  readonly imagePaths?: readonly string[];
  /** Explicit value is a fallback; a language stated in currentRequest wins. */
  readonly requestedLanguage?: string;
  /** Explicit value is a fallback; a format stated in currentRequest wins. */
  readonly requestedFormat?: string;
  /** Test/operator bound. Current request and skill are never truncated. */
  readonly maxContextChars?: number;
}

/** Deep-frozen, normalized request used for one provider dispatch. */
export interface DirectAssistRequest {
  readonly requestId: string;
  readonly source: DirectAssistSource;
  readonly selection: DirectAssistSelection;
  readonly currentRequest: string;
  readonly skill: DirectAssistSkill | null;
  readonly manualContext: string;
  readonly referenceContext: string;
  readonly referenceFiles: readonly DirectAssistReferenceFile[];
  readonly pageContext: DirectAssistPageContext | null;
  readonly history: readonly DirectAssistNormalizedHistoryTurn[];
  readonly transcript: string;
  readonly meetingTranscript: string;
  readonly imagePaths: readonly string[];
  readonly requestedLanguage: string | null;
  readonly requestedFormat: string | null;
  readonly maxContextChars: number;
}

export interface DirectAssistPreparedPrompt {
  readonly request: DirectAssistRequest;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly imagePaths: readonly string[];
  /**
   * Screenshots re-attached from earlier turns, appended AFTER `imagePaths` in
   * the provider payload. Kept as its own field rather than concatenated here
   * because the text that binds each one to its turn lives in the
   * <recent_transcript> block: when the transcript scope is denied for a cloud
   * provider that block is stripped, and these have to go with it or the model
   * receives unexplained pictures of a stale screen and answers from them.
   */
  readonly historyImagePaths: readonly string[];
  /** Field names only. Safe for diagnostics because no user content is stored. */
  readonly trimmedFields: readonly string[];
  /** Fields kept but reduced to fit (reference files re-shared across the
   *  budget, meeting transcript cut back to its most recent part). Distinct
   *  from `trimmedFields`, which means the field is gone entirely. */
  readonly shortenedFields: readonly string[];
}

/** The only payload LLMHelper accepts for Direct Assist provider dispatch. */
export interface DirectAssistDispatchRequest {
  readonly requestId: string;
  readonly selection: DirectAssistSelection;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly imagePaths: readonly string[];
  /** Earlier turns' screenshots. Optional so an older caller still type-checks;
   *  absent is treated as "none carried". See DirectAssistPreparedPrompt. */
  readonly historyImagePaths?: readonly string[];
}

export interface DirectAssistTransport {
  streamDirectAssist(
    request: DirectAssistDispatchRequest,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<string, void, unknown>;
}

export const DIRECT_ASSIST_ERROR_CODES = [
  'INVALID_REQUEST',
  'NO_PROVIDER_CONFIGURED',
  'MODEL_UNAVAILABLE',
  'MODEL_DOES_NOT_SUPPORT_IMAGES',
  'SCREENSHOT_BLOCKED_BY_PRIVACY',
  'TRANSCRIPT_BLOCKED_BY_PRIVACY',
  'INVALID_ATTACHMENT',
  'CONTEXT_TOO_LARGE',
  'AUTH_FAILED',
  'RATE_LIMITED',
  'QUOTA_EXHAUSTED',
  'CONNECT_TIMEOUT',
  'STREAM_IDLE_TIMEOUT',
  'INCOMPLETE_STREAM',
  'PROVIDER_ERROR',
  'CANCELLED',
] as const;

export type DirectAssistErrorCode = typeof DIRECT_ASSIST_ERROR_CODES[number];

export interface DirectAssistErrorPayload {
  readonly code: DirectAssistErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type DirectAssistStreamEvent =
  | {
      readonly type: 'start';
      readonly requestId: string;
      readonly provider: DirectAssistProvider;
      readonly model: string;
      /** Field names dropped by prepareDirectAssistPrompt to fit the context
       *  window. Safe for the renderer: no user content, just field names. */
      readonly trimmedFields: readonly string[];
      /** Field names kept but reduced to fit. Also safe: names only. */
      readonly shortenedFields: readonly string[];
    }
  | {
      readonly type: 'delta';
      readonly requestId: string;
      readonly sequence: number;
      readonly text: string;
    }
  | {
      readonly type: 'done';
      readonly requestId: string;
      readonly sequence: number;
      readonly provider: DirectAssistProvider;
      readonly model: string;
    }
  | {
      readonly type: 'cancel';
      readonly requestId: string;
      readonly sequence: number;
    }
  | {
      readonly type: 'error';
      readonly requestId: string;
      readonly sequence: number;
      readonly partial: boolean;
      readonly error: DirectAssistErrorPayload;
    };

export type DirectAssistTerminalOutcome =
  | {
      readonly state: 'complete';
      readonly provider: DirectAssistProvider;
      readonly model: string;
      readonly chunks: number;
    }
  | { readonly state: 'cancelled'; readonly chunks: number }
  | {
      readonly state: 'failed';
      readonly chunks: number;
      readonly error: DirectAssistErrorPayload;
    };
