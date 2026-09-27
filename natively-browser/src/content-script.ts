/**
 * Content script — runs IN the page, injected on demand by the service worker
 * via `chrome.scripting.executeScript({ files: ['content-script.js'] })`.
 *
 * SECURITY: this script runs in an untrusted page context, so it NEVER receives
 * the pairing token and NEVER talks to the loopback server. Its only job is:
 *   page DOM  -->  extractPageContent()  -->  reply with clean text.
 * The service worker owns the token and performs the actual POST to /dom.
 *
 * It bundles Mozilla Readability (MIT) and exposes a single message handler.
 * `executeScript` re-injects this file on every capture; guarding the listener
 * registration keeps repeated injections from stacking duplicate handlers.
 */
import { Readability } from '@mozilla/readability';
import { extractPageContent, type ExtractResult } from './extract';
import { smartCapture, type SmartCaptureResult } from './capture/smart-capture';
import type { BrowserContextCategory, CaptureMode } from './capture/types';
import {
  assembleProjectContext,
  discoverProject,
  type ExternalProjectFile,
  type ProjectCaptureResult,
  type ProjectPageIdentity,
} from './capture/project-context';
import type { ProjectFileContext } from './capture/types';

export interface SmartExtractOpts {
  contextId: string;
  capturedAt: number;
  mode?: CaptureMode;
  /** EXPERIMENTAL: attach the full readable text of any non-sensitive page. */
  fullPage?: boolean;
  /** Classify + build sanitized metadata only; do NOT read the page body. */
  classifyOnly?: boolean;
  /** Extra opted-in categories treated as auto-eligible (e.g. job_description). */
  extraCategories?: BrowserContextCategory[];
  /** The desktop AI classifier approved this page → auto-eligible. */
  aiApproved?: boolean;
  /** Defaults true; false drops the coding eligibility branch. */
  codingEnabled?: boolean;
}

export type CaptureRequest =
  | { type: 'natively:extract' }
  // Smart Browser Context v2: classify + structured-extract in one round-trip.
  // `mode` lets the SW distinguish manual vs auto captures for the envelope.
  // `fullPage` (experimental) attaches the full readable text of any non-sensitive
  // page in auto mode — sensitive pages are still hard-blocked downstream.
  // `classifyOnly`/`extraCategories`/`aiApproved` drive the AI-classifier round-trip.
  | ({ type: 'natively:smart-extract' } & SmartExtractOpts)
  // Project capture is deliberately separate from the fast single-page path.
  // `externalFiles` are read-only snapshots from already-loaded editors in the
  // page's MAIN world; DOM providers fill in visible explorers.
  | {
      type: 'natively:project-discover';
      externalFiles?: ExternalProjectFile[];
      allowEmpty?: boolean;
      /** Sanitized identity of the top-level tab that owns an embedded IDE. */
      pageIdentity?: ProjectPageIdentity;
    }
  | {
      type: 'natively:project-capture';
      contextId: string;
      capturedAt: number;
      selectedPaths: string[];
      refresh?: boolean;
      baseContextId?: string;
      previousSelectedPaths?: string[];
      previousFiles?: ProjectFileContext[];
      externalFiles?: ExternalProjectFile[];
      allowEmpty?: boolean;
      /** Bounded readable text extracted from the top frame by the service worker. */
      problemStatement?: string;
      /** Sanitized identity of the top-level tab that owns an embedded IDE. */
      pageIdentity?: ProjectPageIdentity;
    };
export type CaptureResponse =
  | { ok: true; result: ExtractResult }
  | { ok: true; smart: SmartCaptureResult }
  | { ok: true; project: ReturnType<typeof discoverProject> }
  | { ok: true; projectCapture: ProjectCaptureResult }
  | { ok: false; error: string };

const GUARD = '__natively_capture_listener__';

function pageSelection(): string {
  try {
    return window.getSelection()?.toString() ?? '';
  } catch {
    return '';
  }
}

function runExtraction(): ExtractResult {
  return extractPageContent({
    document,
    readabilityFactory: (doc) => new Readability(doc),
    getSelection: pageSelection,
  });
}

function runSmartCapture(opts: SmartExtractOpts): SmartCaptureResult {
  const mode = opts.mode || 'auto';
  return smartCapture({
    document,
    host: location.hostname,
    url: location.href,
    title: document.title,
    getSelection: pageSelection,
    readabilityFactory: (doc) => new Readability(doc),
    contextId: opts.contextId,
    capturedAt: opts.capturedAt,
    captureMode: mode,
    // Auto captures (pre-answer pull) only extract auto-eligible coding pages;
    // a manual capture extracts whatever the user is on.
    autoEligibleOnly: mode === 'auto',
    // EXPERIMENTAL: relax the coding-only auto gate and capture the full page
    // text for any non-sensitive page. Sensitive pages stay blocked.
    fullPageMode: opts.fullPage === true,
    // Classify-only first leg of the AI round-trip: build metadata, read no body.
    classifyOnly: opts.classifyOnly === true,
    // Opted-in extra categories (JD / dev-docs) treated as auto-eligible.
    extraEligibleCategories: opts.extraCategories ? new Set(opts.extraCategories) : undefined,
    // Desktop AI classifier already approved this page (after the round-trip).
    aiApproved: opts.aiApproved === true,
    // Defaults true; false drops the coding eligibility branch.
    codingEnabled: opts.codingEnabled !== false,
  });
}

function runProjectDiscovery(
  externalFiles?: ExternalProjectFile[],
  allowEmpty = false,
  pageIdentity?: ProjectPageIdentity,
) {
  return discoverProject(document, pageIdentity || {
    host: location.hostname,
    url: location.href,
    title: document.title,
  }, externalFiles, { minimumFiles: allowEmpty ? 0 : 2 });
}

function runProjectCapture(message: Extract<CaptureRequest, { type: 'natively:project-capture' }>): ProjectCaptureResult {
  const project = runProjectDiscovery(
    message.externalFiles,
    message.allowEmpty === true,
    message.pageIdentity,
  );
  if (!project) throw new Error('This page does not expose a readable multi-file workspace');

  // Reuse the proven clean-page extractor for the task statement. The project
  // assembler applies its own deterministic budget, so file boundaries and the
  // omissions manifest always remain visible to the model.
  // The project may live in a cross-origin IDE iframe while the challenge text
  // lives in the top frame (HackerRank is one example). Prefer the service
  // worker's bounded top-frame extraction; only fall back to this frame for
  // older callers that do not provide it.
  const problemStatement = typeof message.problemStatement === 'string'
    ? message.problemStatement
    : runExtraction().text;
  return assembleProjectContext(project, {
    contextId: message.contextId,
    capturedAt: message.capturedAt,
    selectedPaths: message.selectedPaths,
    refresh: message.refresh === true,
    baseContextId: message.baseContextId,
    previousSelectedPaths: message.previousSelectedPaths,
    previousFiles: message.previousFiles,
    problemStatement,
  });
}

const w = window as unknown as Record<string, unknown>;
if (!w[GUARD]) {
  w[GUARD] = true;
  chrome.runtime.onMessage.addListener(
    (message: CaptureRequest, _sender, sendResponse: (r: CaptureResponse) => void) => {
      if (!message) return undefined;
      try {
        if (message.type === 'natively:extract') {
          sendResponse({ ok: true, result: runExtraction() });
          return undefined;
        }
        if (message.type === 'natively:smart-extract') {
          const smart = runSmartCapture(message);
          sendResponse({ ok: true, smart });
          return undefined;
        }
        if (message.type === 'natively:project-discover') {
          sendResponse({
            ok: true,
            project: runProjectDiscovery(
              message.externalFiles,
              message.allowEmpty === true,
              message.pageIdentity,
            ),
          });
          return undefined;
        }
        if (message.type === 'natively:project-capture') {
          sendResponse({ ok: true, projectCapture: runProjectCapture(message) });
          return undefined;
        }
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
        return undefined;
      }
      return undefined;
    },
  );
}
