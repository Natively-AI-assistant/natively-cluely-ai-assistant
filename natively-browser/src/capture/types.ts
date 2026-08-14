/**
 * Smart Browser Context v2 — shared type vocabulary (EXTENSION canonical copy).
 *
 * This package (the MV3 companion extension) has its own tsconfig + bundler and
 * cannot cross-import desktop/renderer code, so the Browser Context types are
 * DUPLICATED per subsystem by design:
 *
 *   - natively-browser/src/capture/types.ts      ← THIS FILE (canonical source)
 *   - electron/services/browser-context/types.ts ← desktop mirror
 *   - src/types/electron.d.ts                    ← renderer additions
 *
 * The three copies are kept honest by a drift-guard test in each suite that
 * string-compares the canonical union literals + the ContextEnvelope field set.
 * If you edit a union here, update the other two files and the parity fixtures.
 *
 * Everything here is DATA-ONLY (no behaviour). The registry, classifier, and
 * extractors consume these shapes; nothing here reads the DOM or the network.
 */

/* ────────────────────────────── unions ────────────────────────────── */

/** The page categories Smart Browser Context can classify a tab into. */
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

/**
 * What the policy engine is allowed to do with a page once classified. The hard
 * local policy engine always has the final say — an AI classifier can only
 * RECOMMEND one of these; sensitive categories are forced to 'blocked'.
 */
export type AutoPolicy =
  | 'auto'
  | 'auto_if_high_confidence'
  | 'ask'
  | 'manual'
  | 'blocked';

/** How sensitive the page is. 'critical' is a hard never-capture floor. */
export type BrowserContextSensitivity = 'low' | 'medium' | 'high' | 'critical';

/** Coarse confidence bucket carried on a finished capture envelope. */
export type ClassificationConfidence = 'high' | 'medium' | 'low';

/* ────────────────────────── classifier I/O ────────────────────────── */

/**
 * A candidate tab the local classifier scored. Produced from tab METADATA
 * (+ optional just-in-time DOM feature scan), never from a background body read.
 */
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
 * Sanitized page metadata — the ONLY thing ever sent to the AI metadata
 * classifier. Contains no raw page body, no source code, no screenshots, no
 * private document text, and no raw private URLs / session tokens. Tokens are
 * coarse word lists; `hostHash` lets the desktop key a cache without the host.
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

/** The AI metadata classifier's structured verdict (metadata-only input). */
export interface AiWebsiteClassification {
  category: BrowserContextCategory;
  platform?: string;
  /** 0..1 model-reported confidence. */
  confidenceScore: number;
  autoPolicyRecommendation: AutoPolicy;
  reason: string;
}

/* ────────────────────────── context envelope ──────────────────────── */

/** How a capture was produced — drives chip labels + prompt framing. */
export type CaptureMode =
  | 'auto'
  | 'manual'
  | 'selected_text'
  | 'screenshot_fallback';

/** Where inside the page the payload text came from. */
export type ExtractionSource =
  | 'platform-selector'
  | 'embedded-state'
  | 'editor-dom'
  | 'selection'
  | 'readability'
  | 'innerText'
  | 'screenshot';

/**
 * The structured capture handed from the extension to the desktop. Versioned so
 * the desktop can reject/upgrade unknown shapes. `payload` is category-specific
 * (see the payload interfaces below).
 */
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
     * visible code came back — a non-standard / canvas / cross-origin-iframe
     * editor we couldn't read). The overlay surfaces this honestly ("partial —
     * capture manually?") instead of pretending the capture is complete.
     */
    partial?: boolean;
    /** Which essential fields were missing (drives the chip hint). */
    missing?: string[];
  };
  payload: TPayload;
}

/* ────────────────────────── payload shapes ────────────────────────── */

/** Coding/interview problem payload — the highest-value structured capture. */
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

/** Notes/docs editor payload — manual-first, selected/visible only. */
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

/** Developer documentation payload. */
export interface DeveloperDocsPayload {
  title?: string;
  headings?: string[];
  mainText?: string;
  codeBlocks?: string[];
  publicUrl?: string;
}

/* ─────────────────────── parity drift-guard fixture ────────────────── */

/**
 * Canonical union literals + envelope field list, exported so the per-suite
 * drift-guard tests can assert all three copies of these types stay identical.
 * Order matters: the parity test compares these arrays element-by-element.
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
