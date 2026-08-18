// electron/localKnowledge/types.ts
//
// The knowledge-module contract, reconstructed from its call sites.
//
// `premium/` is a private submodule (see .gitignore:41-42) that is absent from
// this checkout, so every `require('../premium/electron/knowledge/...')` in the
// free tree throws and falls into a catch that disables profile intelligence
// (electron/main.ts:1288-1295). This module restates the shapes those call
// sites already depend on, so a local implementation can satisfy the same
// contract without the private code.
//
// Nothing here is copied from the premium module — it is derived from observed
// usage in the free tree, and each field below cites the call site that
// requires it. Where the free tree only ever reads a value as `any`
// (roleInsight reports, dossiers — see electron/preload.ts:850-855 for the
// existing reasoning), this module keeps it `unknown`/`any` rather than
// inventing a shape that would be free to drift.

/**
 * Document classes the orchestrator ingests.
 *
 * Only RESUME and JD are referenced anywhere in the free tree (53 and 22 sites
 * respectively). The string values are this implementation's own storage keys;
 * they match the renderer's wire values, which arrive as 'resume' | 'jd'
 * (electron/ipcHandlers.ts:13218).
 */
export enum DocType {
  RESUME = 'resume',
  JD = 'jd',
}

/**
 * Return of `ingestDocument()`.
 *
 * Callers branch on `success` and surface `error` verbatim, and the .doc
 * rejection path at electron/ipcHandlers.ts:10536-10538 depends on a failed
 * result being returned rather than thrown.
 */
export interface IngestResult {
  success: boolean;
  error?: string;
}

/**
 * Return of `processQuestion()` — the assembled grounding for one turn.
 *
 * All fields are optional: the consumers test each one before use, and a null
 * return is a legal "no grounding" answer. Consumed at
 * electron/IntelligenceEngine.ts:1651-1661 (live overlay path) and
 * electron/LLMHelper.ts:2706-2766 / 5634-5714 (manual chat, streaming).
 */
export interface PromptAssemblyResult {
  /** Retrieved profile evidence, injected ahead of the caller's own context (LLMHelper.ts:2763-2766). */
  contextBlock?: string;
  /** Replaces the system prompt body, appended after CORE_IDENTITY + EXECUTION_CONTRACT (LLMHelper.ts:2759-2760). */
  systemPromptInjection?: string;
  /**
   * The orchestrator's own signal that this result is the candidate's plain
   * facts rather than persona injection. Checked with `=== true`, and it
   * bypasses the premium-intercept mode gate (LLMHelper.ts:2740, 5672).
   */
  factualRecall?: boolean;
  /** Intro/name shortcut; both must be set for the shortcut to fire (LLMHelper.ts:2711). */
  isIntroQuestion?: boolean;
  introResponse?: string;
  /** Routed to the negotiation coaching handler as a side channel (LLMHelper.ts:2746-2747). */
  liveNegotiationResponse?: string;
}

/**
 * Structured resume, as read off `orchestrator.activeResume.structured_data`
 * (16 sites; electron/ipcHandlers.ts:13227 is the canonical one).
 *
 * `skills` is genuinely polymorphic in the consumers — the counting logic at
 * ipcHandlers.ts:10559-10563 handles both an array and an object of arrays, so
 * both are legal here.
 */
export interface ResumeStructuredData {
  identity?: { name?: string; [key: string]: unknown };
  /** Read as `.name` at the top level too, as a fallback to identity.name (ipcHandlers.ts:3856). */
  name?: string;
  experience?: Array<{ company?: string; [key: string]: unknown }>;
  education?: unknown[];
  projects?: Array<{ name?: string; [key: string]: unknown }>;
  skills?: string[] | Record<string, string[]>;
  skills_flat?: string[];
  /** Provenance of the extraction; surfaced to diagnostics, defaulted to 'unknown' (ipcHandlers.ts:10564). */
  _extraction_mode?: string;
}

/**
 * Parsed job description. Field set taken from the JD context assembled at
 * electron/ipcHandlers.ts:10920-10928 plus the dossier lookup at 10688.
 */
export interface ActiveJD {
  company?: string;
  title?: string;
  location?: string;
  level?: string;
  technologies?: string[];
  requirements?: unknown[];
  keywords?: string[];
  compensation_hint?: string;
  description_summary?: string;
}

/** Return of `getProfileData()` (6 sites; ipcHandlers.ts:10670, 10687, 10918). */
export interface ProfileData {
  hasActiveJD?: boolean;
  activeJD?: ActiveJD | null;
  activeResume?: ResumeStructuredData | null;
}

/** Return of `getStatus()` (6 sites; the resume summary is read at ipcHandlers.ts:10598). */
export interface KnowledgeStatus {
  knowledgeMode?: boolean;
  hasResume?: boolean;
  hasJD?: boolean;
  resumeSummary?: { name?: string; [key: string]: unknown } | null;
  [key: string]: unknown;
}

/**
 * The orchestrator surface the free tree actually calls.
 *
 * Deliberately narrower than the premium class: it lists only what is reachable
 * from this repository. The sub-service accessors are typed loosely because
 * their payloads are `any` at the preload boundary by existing decision
 * (electron/preload.ts:850-855) — tightening them here would create the second,
 * drift-prone definition that comment exists to avoid.
 */
export interface KnowledgeOrchestratorLike {
  ingestDocument(filePath: string, docType: DocType): Promise<IngestResult>;
  processQuestion(question: string): Promise<PromptAssemblyResult | null>;
  deleteDocumentsByType(docType: DocType): Promise<unknown> | unknown;

  setKnowledgeMode(enabled: boolean): void;
  isKnowledgeMode(): boolean;

  getStatus(): KnowledgeStatus;
  getProfileData(): ProfileData | null;

  /** Present only when a resume has been ingested (ipcHandlers.ts:13227). */
  activeResume?: { structured_data?: ResumeStructuredData | null } | null;

  // Sub-services. Implemented in later phases; see the task list.
  getCompanyResearchEngine?(): any;
  getRoleInsightService?(): any;
  getNegotiationTracker?(): any;
  resetNegotiationSession?(): unknown;
  getNegotiationScript?(): any;
  generateNegotiationScriptOnDemand?(...args: any[]): Promise<any>;
  getCoverLetter?(): any;
  generateCoverLetterOnDemand?(...args: any[]): Promise<any>;
}

/**
 * Search backend for company research.
 *
 * The free tree never calls a method on this — it constructs providers through
 * untyped `require()` and passes them straight through
 * (electron/services/resolveCompanySearchProvider.ts), reading only
 * `quotaExhausted` and only via an `any` cast
 * (electron/ipcHandlers.ts:10934). The shape is therefore intentionally
 * minimal; task 22 fills it in when the local research backend lands.
 */
export interface SearchProvider {
  search(query: string, ...args: any[]): Promise<any>;
  quotaExhausted?: boolean;
}
