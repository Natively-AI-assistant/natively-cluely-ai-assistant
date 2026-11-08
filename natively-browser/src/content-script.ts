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
import { extractPageContent, finishFormulaImages, type ExtractResult } from './extract';
import { browserSheetEnv, drawFormulaSheets, serializeFormulaSvg, type FormulaImageLimits } from './formula-sheet';
import { finishSmartFormulaImages, smartCapture, type SmartCaptureResult } from './capture/smart-capture';
import type { BrowserContextCategory, CaptureMode } from './capture/types';

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
  /** What the desktop takes; without it formulas with no text are not drawn. */
  formulaImages?: FormulaImageLimits;
}

export type CaptureRequest =
  | { type: 'natively:extract'; formulaImages?: FormulaImageLimits }
  // Smart Browser Context v2: classify + structured-extract in one round-trip.
  // `mode` lets the SW distinguish manual vs auto captures for the envelope.
  // `fullPage` (experimental) attaches the full readable text of any non-sensitive
  // page in auto mode — sensitive pages are still hard-blocked downstream.
  // `classifyOnly`/`extraCategories`/`aiApproved` drive the AI-classifier round-trip.
  | ({ type: 'natively:smart-extract' } & SmartExtractOpts);
/** A manual capture, with the image of its formulas that have no text (data URLs). */
export type ExtractedPage = ExtractResult & { formulaImages?: string[]; formulaImageRanges?: Array<[number, number]> };

/** A smart capture, with the image of its formulas that have no text (data URLs). */
export type SmartCapturePage = SmartCaptureResult & {
  unreadableFormulas?: number;
  formulaImages?: string[];
  formulaImageRanges?: Array<[number, number]>;
};

export type CaptureResponse =
  | { ok: true; result: ExtractedPage }
  | { ok: true; smart: SmartCapturePage }
  | { ok: false; error: string };

const GUARD = '__natively_capture_listener__';

function pageSelection(): string {
  try {
    return window.getSelection()?.toString() ?? '';
  } catch {
    return '';
  }
}

/** A copy of the selection's markup, so the formulas in it can be read. */
function pageSelectionFragment(): Node | null {
  try {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const box = document.createElement('div');
    for (let i = 0; i < sel.rangeCount; i++) box.appendChild(sel.getRangeAt(i).cloneContents());
    return box;
  } catch {
    return null;
  }
}

/**
 * How long a capture may spend on its formula images, reading the page
 * included. The desktop waits 2.5 s from the service worker's `started` ack,
 * and injecting this script comes out of that too; formulas not drawn by
 * then are sent as [formula not captured].
 */
const FORMULA_IMAGE_BUDGET_MS = 1000;

/** `formulaImages`: what the desktop takes; without it formulas with no text are not drawn. */
async function runExtraction(formulaImages?: FormulaImageLimits): Promise<ExtractedPage> {
  const deadline = performance.now() + FORMULA_IMAGE_BUDGET_MS;
  const result = extractPageContent({
    document,
    readabilityFactory: (doc) => new Readability(doc),
    getSelection: pageSelection,
    getSelectionFragment: pageSelectionFragment,
    ...(formulaImages ? { serializeFormula: (formula: Element) => serializeFormulaSvg(formula, document) } : {}),
  });
  if (!formulaImages || !result.formulas.length) return result;
  const { images, ranges, drawn } = await drawFormulaSheets(result.formulas, browserSheetEnv(document), formulaImages, deadline);
  const finished = finishFormulaImages(result, drawn);
  // The markup was only for drawing; the service worker forwards the rest.
  return { ...finished, formulas: [], ...(images.length ? { formulaImages: images, formulaImageRanges: ranges } : {}) };
}

/**
 * The smart capture, with its formulas that have no text drawn into an image
 * when the desktop takes one (#645), in the same budget as a manual capture.
 */
async function runSmartCapture(opts: SmartExtractOpts): Promise<SmartCapturePage> {
  const deadline = performance.now() + FORMULA_IMAGE_BUDGET_MS;
  const limits = opts.formulaImages;
  const smart = smartCaptureOf(opts, limits ? (formula) => serializeFormulaSvg(formula, document) : undefined);
  if (!limits || !smart.formulas?.length) return smart;
  try {
    const { images, ranges, drawn } = await drawFormulaSheets(smart.formulas, browserSheetEnv(document), limits, deadline);
    const finished = finishSmartFormulaImages(smart, drawn);
    return { ...finished, ...(images.length ? { formulaImages: images, formulaImageRanges: ranges } : {}) };
  } catch {
    // The text still goes: an answer must never lose its page over the image.
    return finishSmartFormulaImages(smart, new Set());
  }
}

function smartCaptureOf(
  opts: SmartExtractOpts,
  serializeFormula?: (formula: Element) => string | null,
): SmartCaptureResult {
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
    serializeFormula,
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
          runExtraction(message.formulaImages).then(
            (result) => sendResponse({ ok: true, result }),
            (err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
          );
          // Keeps the channel open for the async reply.
          return true;
        }
        if (message.type === 'natively:smart-extract') {
          runSmartCapture(message).then(
            (smart) => sendResponse({ ok: true, smart }),
            (err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
          );
          // Keeps the channel open for the async reply.
          return true;
        }
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
        return undefined;
      }
      return undefined;
    },
  );
}
