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

export type CaptureRequest = { type: 'natively:extract' };
export type CaptureResponse =
  | { ok: true; result: ExtractResult }
  | { ok: false; error: string };

const GUARD = '__natively_capture_listener__';

function runExtraction(): ExtractResult {
  return extractPageContent({
    document,
    readabilityFactory: (doc) => new Readability(doc),
    getSelection: () => {
      try {
        return window.getSelection()?.toString() ?? '';
      } catch {
        return '';
      }
    },
  });
}

const w = window as unknown as Record<string, unknown>;
if (!w[GUARD]) {
  w[GUARD] = true;
  chrome.runtime.onMessage.addListener(
    (message: CaptureRequest, _sender, sendResponse: (r: CaptureResponse) => void) => {
      if (!message || message.type !== 'natively:extract') return undefined;
      try {
        const result = runExtraction();
        sendResponse({ ok: true, result });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      // Synchronous response; returning true is unnecessary but harmless.
      return undefined;
    },
  );
}
