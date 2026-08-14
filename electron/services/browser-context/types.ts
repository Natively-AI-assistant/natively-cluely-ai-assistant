/**
 * Smart Browser Context v2 — shared type vocabulary (DESKTOP mirror).
 *
 * Duplicated by design (the extension package + renderer can't cross-import this
 * file). Canonical source is `natively-browser/src/capture/types.ts`; the
 * renderer copy lives in `src/types/electron.d.ts`. A drift-guard test
 * (BrowserContextTypeParity.test.mjs) string-compares the union literals across
 * all three copies. Keep BROWSER_CONTEXT_PARITY below in sync if you edit a union.
 *
 * Data-only. The desktop classifier service + PhoneMirrorService consume these.
 */

/* ────────────────────────────── unions ────────────────────────────── */

export type BrowserContextCategory =
  | 'coding_problem'
  | 'coding_editor'
  | 'interview_assessment'
  | 'developer_docs'
  | 'job_description'
  | 'google_docs_visible'
  | 'notes'
  | 'article'
  | 'email'
  | 'chat'
  | 'banking'
  | 'auth'
  | 'unknown';

export type AutoPolicy =
  | 'auto'
  | 'auto_if_high_confidence'
  | 'ask'
  | 'manual'
  | 'blocked';

export type BrowserContextSensitivity = 'low' | 'medium' | 'high' | 'critical';

export type ClassificationConfidence = 'high' | 'medium' | 'low';

/* ────────────────────────── classifier I/O ────────────────────────── */

export interface TabCandidate {
  tabId: number;
  windowId?: number;
  title?: string;
  url?: string;
  host?: string;
  pathTokens?: string[];
  matchedCategory?: BrowserContextCategory;
  matchedPlatform?: string;
  confidenceScore: number;
  autoPolicy: AutoPolicy;
  lastSeenAt: number;
  reasons: string[];
}

/**
 * Sanitized page metadata — the ONLY thing the AI metadata classifier ever
 * receives. No raw body, code, screenshots, private doc text, or raw private
 * URLs / tokens.
 */
export interface SafeWebsiteMetadata {
  host?: string;
  hostHash?: string;
  tld?: string;
  /**
   * A privacy-safe `scheme://host/path` URL: query string + fragment dropped,
   * secret-looking path segments (UUIDs/emails/tokens/long ids) redacted. Gives
   * the AI classifier near-full site recognition WITHOUT exposing the sensitive
   * parts of an unknown page's URL. Never contains a raw query string.
   */
  sanitizedUrl?: string;
  pathTokens: string[];
  titleTokens: string[];
  metaDescriptionTokens?: string[];
  h1Tokens?: string[];
  knownPlatformMatch?: string;
  hasCodeEditorSignal?: boolean;
  hasProblemKeywordSignal?: boolean;
  hasLoginOrPaymentSignal?: boolean;
  hasSensitiveSignals?: boolean;
}

export interface AiWebsiteClassification {
  category: BrowserContextCategory;
  platform?: string;
  confidenceScore: number;
  autoPolicyRecommendation: AutoPolicy;
  reason: string;
}

/* ────────────────────────── context envelope ──────────────────────── */

export type CaptureMode =
  | 'auto'
  | 'manual'
  | 'selected_text'
  | 'screenshot_fallback';

export type ExtractionSource =
  | 'platform-selector'
  | 'embedded-state'
  | 'editor-dom'
  | 'selection'
  | 'readability'
  | 'innerText'
  | 'screenshot';

export interface ContextEnvelope<TPayload = unknown> {
  envelopeVersion: 1;
  contextId: string;
  source: 'browser_extension';
  captureMode: CaptureMode;
  category: BrowserContextCategory;
  sensitivity: BrowserContextSensitivity;
  confidence: ClassificationConfidence;
  meta: {
    platform?: string;
    title?: string;
    host?: string;
    url?: string;
    urlHash?: string;
    capturedAt: number;
    charCount: number;
    extractionSource: ExtractionSource;
    /**
     * True when the extractor could not capture the ESSENTIAL fields for this
     * category (e.g. a coding page where neither the problem statement nor the
     * visible code came back). The overlay surfaces this honestly instead of
     * pretending the capture is complete.
     */
    partial?: boolean;
    /** Which essential fields were missing (drives the chip hint). */
    missing?: string[];
  };
  payload: TPayload;
}

/* ────────────────────────── payload shapes ────────────────────────── */

export interface CodingProblemPayload {
  platform?: string;
  problemTitle?: string;
  problemStatement?: string;
  inputFormat?: string;
  outputFormat?: string;
  examples?: string;
  constraints?: string;
  starterCode?: string;
  visibleCode?: string;
  language?: string;
  selectedText?: string;
}

export interface NotesPayload {
  editorType:
    | 'google_docs'
    | 'notion'
    | 'textarea'
    | 'contenteditable'
    | 'prosemirror'
    | 'unknown';
  selectedText?: string;
  visibleText?: string;
}

export interface DeveloperDocsPayload {
  title?: string;
  headings?: string[];
  mainText?: string;
  codeBlocks?: string[];
  publicUrl?: string;
}

/* ─────────────────────── parity drift-guard fixture ────────────────── */

/**
 * Canonical union literals + envelope field list. The desktop drift-guard test
 * asserts these match the extension + renderer copies. Order matters.
 */
export const BROWSER_CONTEXT_PARITY = {
  categories: [
    'coding_problem',
    'coding_editor',
    'interview_assessment',
    'developer_docs',
    'job_description',
    'google_docs_visible',
    'notes',
    'article',
    'email',
    'chat',
    'banking',
    'auth',
    'unknown',
  ],
  autoPolicies: ['auto', 'auto_if_high_confidence', 'ask', 'manual', 'blocked'],
  sensitivities: ['low', 'medium', 'high', 'critical'],
  confidences: ['high', 'medium', 'low'],
  captureModes: ['auto', 'manual', 'selected_text', 'screenshot_fallback'],
  envelopeFields: [
    'envelopeVersion',
    'contextId',
    'source',
    'captureMode',
    'category',
    'sensitivity',
    'confidence',
    'meta',
    'payload',
  ],
} as const;
