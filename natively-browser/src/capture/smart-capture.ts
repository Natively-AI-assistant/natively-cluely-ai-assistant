/**
 * Smart Browser Context v2 — in-page smart capture orchestrator.
 *
 * Runs IN the page (content script) at capture/answer time. Pipeline:
 *   1. gather coarse boolean page signals (just-in-time),
 *   2. classify the tab locally (registry + scorer + sensitive floor),
 *   3. if blocked → return nothing,
 *   4. otherwise run the structured extractor → { envelope, dom }.
 *
 * Everything is dependency-injected (document, registry, selection,
 * readabilityFactory, contextId, capturedAt) so it unit-tests under node --test.
 * No eval, no remote code, no background execution.
 */

import { DEFAULT_REGISTRY, findPlatform, normalizeHost } from './registry/registry';
import type { CaptureRegistry } from './registry/registry-types';
import { buildSafeMetadata, classifyTab } from './classifier/tab-classifier';
import { gatherPageSignals } from './page-signals';
import { runExtractor } from './extractors';
import type { BrowserContextCategory, CaptureMode, ContextEnvelope, SafeWebsiteMetadata, TabCandidate } from './types';

export interface SmartCaptureDeps {
  document: Document;
  host: string;
  url: string;
  title?: string;
  getSelection?: () => string;
  readabilityFactory?: (doc: Document) => { parse(): { title?: string | null; textContent?: string | null } | null };
  contextId: string;
  capturedAt: number;
  captureMode: CaptureMode;
  registry?: CaptureRegistry;
  /**
   * Auto-capture path: classify first and ONLY run the (heavier) structured
   * extractor when the local policy permits auto-attach. This keeps the
   * "capture page content only when it will be used" guarantee — a normal
   * non-coding page during a meeting answer is classified (cheap) and skipped
   * without ever extracting its body. Manual captures leave this false.
   */
  autoEligibleOnly?: boolean;
  /**
   * EXPERIMENTAL full-page mode: when true, the auto path does NOT apply the
   * coding-only `autoEligibleOnly` skip — every non-sensitive page is extracted
   * (full readable text) so the answer model can take what it needs. This relaxes
   * ONLY the coding-only gate; the sensitive blocked-floor return runs first and
   * is never bypassed.
   */
  fullPageMode?: boolean;
  /**
   * Extra categories the user opted into auto-detecting (e.g. 'job_description',
   * 'developer_docs'). A page whose LOCAL category is one of these is treated as
   * auto-eligible even though its registry policy is 'ask'. Sensitive categories
   * can never be added here — the blocked floor runs first.
   */
  extraEligibleCategories?: ReadonlySet<BrowserContextCategory>;
  /**
   * The desktop AI metadata classifier approved this page (after the round-trip).
   * When true, the page is auto-eligible regardless of local policy — BUT only
   * because the desktop already ran it through the hard policy engine, which
   * forces sensitive categories to 'blocked'. The extension's own blocked floor
   * still runs first as defense-in-depth.
   */
  aiApproved?: boolean;
  /**
   * Classify-only mode: build the candidate + sanitized metadata but DO NOT read
   * the page body / run the extractor. Used for the first leg of the AI round-trip
   * (the desktop classifies sanitized metadata before any content is captured).
   */
  classifyOnly?: boolean;
  /**
   * Whether high-confidence coding pages count as auto-eligible. Defaults true.
   * When false ("auto-attach coding" off), the coding branch is dropped so a
   * coding page is NOT captured even if another auto path (JD/docs/AI/full-page)
   * made the request. The other paths are unaffected.
   */
  codingEnabled?: boolean;
}

/** Policies that may auto-attach without an explicit user action. */
const AUTO_ELIGIBLE = new Set(['auto', 'auto_if_high_confidence']);

export interface SmartCaptureResult {
  /** Local classification of the page. */
  candidate: TabCandidate;
  /** Structured capture (null for blocked/sensitive pages or classify-only). */
  envelope: ContextEnvelope | null;
  /** Legacy plain-string DOM ('' for blocked / not-extracted). */
  dom: string;
  /** True when the page was blocked (sensitive) and nothing was captured. */
  blocked: boolean;
  /**
   * Sanitized metadata for the desktop AI classifier (coarse tokens + host +
   * sanitized URL + booleans — never page body/code/secrets). Always present for
   * a non-blocked page; undefined when blocked (we never describe a sensitive
   * page to the AI either).
   */
  safeMetadata?: SafeWebsiteMetadata;
}

/** A short, lowercased visible-text sample for keyword signals (not transmitted). */
function visibleSample(doc: Document, cap = 4000): string {
  try {
    const body = doc.body;
    const t = (body as { innerText?: string } | null)?.innerText ?? body?.textContent ?? '';
    return t.slice(0, cap);
  } catch {
    return '';
  }
}

/**
 * Run the full in-page smart capture. The caller (content script) supplies the
 * real document + selection; tests supply fakes.
 */
export function smartCapture(deps: SmartCaptureDeps): SmartCaptureResult {
  const registry = deps.registry ?? DEFAULT_REGISTRY;
  const host = normalizeHost(deps.host);
  const url = deps.url || '';
  const selection = (deps.getSelection?.() || '').trim();

  const signals = gatherPageSignals(deps.document, selection, visibleSample(deps.document));

  const candidate = classifyTab({
    registry,
    host,
    url,
    title: deps.title ?? deps.document.title,
    signals,
  });
  // Stamp the candidate with the host/url it was built from (classifyTab uses -1
  // tabId; the service worker fills the real tabId/lastSeenAt on its side).
  candidate.url = url;
  candidate.host = host;

  // SENSITIVE FLOOR — runs before anything else and is never bypassed. We never
  // extract a sensitive page AND never describe it to the AI classifier.
  if (candidate.autoPolicy === 'blocked') {
    return { candidate, envelope: null, dom: '', blocked: true };
  }

  // Sanitized metadata for the desktop AI round-trip. Built for every non-blocked
  // page; contains coarse tokens + host + a sanitized URL + booleans only.
  const safeMetadata = buildSafeMetadata({
    registry,
    host,
    url,
    title: deps.title ?? deps.document.title,
    signals,
  });

  // Classify-only: the first leg of the AI round-trip wants the candidate +
  // metadata WITHOUT reading the page body. No extraction here.
  if (deps.classifyOnly) {
    return { candidate, envelope: null, dom: '', blocked: false, safeMetadata };
  }

  // Auto path: skip extraction entirely for non-auto-eligible pages so we never
  // read a non-coding page's body just to discard it. Manual captures extract
  // regardless (the user explicitly asked). A page is auto-eligible when:
  //   - high-confidence coding (registry policy auto/auto_if_high_confidence) AND
  //     coding auto-attach is enabled, OR
  //   - its local category is one the user opted into (extraEligibleCategories: JD/docs), OR
  //   - the desktop AI classifier approved it (aiApproved), OR
  //   - EXPERIMENTAL full-page mode is on (any non-sensitive page).
  // The sensitive floor above already ran, so none of these can capture a
  // sensitive page.
  const localCategory = candidate.matchedCategory;
  const extraEligible = Boolean(localCategory && deps.extraEligibleCategories?.has(localCategory));
  // codingEnabled defaults true; only an explicit false drops the coding branch.
  const codingEligible = deps.codingEnabled !== false && AUTO_ELIGIBLE.has(candidate.autoPolicy);
  const eligible =
    deps.fullPageMode ||
    deps.aiApproved ||
    extraEligible ||
    codingEligible;
  if (deps.autoEligibleOnly && !eligible) {
    return { candidate, envelope: null, dom: '', blocked: false, safeMetadata };
  }

  const platform = findPlatform(registry, host, url);
  const { envelope, dom } = runExtractor({
    document: deps.document,
    getSelection: deps.getSelection,
    readabilityFactory: deps.readabilityFactory,
    contextId: deps.contextId,
    capturedAt: deps.capturedAt,
    candidate,
    platform,
    captureMode: deps.captureMode,
    // Upgrade the unknown-category `selectionOnly` extractor to the full-text
    // article extractor so the model sees the whole readable page. This applies
    // for EXPERIMENTAL full-page mode and for an AI-approved unknown page (the
    // desktop AI judged it worth capturing, so a bare selection is not enough).
    fullPage: deps.fullPageMode || (deps.aiApproved && candidate.matchedCategory === 'unknown'),
  });

  return { candidate, envelope, dom, blocked: false, safeMetadata };
}
