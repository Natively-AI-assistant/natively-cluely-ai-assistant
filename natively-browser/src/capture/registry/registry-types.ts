/**
 * Smart Browser Context v2 — capture registry types.
 *
 * The registry is DATA ONLY: hosts, URL patterns, keyword signals, category +
 * extractor names, and policy/sensitivity. There is NO executable code here and
 * none is ever loaded remotely — a future remote registry may only ship signed
 * JSON matching this shape. The loader (registry.ts) validates against these
 * types and falls back to the bundled default on any problem.
 */

import type {
  AutoPolicy,
  BrowserContextCategory,
  BrowserContextSensitivity,
} from '../types';

/** Extractor identifiers a category/platform rule may name (no code, just a tag). */
export type ExtractorId =
  | 'codingProblem'
  | 'codingEditor'
  | 'docsVisible'
  | 'notesEditor'
  | 'article'
  | 'jobDescription'
  | 'selectionOnly'
  | 'blocked';

/** Platform rules can use every extractor except the no-op 'blocked'. */
export type PlatformExtractorId = Exclude<ExtractorId, 'blocked'>;

export interface CategoryRule {
  id: BrowserContextCategory;
  label: string;
  autoPolicy: AutoPolicy;
  sensitivity: BrowserContextSensitivity;
  /** Substring/suffix patterns matched against the URL string. */
  urlPatterns: string[];
  /** Host suffix patterns (e.g. "leetcode.com" matches "www.leetcode.com"). */
  hostPatterns: string[];
  /** Keyword signals that raise confidence in this category. */
  positiveSignals: string[];
  /** Keyword signals that argue AGAINST this category. */
  negativeSignals: string[];
  extractor: ExtractorId;
}

export interface PlatformRule {
  id: string;
  label: string;
  category: BrowserContextCategory;
  hostPatterns: string[];
  urlPatterns: string[];
  /** Origins to request as OPTIONAL host permissions for this platform. */
  optionalOrigins: string[];
  extractor: PlatformExtractorId;
  /** Best-effort selector/keyword hints the platform extractor may use. */
  platformHints?: {
    titleSelectors?: string[];
    statementSelectors?: string[];
    codeSelectors?: string[];
    constraintsSignals?: string[];
    examplesSignals?: string[];
  };
}

export interface BlockedHostRule {
  id: string;
  label: string;
  category: BrowserContextCategory;
  hostPatterns: string[];
  /** Optional URL substrings that also trigger the block (e.g. "/checkout"). */
  urlPatterns?: string[];
}

export interface CaptureRegistry {
  version: string;
  createdAt: string;
  expiresAt?: string;
  /** Reserved for a future signed remote registry; ignored for the bundled one. */
  signature?: string;
  categories: CategoryRule[];
  platforms: PlatformRule[];
  blockedHosts: BlockedHostRule[];
}
