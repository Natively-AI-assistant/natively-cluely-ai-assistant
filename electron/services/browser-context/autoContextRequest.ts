/**
 * Smart Browser Context v2 — what the desktop asks the extension for before a
 * What to answer (`phone-mirror:request-auto-context`).
 *
 * Pure + dependency-free (only type imports) so it can be unit-tested directly
 * from the compiled dist-electron output.
 *
 * Coding auto-attach needs BOTH switches: "Auto-detect coding problems" (the
 * extension recognises the page) and "Auto-attach coding context" (it attaches
 * it). Turning either off drops the coding branch, in the request below and in
 * the AI classifier's verdict (autoContextVerdict). The other paths (opted-in
 * categories, the AI classifier for other pages, full-page mode) are
 * independent of both, and none of them relax the sensitive floor, which the
 * extension enforces.
 */

import { CODING_CATEGORIES } from './policy';
import type { AutoPolicy, BrowserContextCategory } from './types';

export interface AutoContextSettings {
  autoDetectCoding: boolean;
  autoAttachCoding: boolean;
  aiClassifierEnabled: boolean;
  autoDetectJobDescriptions: boolean;
  autoDetectDeveloperDocs: boolean;
  experimentalFullPageCapture: boolean;
}

export interface AutoContextRequest {
  codingEnabled: boolean;
  fullPage: boolean;
  aiClassify: boolean;
  extraCategories?: BrowserContextCategory[];
}

/** The request to send, or null when every auto path is off (send nothing). */
export function buildAutoContextRequest(settings: AutoContextSettings): AutoContextRequest | null {
  // Opted-in extra categories that should auto-attach beyond coding (their
  // registry policy is 'ask'). The extension treats these as eligible locally
  // (no AI needed) when their toggle is on.
  const extraCategories: BrowserContextCategory[] = [];
  if (settings.autoDetectJobDescriptions) extraCategories.push('job_description');
  if (settings.autoDetectDeveloperDocs) extraCategories.push('developer_docs');

  const codingEnabled = codingAutoAttachEnabled(settings);
  const anyEnabled =
    codingEnabled ||
    settings.experimentalFullPageCapture ||
    settings.aiClassifierEnabled ||
    extraCategories.length > 0;
  if (!anyEnabled) return null;

  return {
    // When coding is off, tell the extension to NOT treat a high-confidence
    // coding page as eligible — otherwise a coding page would still be captured
    // whenever any OTHER auto path (JD/docs/AI/full-page) is on.
    codingEnabled,
    fullPage: settings.experimentalFullPageCapture,
    aiClassify: settings.aiClassifierEnabled,
    extraCategories: extraCategories.length ? extraCategories : undefined,
  };
}

/** Whether a high-confidence coding page may auto-attach: both switches on. */
export function codingAutoAttachEnabled(
  settings: Pick<AutoContextSettings, 'autoDetectCoding' | 'autoAttachCoding'>,
): boolean {
  return settings.autoDetectCoding && settings.autoAttachCoding;
}

/**
 * The verdict /classify sends back to the extension. Its AI path extracts an
 * approved page without looking at codingEnabled, so the coding switches are
 * applied here, on the desktop (which also keeps the shipped extension correct):
 *   - coding off: any coding verdict becomes 'manual';
 *   - "Hold back unsure pages" on (the default): a coding verdict below the
 *     confidence bar ('ask' or 'auto_if_high_confidence') becomes 'manual'.
 * Other categories pass through: docs and job pages are 'ask' by category, not
 * because the AI is unsure. 'manual' is never auto-attached; the user can still
 * capture the page.
 */
export function autoContextVerdict(
  decision: { autoPolicy: AutoPolicy; category: BrowserContextCategory },
  opts: { codingEnabled: boolean; holdBackUnsure: boolean },
): AutoPolicy {
  const { autoPolicy, category } = decision;
  if (!CODING_CATEGORIES.has(category) || autoPolicy === 'blocked' || autoPolicy === 'manual') {
    return autoPolicy;
  }
  if (!opts.codingEnabled) return 'manual';
  if (opts.holdBackUnsure && autoPolicy !== 'auto') return 'manual';
  return autoPolicy;
}
