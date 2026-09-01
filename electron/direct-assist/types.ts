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
}

/** Serializable input accepted at the main-process boundary. */
export interface DirectAssistRequestInput {
  readonly requestId: string;
  readonly source: DirectAssistSource;
  readonly selection: DirectAssistSelection;
  readonly currentRequest: string;
  readonly skill?: DirectAssistSkill | null;
  readonly manualContext?: string;
  readonly referenceContext?: string;
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
  readonly pageContext: DirectAssistPageContext | null;
  readonly history: readonly DirectAssistHistoryTurn[];
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
  /** Field names only. Safe for diagnostics because no user content is stored. */
  readonly trimmedFields: readonly string[];
}

/** The only payload LLMHelper accepts for Direct Assist provider dispatch. */
export interface DirectAssistDispatchRequest {
  readonly requestId: string;
  readonly selection: DirectAssistSelection;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly imagePaths: readonly string[];
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
